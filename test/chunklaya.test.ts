import { test, expect, afterEach } from "bun:test";
import worker, { type Env } from "../src/index";
import { CHUNKLAYA_BACKEND } from "../src/jev";
import { parseTokenRateCard, priceTokens } from "../src/server/token-pricing";
import { providerCallBound } from "../src/server/token-reservation";
import { Permit } from "../src/spending/permit";
import { newMeter } from "../src/cost";
import rates from "../src/retail-rates.json";

/**
 * The long-document route. chunklaya speaks System One at the pod's address;
 * the Worker sends it any input over MAX_CHARS when it is configured, one
 * document per request, and never answers such a request from another model.
 */
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

const POD = "https://pod.example";
const env = {
  CHUNKLAYA_ENABLED: "true", CHUNKLAYA_URL: POD + "/", CHUNKLAYA_TOKEN: "pod-bearer", TYPESAFE_API_KEY: "test",
  STATS: { get: async () => null, put: async () => {} },
  LIMITER: { idFromName: (s: string) => s, get: () => ({ fetch: async () => Response.json({ limited: false, remaining: 59 }) }) },
} as unknown as Env;
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
const LONG = "The invoice was paid twice on Monday.\n\n".repeat(900); // 34,200 characters, over MAX_CHARS
const request = (body: object, bindings = env) => worker.fetch(new Request("https://classifier.dev/v1/classify", {
  method: "POST", body: JSON.stringify(body) }), bindings, ctx);

type Call = { url: string; auth: string | null; body: { model: string; state: { id: string; text: string }[]; questions: Record<string, { type: string; criteria?: Record<string, null> }> } };

/** A pod that answers every question, or refuses with the status and body given. */
function mockPod(refuse?: { status: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Call["body"];
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body });
    if (refuse instanceof Error) throw refuse;
    if (refuse) return Response.json(refuse.body ?? { error: { code: "busy" } }, { status: refuse.status });
    const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => {
      const labels = Object.keys(q.criteria ?? {});
      return [id, q.type === "noul" ? { noul: 0.8 } : { choice: labels[0], confidence: 0.91,
        probabilities: Object.fromEntries(labels.map((label, i) => [label, i ? 0.09 / (labels.length - 1) : 0.91])) }];
    }));
    return Response.json({ model: "chunklaya/multilingual", answers, usage: { input_tokens: 4200, output_tokens: 0 } });
  }) as typeof fetch;
  return calls;
}

test("an input over 32,000 characters is answered by chunklaya, one document per request, with the pod's bearer", async () => {
  const calls = mockPod();
  const response = await request({ input: LONG, labels: ["billing", "technical"] });
  expect(response.status).toBe(200);
  const body = await response.json() as { results: { label: string; confidence: number; scores: Record<string, number>; model: string }[] };
  expect(body.results[0]).toMatchObject({ label: "billing", confidence: 0.91, model: "chunklaya/multilingual" });
  expect(body.results[0].scores).toEqual({ billing: 0.91, technical: 0.09 });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(POD + "/v1/systemone");
  expect(calls[0].auth).toBe("Bearer pod-bearer");
  expect(calls[0].body.model).toBe(CHUNKLAYA_BACKEND.model);
  expect(calls[0].body.state).toHaveLength(1);
  expect(calls[0].body.state[0].text).toBe(LONG);
  // Tier limits, not Laya lane limits, and no lane header.
  expect(response.headers.get("ratelimit-limit")).toBe("3000");
  expect(response.headers.get("x-classifier-processing")).toBeNull();
});

test("without the service configured, or under an explicit jev, a long input is still input_too_long", async () => {
  const calls = mockPod();
  for (const bindings of [{ ...env, CHUNKLAYA_URL: undefined }, { ...env, CHUNKLAYA_TOKEN: undefined }, { ...env, CHUNKLAYA_ENABLED: "false" }]) {
    const response = await request({ input: LONG, labels: ["a", "b"] }, bindings as Env);
    expect(response.status).toBe(400);
    const body = await response.json() as { code: string; error: string };
    expect(body.code).toBe("input_too_long");
    expect(body.error).toContain("at most 32,000");
  }
  const explicit = await request({ model: "jev", input: LONG, labels: ["a", "b"] });
  expect(explicit.status).toBe(400);
  expect((await explicit.json() as { code: string }).code).toBe("input_too_long");
  expect(calls).toHaveLength(0);
});

test("an explicit model selects chunklaya for short text too, and cannot be used without the service", async () => {
  const calls = mockPod();
  const response = await request({ model: "chunklaya", input: "Please refund this charge", labels: ["billing", "technical"] });
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  const missing = await request({ model: "chunklaya", input: "short", labels: ["a", "b"] }, { ...env, CHUNKLAYA_URL: undefined } as Env);
  expect(missing.status).toBe(503);
  expect((await missing.json() as { code: string }).code).toBe("chunklaya_unavailable");
});

