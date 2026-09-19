// Run with: npm test
//
// The alerting state machine has one failure mode that matters: recording an
// alert as sent when it was not. That silences the next six hours, which is the
// exact silence the module exists to break.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runAlerts } from "../src/alerts";

/** A KV stand-in. The real one is eventually consistent; this is not, which is
 *  fine — the ordering bug under test is about when we write, not where. */
function fakeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
    list: async ({ prefix }: { prefix: string }) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
    }),
  };
}

/** Analytics says: ten answers, none of them from Jev — the fallback alert. */
const AE_ROWS = [
  { model: "google/gemini-3.8-flash", status: "200", reason: "", requests: 10, ms_sum: 1000, usd: 0, escfail: 0 },
];

function env(kv: ReturnType<typeof fakeKv>, typesafeKey?: string, gatewayKey?: string) {
  return {
    STATS: kv,
    ...(typesafeKey ? { TYPESAFE_API_KEY: typesafeKey } : {}),
    ...(gatewayKey ? { AI_GATEWAY_API_KEY: gatewayKey } : {}),
    CLOUDFLARE_ACCOUNT_ID: "acct",
    CF_ANALYTICS_TOKEN: "tok",
    RESEND_API_KEY: "key",
    REPORT_TO: "ops@example.com",
  } as never;
}

let realFetch: typeof globalThis.fetch;
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

