// Run with: npm test
//
// Two things here are worth a test. An address that a real person typed must
// survive normalising, because rejecting a good address is the only failure
// the form cannot recover from. And the address must reach Postgres as a bound
// parameter, never as text in a statement — an apostrophe in a name is enough
// to matter, and the same hole is how a table gets read back out.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ROADMAP, normalise, roadmapDoc, subscribe, notify, Unavailable, confirmationToken, verifyToken, requestConfirmation } from "../src/newsletter";
import worker, { type Env } from "../src/index";
import { OPENAPI } from "../src/openapi";

const CONN = "postgresql://writer:pw@ep-test.us-east-1.aws.neon.tech/neondb?sslmode=require";
const env = { NEWSLETTER_DATABASE_URL: CONN, NEWSLETTER_CONFIRMATION_SECRET: "test-secret-long-enough-for-confirmation", NEWSLETTER_RESEND_API_KEY: "test-resend", NEWSLETTER_FROM: "classifier.dev <updates@classifier.dev>" } as Env;

let realFetch: typeof globalThis.fetch;
beforeEach(() => void (realFetch = globalThis.fetch));
afterEach(() => void (globalThis.fetch = realFetch));

/** Records the one request subscribe() makes. */
function capture(status = 200) {
  const seen: { url: string; headers: Headers; body: { query: string; params: unknown[]; to: string[]; text: string } }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ rowCount: 1 }), { status });
  }) as typeof globalThis.fetch;
  return seen;
}

describe("normalise", () => {
  it("keeps addresses people actually have", () => {
    for (const good of [
      "a@b.co",
      "first.last@sub.domain.example",
      "user+classifier@gmail.com",
      "o'brien@example.ie",
      "user_name-1@example.co.uk",
    ]) {
      expect(normalise(good)).toBe(good);
    }
  });

  it("trims and lowercases, so the same person is one row", () => {
    expect(normalise("  Someone@Example.COM \n")).toBe("someone@example.com");
  });

  it("rejects what is not an address", () => {
    for (const bad of [
      "",
      "   ",
      "nodomain",
      "no@tld",
      "two@@example.com",
      "spaces in@example.com",
      "a@b.com, c@d.com",
      "a@b.com;c@d.com",
      `${"a".repeat(250)}@example.com`,
      null,
      undefined,
      42,
      { email: "a@b.com" },
    ]) {
      expect(normalise(bad)).toBeNull();
    }
  });
});

describe("the printed roadmap", () => {
  it("prints every item, so the page and the plain text cannot drift", () => {
    const doc = roadmapDoc();
    for (const r of ROADMAP) {
      expect(doc).toContain(r.name);
      expect(doc).toContain(r.what);
    }
  });

  it("stays inside the width the rest of the docs use", () => {
    for (const line of roadmapDoc().split("\n")) expect(line.length).toBeLessThanOrEqual(78);
  });

  it("tells the reader what is kept", () => {
    expect(roadmapDoc()).toContain("signup source, and subscription dates");
  });
});

describe("subscribe", () => {
  it("binds the address instead of writing it into the statement", async () => {
    const seen = capture();
    await subscribe(env, "o'brien@example.ie", "form");

    expect(seen).toHaveLength(1);
    expect(seen[0].body.params[0]).toBe("o'brien@example.ie");
    expect(seen[0].body.query).not.toContain("o'brien");
    expect(seen[0].body.query).toContain("$1");
  });

  it("makes a repeat signup a no-op, so the answer is never an address oracle", async () => {
    const seen = capture();
    await subscribe(env, "someone@example.com", "api");
    expect(seen[0].body.query).toContain("subscriber.confirmed_at is null and subscriber.unsubscribed_at is null");
  });

  it("writes only the address and where it came from", async () => {
    const seen = capture();
    await subscribe(env, "someone@example.com", "form");

    const { query, params } = seen[0].body;
    expect(params).toEqual(["someone@example.com", "form"]);
    // No column that could tie the row to a request.
    for (const forbidden of ["ip", "user_agent", "request_id", "country"]) {
      expect(query).not.toContain(forbidden);
    }
  });

  it("talks to the host in the connection string, over HTTP", async () => {
    const seen = capture();
    await subscribe(env, "someone@example.com", "api");
    expect(seen[0].url).toBe("https://ep-test.us-east-1.aws.neon.tech/sql");
    expect(seen[0].headers.get("neon-connection-string")).toBe(CONN);
  });

  it("fails loudly when Postgres says no, without repeating the password", async () => {
    capture(403);
    const err = await subscribe(env, "someone@example.com", "api").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Unavailable);
    expect((err as Error).message).toContain("403");
    expect((err as Error).message).not.toContain("pw");
  });

  it("fails when the binding is missing rather than pretending to have saved", async () => {
    capture();
    const err = await subscribe({} as never, "someone@example.com", "api").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Unavailable);
  });
});