test("the long-document ceilings: characters, inputs per request, and no smart tier", async () => {
  const calls = mockPod();
  const huge = await request({ input: "x".repeat(4_000_001), labels: ["a", "b"] });
  expect(huge.status).toBe(400);
  expect(await huge.json()).toMatchObject({ code: "input_too_long", error: expect.stringContaining("4,000,000") });
  const many = await request({ inputs: Array.from({ length: 21 }, () => LONG), labels: ["a", "b"] });
  expect(many.status).toBe(400);
  expect((await many.json() as { code: string }).code).toBe("too_many_inputs");
  const smart = await request({ input: LONG, labels: ["a", "b"], tier: "smart" });
  expect(smart.status).toBe(400);
  expect(await smart.json()).toMatchObject({ code: "bad_tier", error: expect.stringContaining("smart") });
  expect(calls).toHaveLength(0);
});

test("multi-label asks one noul per label and reads the scores back", async () => {
  const calls = mockPod();
  const response = await request({ input: LONG, labels: ["billing", "technical", "legal"], multi: true });
  expect(response.status).toBe(200);
  const body = await response.json() as { results: { labels: string[]; scores: Record<string, number>; model: string }[] };
  expect(body.results[0].labels).toEqual(["billing", "technical", "legal"]);
  expect(body.results[0].scores).toEqual({ billing: 0.8, technical: 0.8, legal: 0.8 });
  expect(Object.values(calls[0].body.questions).map((q) => q.type)).toEqual(["noul", "noul", "noul"]);
});

test("dimensions send every question about a document in one request, one request per document", async () => {
  const calls = mockPod();
  const response = await request({ items: [LONG, LONG + " second"], dimensions: { kind: ["lease", "employment"], renews: ["yes", "no"] } });
  expect(response.status).toBe(200);
  const body = await response.json() as { results: { dimensions: Record<string, { label: string; model: string }> }[] };
  expect(body.results).toHaveLength(2);
  expect(body.results[1].dimensions.kind).toMatchObject({ label: "lease", model: "chunklaya/multilingual" });
  expect(body.results[1].dimensions.renews.label).toBe("yes");
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call.body.state).toHaveLength(1);
    expect(Object.keys(call.body.questions)).toHaveLength(2);
  }
});

test("the service's refusals keep their meaning and never fall back to another model", async () => {
  let calls = mockPod({ status: 422, body: { error: { code: "too_many_passages", type: "too_many_passages" }, detail: "the document has 6500 passages and scan scores at most 256; use strategy \"locate\"" } });
  let response = await request({ input: LONG, labels: ["a", "b"] });
  expect(response.status).toBe(400);
  const refused = await response.json() as { code: string; error: string };
  expect(refused.code).toBe("chunklaya_input");
  expect(refused.error).not.toContain("6500"); // our words, not the service's
  expect(calls.every((c) => c.url.startsWith(POD))).toBe(true);

  calls = mockPod({ status: 429 });
  response = await request({ input: LONG, labels: ["a", "b"] });
  expect(response.status).toBe(429);
  expect((await response.json() as { code: string }).code).toBe("chunklaya_busy");
  expect(response.headers.get("retry-after")).toBe("2");

  calls = mockPod(new Error("connect ECONNREFUSED"));
  response = await request({ input: LONG, labels: ["a", "b"] });
  expect(response.status).toBe(503);
  expect((await response.json() as { code: string }).code).toBe("chunklaya_unavailable");
  expect(calls).toHaveLength(1); // one attempt, no retry, no OpenRouter fallback
});

test("account billing prices chunklaya at zero and bounds a call by its document ceiling", () => {
  const card = parseTokenRateCard(JSON.stringify(rates))!;
  expect(providerCallBound(card, "chunklaya", "chunklaya/multilingual", 0)).toBe(0);
  expect(priceTokens(card, [{ provider: "chunklaya", model: "chunklaya/multilingual", calls: 1, inputTokens: 250_000, outputTokens: 0, cachedInputTokens: 0 }])?.nanodollars).toBe(0n);
});

test("under a spending permit the route is priced as chunklaya, not as Beam", async () => {
  // Production wraps every anonymous or funded request in a Permit whose fetch
  // prices each provider call before sending it. The first deploy priced this
  // route under Beam's name and refused it as unpriced_model.
  const calls = mockPod();
  const meter = newMeter();
  meter.permit = new Permit(10_000_000_000, Date.now() + 90_000);
  meter.beforeCall = async () => {};
  const response = await worker.fetch(new Request("https://classifier.dev/v1/classify", {
    method: "POST", body: JSON.stringify({ input: LONG, labels: ["billing", "technical"] }) }), env, ctx, { meter } as never);
  expect(response.status).toBe(200);
  expect(meter.permit.error).toBeUndefined();
  expect(calls).toHaveLength(1);
  expect(meter.permit.tokens.map((row) => [row.provider, row.model, row.inputTokens])).toEqual([["chunklaya", "chunklaya/multilingual", 4200]]);
  expect(meter.permit.used).toBe(0); // billed by the hour, not the token
});
