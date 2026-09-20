// Run with: npm test
//
// Two things here are worth a test. An address that a real person typed must
// survive normalising, because rejecting a good address is the only failure
// the form cannot recover from. And the address must reach Postgres as a bound
// parameter, never as text in a statement — an apostrophe in a name is enough
// to matter, and the same hole is how a table gets read back out.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ROADMAP, ROADMAP_KEYS, desiredLatency, normalise, wanted, roadmapDoc, subscribe, notify, Unavailable, confirmationToken, verifyToken, requestConfirmation } from "../src/newsletter";
import worker, { type Env } from "../src/index";
import { OPENAPI } from "../src/openapi";

const CONN = "postgresql://writer:pw@ep-test.us-east-1.aws.neon.tech/neondb?sslmode=require";
const env = { DATABASE_URL: CONN, NEWSLETTER_CONFIRMATION_SECRET: "test-secret-long-enough-for-confirmation", NEWSLETTER_RESEND_API_KEY: "test-resend", NEWSLETTER_FROM: "classifier.dev <updates@classifier.dev>" } as Env;

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
    return new Response(JSON.stringify({ rowCount: 1, rows: [{ added: true }] }), { status });
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

describe("wanted", () => {
  it("keeps known keys once each, in roadmap order, from an array or a form's repeats", () => {
    expect(wanted(["trained", "private", "trained", " PRIVATE "])).toEqual(["private", "trained"]);
    expect(wanted("accuracy,api")).toEqual(["api", "accuracy"]);
  });

  it("drops what it does not know rather than refusing the address", () => {
    expect(wanted(["private", "pony", 42, null, { key: "api" }])).toEqual(["private"]);
    expect(wanted(undefined)).toEqual([]);
    expect(wanted({ private: true })).toEqual([]);
  });

  it("only ever returns keys that are safe inside an array literal", () => {
    for (const k of ROADMAP_KEYS) expect(k).toMatch(/^[a-z-]+$/);
    expect(new Set(ROADMAP_KEYS).size).toBe(ROADMAP.length);
  });
});

describe("desiredLatency", () => {
  it("accepts whole milliseconds inside the supported range", () => {
    expect(desiredLatency(1)).toBe(1);
    expect(desiredLatency("100")).toBe(100);
    expect(desiredLatency(" 60000 ")).toBe(60_000);
  });

  it("rejects missing, fractional, non-numeric and out-of-range targets", () => {
    for (const value of [undefined, null, "", "10.5", 10.5, 0, 60_001, "fast"]) {
      expect(desiredLatency(value)).toBeNull();
    }
  });
});