describe("notify", () => {
  it("sends a Resend email with subscriber address in subject and body", async () => {
    const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof globalThis.fetch;

    const env = {
      RESEND_API_KEY: "re_test_key",
      REPORT_TO: "owner@example.com",
    } as Env;

    await notify(env, "subscriber@example.com", "form");

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.resend.com/emails");
    expect(seen[0].headers.get("authorization")).toBe("Bearer re_test_key");
    expect(seen[0].body.to).toEqual(["owner@example.com"]);
    expect(seen[0].body.subject).toContain("subscriber@example.com");
    expect(String(seen[0].body.text)).toContain("subscriber@example.com");
    expect(String(seen[0].body.text)).toContain("form");

    globalThis.fetch = realFetch;
  });

  it("does not send email when RESEND_API_KEY is missing", async () => {
    const seen: unknown[] = [];
    globalThis.fetch = (async () => {
      seen.push(true);
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof globalThis.fetch;

    const env = { RESEND_API_KEY: "", REPORT_TO: "owner@example.com" } as Env;
    await notify(env, "subscriber@example.com", "api");

    expect(seen).toHaveLength(0);

    globalThis.fetch = realFetch;
  });

  it("does not send email when REPORT_TO is missing", async () => {
    const seen: unknown[] = [];
    globalThis.fetch = (async () => {
      seen.push(true);
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof globalThis.fetch;

    const env = { RESEND_API_KEY: "re_test_key", REPORT_TO: "" } as Env;
    await notify(env, "subscriber@example.com", "api");

    expect(seen).toHaveLength(0);

    globalThis.fetch = realFetch;
  });

  it("throws on non-ok Resend response", async () => {
    globalThis.fetch = (async () => {
      return new Response("error details", { status: 401 });
    }) as typeof globalThis.fetch;

    const env = {
      RESEND_API_KEY: "re_invalid",
      REPORT_TO: "owner@example.com",
    } as Env;

    const err = await notify(env, "subscriber@example.com", "api").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("resend");
    expect((err as Error).message).toContain("401");

    globalThis.fetch = realFetch;
  });
});

describe("agent subscription API", () => {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  const request = (body: unknown, bindings: Env = env) => worker.fetch(new Request("https://classifier.dev/subscribe", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), bindings, ctx);

  it("advertises an unauthenticated subscription in agent discovery and OpenAPI", async () => {
    const res = await worker.fetch(new Request("https://classifier.dev/agent.json"), env, ctx);
    const discovery = await res.json() as { api: { subscribe: { url: string; body: { email: string }; confirmation_required: boolean } } };
    expect(discovery.api.subscribe.url).toBe("https://classifier.dev/subscribe");
    expect(discovery.api.subscribe.body).toEqual({ email: "agent@example.com" });
    expect(discovery.api.subscribe.confirmation_required).toBe(true);
    expect(OPENAPI.paths["/subscribe"].post.security).toEqual([]);
  });

  it("accepts an agent inbox through JSON without credentials and permits retries", async () => {
    const seen = capture();
    for (let i = 0; i < 2; i++) {
      const res = await request({ email: " Agent+updates@Example.com " });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true, status: "pending_confirmation" });
    }
    expect(seen).toHaveLength(2);
    for (const call of seen) {
      expect(call.url).toBe("https://api.resend.com/emails");
      expect(call.body.to).toEqual(["agent+updates@example.com"]);
      expect(call.body.text).toContain("POST https://classifier.dev/subscribe/confirm");
    }
    await Promise.all(pending.splice(0));
  });

  it("rejects invalid addresses before writing", async () => {
    const seen = capture();
    for (const email of [null, "not-an-email", ["agent@example.com"]]) {
      expect((await request({ email })).status).toBe(400);
    }
    expect(seen).toHaveLength(0);
  });

  it("returns a retry delay when rate limited without writing", async () => {
    const seen = capture();
    const limited = { ...env, LIMITER: {
      idFromName: () => "test",
      get: () => ({ fetch: async () => Response.json({ limited: true }) }),
    } } as unknown as Env;
    const res = await request({ email: "agent@example.com" }, limited);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(seen).toHaveLength(0);
  });

  it("reports delivery failure without claiming an email was sent", async () => {
    capture(503);
    const res = await request({ email: "agent@example.com" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "could not send confirmation; try again shortly" });
  });
});

describe("email confirmation", () => {
  const ctx = { waitUntil: () => {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const confirm = (token: unknown, method = "POST") => worker.fetch(new Request(
    `https://classifier.dev/subscribe/confirm${method === "GET" ? `?token=${token}` : ""}`,
    { method, ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) } : {}) },
  ), env, ctx);

  it("verifies ownership only with an unmodified, unexpired token", async () => {
    const now = 1_800_000_000_000;
    const token = await confirmationToken(env, "agent@example.com", now);
    expect(await verifyToken(env, token, now)).toBe("agent@example.com");
    expect(await verifyToken(env, token, now + 86_400_000)).toBeNull();
    expect(await verifyToken(env, token, now - 86_400_000)).toBeNull();
    expect(await verifyToken({ ...env, NEWSLETTER_CONFIRMATION_SECRET: "another-key" }, token, now)).toBeNull();
    for (const bad of [null, 5, "bad", token + "x", "x" + token, "a.b", "a".repeat(1501)]) {
      expect(await verifyToken(env, bad, now)).toBeNull();
    }
  });

  it("deduplicates emails for the same inbox within an hour, with a fresh token next hour", async () => {
    const hour = 1_800_000_000_000;
    expect(await confirmationToken(env, "a@example.com", hour)).toBe(await confirmationToken(env, "a@example.com", hour + 1000));
    expect(await confirmationToken(env, "a@example.com", hour)).not.toBe(await confirmationToken(env, "a@example.com", hour + 3_600_000));
    const seen = capture();
    await requestConfirmation(env, "agent@example.com");
    expect(seen[0].headers.get("idempotency-key")).toMatch(/^newsletter-confirm\//);
    expect(seen[0].body.text).not.toContain(env.NEWSLETTER_CONFIRMATION_SECRET!);
  });

  it("GET previews without persisting or sending mail; POST confirms", async () => {
    const token = await confirmationToken(env, "agent@example.com");
    const seen = capture();
    const preview = await confirm(token, "GET");
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("no-store");
    expect(preview.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await preview.text()).toContain('method="post"');
    expect(seen).toHaveLength(0);
    const res = await confirm(token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "confirmed" });
    expect(seen).toHaveLength(1);
    expect(seen[0].body.params).toEqual(["agent@example.com", "api"]);
  });

  it("rejects forged tokens without writing", async () => {
    const seen = capture();
    expect((await confirm("forged.token")).status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it("allows retry after storage failure without consuming the token", async () => {
    const token = await confirmationToken(env, "agent@example.com");
    capture(503);
    expect((await confirm(token)).status).toBe(503);
    capture();
    expect((await confirm(token)).status).toBe(200);
  });

  it("supports forms without JavaScript for both steps", async () => {
    const seen = capture();
    const signup = await worker.fetch(new Request("https://classifier.dev/subscribe", { method: "POST", body: new URLSearchParams({ email: "agent@example.com" }) }), env, ctx);
    expect(signup.status).toBe(202);
    expect(await signup.text()).toContain("Check your inbox");
    expect(seen[0].url).toBe("https://api.resend.com/emails");
    const token = await confirmationToken(env, "agent@example.com");
    const result = await worker.fetch(new Request("https://classifier.dev/subscribe/confirm", { method: "POST", body: new URLSearchParams({ token }) }), env, ctx);
    expect(result.status).toBe(200);
    expect(await result.text()).toContain("Email confirmed");
    expect(seen[1].body.params).toEqual(["agent@example.com", "form"]);
  });

  it("returns unchanged state for duplicate or unsubscribed addresses", async () => {
    globalThis.fetch = (async () => Response.json({ rowCount: 0 })) as typeof fetch;
    expect(await subscribe(env, "agent@example.com", "api")).toBe(false);
  });
});
