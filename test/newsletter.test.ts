// Run with: npm test
//
// Two things here are worth a test. An address that a real person typed must
// survive normalising, because rejecting a good address is the only failure
// the form cannot recover from. And the address must reach Postgres as a bound
// parameter, never as text in a statement — an apostrophe in a name is enough
// to matter, and the same hole is how a table gets read back out.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ROADMAP, normalise, roadmapDoc, subscribe, notify, Unavailable } from "../src/newsletter";
import worker, { type Env } from "../src/index";
import { OPENAPI } from "../src/openapi";

const CONN = "postgresql://writer:pw@ep-test.us-east-1.aws.neon.tech/neondb?sslmode=require";
const env = { NEWSLETTER_DATABASE_URL: CONN } as never;

let realFetch: typeof globalThis.fetch;
beforeEach(() => void (realFetch = globalThis.fetch));
afterEach(() => void (globalThis.fetch = realFetch));

/** Records the one request subscribe() makes. */
function capture(status = 200) {
  const seen: { url: string; headers: Headers; body: { query: string; params: unknown[] } }[] = [];
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
    expect(roadmapDoc()).toContain("the address and the date");
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
    expect(seen[0].body.query).toContain("on conflict (email) do nothing");
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
    expect(discovery.api.subscribe.confirmation_required).toBe(false);
    expect(OPENAPI.paths["/subscribe"].post.security).toEqual([]);
  });

  it("accepts an agent inbox through JSON without credentials and permits retries", async () => {
    const seen = capture();
    for (let i = 0; i < 2; i++) {
      const res = await request({ email: " Agent+updates@Example.com " });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true, subscribed: "agent+updates@example.com" });
    }
    expect(seen).toHaveLength(2);
    for (const call of seen) {
      expect(call.body.params).toEqual(["agent+updates@example.com", "api"]);
      expect(call.body.query).toContain("on conflict (email) do nothing");
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

  it("reports storage failure without claiming subscription succeeded", async () => {
    capture(503);
    const res = await request({ email: "agent@example.com" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "could not record that address; try again shortly" });
  });
});