describe("the printed roadmap", () => {
  it("prints every item and every key, so the page and the plain text cannot drift", () => {
    const doc = roadmapDoc();
    for (const r of ROADMAP) {
      expect(doc).toContain(r.name);
      expect(doc).toContain(r.what);
      expect(doc).toContain(r.key);
    }
  });

  it("stays inside the width the rest of the docs use", () => {
    for (const line of roadmapDoc().split("\n")) expect(line.length).toBeLessThanOrEqual(78);
  });

  it("tells the reader what is kept", () => {
    expect(roadmapDoc()).toContain("what you ticked are kept apart from API traffic");
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

  it("keeps one row per address and never undoes an unsubscribe, so the answer is never an address oracle", async () => {
    const seen = capture();
    await subscribe(env, "someone@example.com", "api");
    expect(seen[0].body.query).toContain("on conflict (email) do update");
    expect(seen[0].body.query).toContain("coalesce(subscriber.confirmed_at, now())");
    expect(seen[0].body.query).toContain("where subscriber.unsubscribed_at is null");
    // A bare re-confirm must not blank the ticks a person made on the page.
    expect(seen[0].body.query).toContain("when cardinality(excluded.wants) > 0 then excluded.wants else subscriber.wants");
  });

  it("sends the ticks as one array literal of roadmap keys", async () => {
    const seen = capture();
    await subscribe(env, "someone@example.com", "form", ["private", "trained"]);
    expect(seen[0].body.params[2]).toBe("{private,trained}");
    expect(seen[0].body.query).toContain("$3::text[]");
    await subscribe(env, "someone@example.com", "api");
    expect(seen[1].body.params[2]).toBe("{}");
  });

  it("stores the desired latency with faster inference and clears it with a replacement list", async () => {
    const seen = capture();
    await subscribe(env, "someone@example.com", "form", ["faster"], 100);
    expect(seen[0].body.params).toEqual(["someone@example.com", "form", "{faster}", 100]);
    expect(seen[0].body.query).toContain("desired_latency_ms");
    expect(seen[0].body.query).toContain("cardinality(excluded.wants) > 0 then excluded.desired_latency_ms");
  });

  it("reports whether this confirmation was the one that added the address", async () => {
    globalThis.fetch = (async () => Response.json({ rowCount: 1, rows: [{ added: false }] })) as typeof fetch;
    expect(await subscribe(env, "again@example.com", "api", ["api"])).toBe(false);
  });

  it("writes only the address, where it came from and what was ticked", async () => {
    const seen = capture();
    await subscribe(env, "someone@example.com", "form");

    const { query, params } = seen[0].body;
    expect(params).toEqual(["someone@example.com", "form", "{}", null]);
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

    await notify(env, "subscriber@example.com", "form", ["private", "faster", "api"], 100);

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.resend.com/emails");
    expect(seen[0].headers.get("authorization")).toBe("Bearer re_test_key");
    expect(seen[0].body.to).toEqual(["owner@example.com"]);
    expect(seen[0].body.subject).toContain("subscriber@example.com");
    expect(String(seen[0].body.text)).toContain("subscriber@example.com");
    expect(String(seen[0].body.text)).toContain("form");
    // The owner reads names, not keys.
    expect(String(seen[0].body.text)).toContain("Wants: Private inference, Faster inference, A self-serve API");
    expect(String(seen[0].body.text)).toContain("Desired latency: 100 ms");

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
    const discovery = await res.json() as { api: { subscribe: { url: string; body: { email: string; wants: string[]; desired_latency_ms: number }; wants: Record<string, string>; confirmation_required: boolean } } };
    expect(discovery.api.subscribe.url).toBe("https://classifier.dev/subscribe");
    expect(discovery.api.subscribe.body).toEqual({ email: "agent@example.com", wants: ["faster"], desired_latency_ms: 100 });
    expect(Object.keys(discovery.api.subscribe.wants)).toEqual([...ROADMAP_KEYS]);
    expect(discovery.api.subscribe.confirmation_required).toBe(true);
    expect(OPENAPI.paths["/subscribe"].post.security).toEqual([]);
    const schema = OPENAPI.paths["/subscribe"].post.requestBody.content["application/json"].schema as { properties: { wants: { items: { enum: string[] } }; desired_latency_ms: { minimum: number; maximum: number } } };
    expect(schema.properties.wants.items.enum).toEqual([...ROADMAP_KEYS]);
    expect(schema.properties.desired_latency_ms).toMatchObject({ minimum: 1, maximum: 60_000 });
    expect(OPENAPI.paths["/subscribe/confirm"].post.responses["200"].content["application/json"].schema.properties).toHaveProperty("desired_latency_ms");
  });

  it("accepts an agent inbox through JSON without credentials and permits retries", async () => {
    const seen = capture();
    for (let i = 0; i < 2; i++) {
      const res = await request({ email: " Agent+updates@Example.com ", wants: ["trained", "nope", "private"] });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true, status: "pending_confirmation", wants: ["private", "trained"] });
    }
    expect(seen).toHaveLength(2);
    for (const call of seen) {
      expect(call.url).toBe("https://api.resend.com/emails");
      expect(call.body.to).toEqual(["agent+updates@example.com"]);
      expect(call.body.text).toContain("POST https://classifier.dev/subscribe/confirm");
      // The person is told what they ticked, by name.
      expect(call.body.text).toContain("You ticked: Private inference, Trained endpoints.");
    }
    await Promise.all(pending.splice(0));
  });

  it("requires a whole desired latency when faster inference is selected", async () => {
    const seen = capture();
    for (const desired_latency_ms of [undefined, 0, 10.5, 60_001, "fast"]) {
      const res = await request({ email: "agent@example.com", wants: ["faster"], desired_latency_ms });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "choose a desired latency from 1 to 60000 ms" });
    }
    expect(seen).toHaveLength(0);

    const res = await request({ email: "agent@example.com", wants: ["faster"], desired_latency_ms: 85 });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, status: "pending_confirmation", wants: ["faster"], desired_latency_ms: 85 });
    expect(seen[0].body.text).toContain("Desired latency: 85 ms.");
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
    expect(await verifyToken(env, token, now)).toEqual({ email: "agent@example.com", wants: [], desiredLatencyMs: null });
    expect(await verifyToken(env, token, now + 86_400_000)).toBeNull();
    expect(await verifyToken(env, token, now - 86_400_000)).toBeNull();
    expect(await verifyToken({ ...env, NEWSLETTER_CONFIRMATION_SECRET: "another-key" }, token, now)).toBeNull();
    for (const bad of [null, 5, "bad", token + "x", "x" + token, "a.b", "a".repeat(1501)]) {
      expect(await verifyToken(env, bad, now)).toBeNull();
    }
  });

  it("carries the ticks in the token, so they survive until the row exists", async () => {
    const now = 1_800_000_000_000;
    const token = await confirmationToken(env, "agent@example.com", now, ["trained", "private"]);
    expect(await verifyToken(env, token, now)).toEqual({ email: "agent@example.com", wants: ["trained", "private"].sort((a, b) => ROADMAP_KEYS.indexOf(a) - ROADMAP_KEYS.indexOf(b)), desiredLatencyMs: null });
    // A different list is a different token, and so a different email.
    expect(token).not.toBe(await confirmationToken(env, "agent@example.com", now, ["api"]));
    // Confirming writes what the token carried, not what the request says.
    const seen = capture();
    const live = await confirmationToken(env, "agent@example.com", Date.now(), ["trained", "private"]);
    const res = await worker.fetch(new Request("https://classifier.dev/subscribe/confirm", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: live, wants: ["accuracy"] }),
    }), env, ctx);
    expect(await res.json()).toEqual({ ok: true, status: "confirmed", wants: ["private", "trained"] });
    expect(seen[0].body.params).toEqual(["agent@example.com", "api", "{private,trained}", null]);
  });

  it("carries a faster-inference latency through confirmation and into storage", async () => {
    const now = 1_800_000_000_000;
    const token = await confirmationToken(env, "agent@example.com", now, ["faster"], 75);
    expect(await verifyToken(env, token, now)).toEqual({ email: "agent@example.com", wants: ["faster"], desiredLatencyMs: 75 });

    const seen = capture();
    const live = await confirmationToken(env, "agent@example.com", Date.now(), ["faster"], 75);
    const preview = await confirm(live, "GET");
    expect(await preview.text()).toContain("Desired latency: 75 ms.");
    const res = await confirm(live);
    expect(await res.json()).toEqual({ ok: true, status: "confirmed", wants: ["faster"], desired_latency_ms: 75 });
    expect(seen[0].body.params).toEqual(["agent@example.com", "api", "{faster}", 75]);
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
    expect(await res.json()).toEqual({ ok: true, status: "confirmed", wants: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0].body.params).toEqual(["agent@example.com", "api", "{}", null]);
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

  it("supports forms without JavaScript for both steps, reading every ticked box", async () => {
    const seen = capture();
    const data = new URLSearchParams({ email: "agent@example.com" });
    data.append("wants", "accuracy");
    data.append("wants", "dedicated");
    data.append("wants", "faster");
    data.set("desired_latency_ms", "90");
    const signup = await worker.fetch(new Request("https://classifier.dev/subscribe", { method: "POST", body: data }), env, ctx);
    expect(signup.status).toBe(202);
    expect(await signup.text()).toContain("Check your inbox");
    expect(seen[0].url).toBe("https://api.resend.com/emails");
    expect(seen[0].body.text).toContain("You ticked: Faster inference, Dedicated endpoints, Better classification.");
    expect(seen[0].body.text).toContain("Desired latency: 90 ms.");
    const token = await confirmationToken(env, "agent@example.com", Date.now(), ["faster", "dedicated", "accuracy"], 90);
    expect(seen[0].body.text).toContain(token);
    const preview = await worker.fetch(new Request(`https://classifier.dev/subscribe/confirm?token=${encodeURIComponent(token)}`), env, ctx);
    const previewHtml = await preview.text();
    expect(previewHtml).toContain("You ticked: Faster inference, Dedicated endpoints, Better classification.");
    expect(previewHtml).toContain("Desired latency: 90 ms.");
    const result = await worker.fetch(new Request("https://classifier.dev/subscribe/confirm", { method: "POST", body: new URLSearchParams({ token }) }), env, ctx);
    expect(result.status).toBe(200);
    expect(await result.text()).toContain("Email confirmed");
    expect(seen[1].body.params).toEqual(["agent@example.com", "form", "{faster,dedicated,accuracy}", 90]);
  });

  it("returns unchanged state for duplicate or unsubscribed addresses", async () => {
    globalThis.fetch = (async () => Response.json({ rowCount: 0, rows: [] })) as typeof fetch;
    expect(await subscribe(env, "agent@example.com", "api")).toBe(false);
  });
});

describe("the checklist on the page", () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const home = async () => (await worker.fetch(new Request("https://classifier.dev/", { headers: { accept: "text/html" } }), env, ctx)).text();

  it("offers every roadmap item as a box in both forms, posting the key", async () => {
    const html = await home();
    for (const r of ROADMAP) {
      expect(html).toContain(`id="want-${r.key}" type="checkbox" name="wants" value="${r.key}"`);
      expect(html).toContain(`id="dock-${r.key}" type="checkbox" name="wants" value="${r.key}"`);
      expect(html).toContain(r.what);
    }
    expect(html).toContain('id="want-desired-latency" type="number"');
    expect(html).toContain('id="dock-desired-latency" type="number"');
  });

  it("says what is kept, the same way the plain text does", async () => {
    expect(await home()).toContain("what you ticked");
    expect(roadmapDoc()).toContain("what you ticked");
  });
});