/** @param mailOk whether Resend accepts the message */
function mockFetch(mailOk: boolean, sent: string[], jevStatus = 200, jevBody = "{}", rows: object[] = AE_ROWS) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(typeof url === "object" && "url" in url ? url.url : url);
    if (u.includes("api.typesafe.ai")) return new Response(jevBody, { status: jevStatus });
    if (u.includes("analytics_engine/sql")) {
      const q = String(init?.body ?? "");
      // The baseline query has no GROUP BY; the window query does.
      const data = q.includes("GROUP BY") ? rows : [{ requests: 240, usd: 0 }];
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    if (u.includes("api.resend.com")) {
      sent.push(String(init?.body ?? ""));
      return mailOk ? new Response("{}", { status: 200 }) : new Response("nope", { status: 500 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof globalThis.fetch;
}

describe("alert state is only recorded once the email is actually away", () => {
  it("does not mark an alert sent when delivery fails", async () => {
    const kv = fakeKv();
    const sent: string[] = [];
    mockFetch(false, sent);

    await expect(runAlerts(env(kv), { send: true })).rejects.toThrow(/resend 500/);
    expect(sent.length).toBe(1); // it tried
    expect([...kv.store.keys()]).toEqual([]); // and recorded nothing
  });

  it("records it once delivery succeeds, then stays quiet", async () => {
    const kv = fakeKv();
    const sent: string[] = [];
    mockFetch(true, sent);

    const first = await runAlerts(env(kv), { send: true });
    expect(first).toContain("Jev is not answering");
    expect([...kv.store.keys()]).toEqual(["alert:fallback"]);

    // Same condition, still inside the renotify window: no second email.
    const second = await runAlerts(env(kv), { send: true });
    expect(second).toContain("nothing new to say");
    expect(sent.length).toBe(1);
  });

  it("a preview neither sends nor records", async () => {
    const kv = fakeKv();
    const sent: string[] = [];
    mockFetch(true, sent);

    const out = await runAlerts(env(kv), { send: false });
    expect(out).toContain("preview only");
    expect(sent.length).toBe(0);
    expect([...kv.store.keys()]).toEqual([]);
  });
});


describe("the Jev key probe", () => {
  const REFUSED = JSON.stringify({
    detail: { error_type: "authentication_error", message: "Cannot authenticate with the server." },
  });

  it("raises a critical alert when TypeSafe refuses the key", async () => {
    const kv = fakeKv();
    const sent: string[] = [];
    mockFetch(true, sent, 401, REFUSED);

    await runAlerts(env(kv, "tskey"), { send: true });
    // Several conditions can fire at once, so the subject collapses to a count;
    // the body is where each one is named.
    expect(sent[0]).toContain("refusing the key");
    expect(sent[0]).toContain("CRITICAL");
    // It forwards what TypeSafe actually said, rather than guessing.
    expect(sent[0]).toContain("Cannot authenticate with the server.");
    expect([...kv.store.keys()]).toContain("alert:jev_credentials");
  });

  it("says nothing while the key still works", async () => {
    const kv = fakeKv();
    const sent: string[] = [];
    mockFetch(true, sent, 200, JSON.stringify({ models: [] }));

    await runAlerts(env(kv, "tskey"), { send: true });
    expect([...kv.store.keys()]).not.toContain("alert:jev_credentials");
  });

  it("still probes when Analytics Engine is down", async () => {
    const kv = fakeKv();
    const sent: string[] = [];
    // AE fails, the probe does not: an analytics outage must not hide a dead key.
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(typeof url === "object" && "url" in url ? url.url : url);
      if (u.includes("api.typesafe.ai")) return new Response(REFUSED, { status: 402 });
      if (u.includes("analytics_engine/sql")) return new Response("boom", { status: 500 });
      if (u.includes("api.resend.com")) { sent.push(String(init?.body ?? "")); return new Response("{}", { status: 200 }); }
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;

    await runAlerts(env(kv, "tskey"), { send: true });
    expect(sent[0]).toContain("refusing the key");
    expect([...kv.store.keys()]).toContain("alert:jev_credentials");
  });
});


/**
 * With a gateway key set, Jev answers should carry the jev@vercel label. When
 * they all carry TypeSafe's own instead, the gateway is refusing every request
 * and TypeSafe is being paid for all of it, which nothing else reports.
 */
describe("the gateway refusal alert", () => {
  const MODELS = JSON.stringify({ models: [] });
  const allDirect = [{ model: "jev-1.13.0", status: "200", reason: "", requests: 25, ms_sum: 5000, usd: 0.001, escfail: 0 }];
  const someGateway = [
    { model: "jev@vercel", status: "200", reason: "", requests: 5, ms_sum: 1000, usd: 0, escfail: 0 },
    { model: "jev-1.13.0", status: "200", reason: "", requests: 20, ms_sum: 4000, usd: 0.001, escfail: 0 },
  ];

  it("warns when the gateway key is set and no Jev answer came through it", async () => {
    const kv = fakeKv();
    const sent: string[] = [];
    mockFetch(true, sent, 200, MODELS, allDirect);

    await runAlerts(env(kv, "tskey", "vck"), { send: true });
    expect(sent[0]).toContain("WARNING");
    expect(sent[0]).toContain("refusing every Jev request");
    expect(sent[0]).toContain("AI Gateway dashboard");
    expect([...kv.store.keys()]).toContain("alert:gateway_refused");
  });

  it("says nothing without a gateway key", async () => {
    const kv = fakeKv();
    const sent: string[] = [];
    mockFetch(true, sent, 200, MODELS, allDirect);

    await runAlerts(env(kv, "tskey"), { send: true });
    expect([...kv.store.keys()]).not.toContain("alert:gateway_refused");
  });

  it("says nothing while some answers do come through the gateway", async () => {
    const kv = fakeKv();
    const sent: string[] = [];
    mockFetch(true, sent, 200, MODELS, someGateway);

    await runAlerts(env(kv, "tskey", "vck"), { send: true });
    expect([...kv.store.keys()]).not.toContain("alert:gateway_refused");
  });

  it("says nothing on a quiet window, where zero could be idleness", async () => {
    const kv = fakeKv();
    const sent: string[] = [];
    mockFetch(true, sent, 200, MODELS, [{ ...allDirect[0], requests: 3 }]);

    await runAlerts(env(kv, "tskey", "vck"), { send: true });
    expect([...kv.store.keys()]).not.toContain("alert:gateway_refused");
  });
});
