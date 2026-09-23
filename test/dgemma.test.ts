import { test, expect, afterEach } from "bun:test";
import worker, { type Env } from "../src/index";
import { parseTokenRateCard, priceTokens } from "../src/server/token-pricing";
import { providerCallBound } from "../src/server/token-reservation";
import { Permit } from "../src/spending/permit";
import { newMeter } from "../src/cost";
import rates from "../src/retail-rates.json";

/**
 * The image door of POST /v1/systemone. A body that names model "dgemma" or
 * carries images goes to the DiffusionGemma pod, which speaks the same
 * contract; every other body still goes to TypeSafe. Neither answers for the
 * other.
 */
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

const POD = "https://pod.example";
const env = {
  DGEMMA_ENABLED: "true", DGEMMA_URL: POD + "/", DGEMMA_TOKEN: "pod-bearer", TYPESAFE_API_KEY: "typesafe-key",
  STATS: { get: async () => null, put: async () => {} },
  LIMITER: { idFromName: (s: string) => s, get: () => ({ fetch: async () => Response.json({ limited: false, remaining: 59 }) }) },
} as unknown as Env;
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
const PNG = "data:image/png;base64," + Buffer.from("not really a png but base64 is base64").toString("base64");
const QUESTIONS = { red: { type: "noul", instructions: "Does the image contain a red square?" } };
const post = (body: object, bindings = env, extra?: { meter: unknown }) => worker.fetch(new Request("https://classifier.dev/v1/systemone", {
  method: "POST", headers: { "content-type": "application/json", authorization: "Bearer unused" }, body: JSON.stringify(body) }), bindings, ctx, extra as never);

type Call = { url: string; auth: string | null; body: Record<string, unknown> };

/** A pod and a TypeSafe that both answer, or a pod that refuses with the status and body given. */
function mockUpstreams(refuse?: { status: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body });
    if (String(url).startsWith(POD)) {
      if (refuse instanceof Error) throw refuse;
      if (refuse) return Response.json(refuse.body ?? { error: { message: "busy", type: "server_error" } }, { status: refuse.status });
      return Response.json({ model: "dgemma", answers: { red: { type: "noul", noul: 0.96 } }, usage: { input_tokens: 310, output_tokens: 8 }, diagnostics: { timing: { reads: 4 } } });
    }
    return Response.json({ model: "jev-1.13.0", answers: { red: { type: "noul", noul: 0.5 } }, usage: { input_tokens: 40, output_tokens: 2 } });
  }) as typeof fetch;
  return calls;
}

test("a body with images goes to the pod with its bearer, and the answer comes back in the route's shape", async () => {
  const calls = mockUpstreams();
  const response = await post({ state: { note: "Look at the image." }, images: [PNG], questions: QUESTIONS });
  expect(response.status).toBe(200);
  const body = await response.json() as { model: string; answers: { red: { noul: number } }; usage: { input_tokens: number } };
  expect(body.model).toBe("dgemma");
  expect(body.answers.red.noul).toBe(0.96);
  expect(body.usage.input_tokens).toBe(310);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(POD + "/v1/systemone");
  expect(calls[0].auth).toBe("Bearer pod-bearer");
  expect(calls[0].body.model).toBe("dgemma");
  expect(calls[0].body.images).toEqual([PNG]);
  expect(response.headers.get("ratelimit-limit")).toBe("3000");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
});

test("naming the model sends a text-only body to the pod; a plain body still goes to TypeSafe", async () => {
  const calls = mockUpstreams();
  const named = await post({ model: "dgemma", state: "Refund me", questions: QUESTIONS });
  expect(named.status).toBe(200);
  expect((await named.json() as { model: string }).model).toBe("dgemma");
  const plain = await post({ model: "jev-latest", state: "Refund me", questions: QUESTIONS });
  expect(plain.status).toBe(200);
  expect((await plain.json() as { model: string }).model).toBe("jev-1.13.0");
  expect(calls.map((c) => c.url)).toEqual([POD + "/v1/systemone", "https://api.typesafe.ai/v1/systemone"]);
  expect(calls[1].auth).toBe("Bearer typesafe-key");
});

test("images under another model, malformed images and too many images are refused before anything is called", async () => {
  const calls = mockUpstreams();
  const other = await post({ model: "jev-latest", state: "x", images: [PNG], questions: QUESTIONS });
  expect(other.status).toBe(400);
  expect((await other.json() as { code: string }).code).toBe("images_unsupported");
  const notData = await post({ state: "x", images: ["https://example.com/a.png"], questions: QUESTIONS });
  expect(notData.status).toBe(400);
  expect((await notData.json() as { code: string }).code).toBe("dgemma_input");
  const many = await post({ state: "x", images: [PNG, PNG, PNG, PNG, PNG], questions: QUESTIONS });
  expect(many.status).toBe(400);
  expect((await many.json() as { code: string }).code).toBe("dgemma_input");
  // Presence selects the door, so an empty array is refused here rather than sent on as an unknown field.
  const empty = await post({ state: "x", images: [], questions: QUESTIONS });
  expect(empty.status).toBe(400);
  expect((await empty.json() as { code: string }).code).toBe("dgemma_input");
  const emptyOther = await post({ model: "jev-latest", state: "x", images: [], questions: QUESTIONS });
  expect(emptyOther.status).toBe(400);
  expect((await emptyOther.json() as { code: string }).code).toBe("images_unsupported");
  const huge = await post({ state: "x", images: ["data:image/png;base64," + "A".repeat(900_001)], questions: QUESTIONS });
  expect(huge.status).toBe(400);
  expect((await huge.json() as { error: string }).error).toContain("900,000");
  expect(calls).toHaveLength(0);
});

test("without the service configured or enabled, an image or dgemma request is unavailable, never answered by Jev", async () => {
  const calls = mockUpstreams();
  for (const bindings of [{ ...env, DGEMMA_URL: undefined }, { ...env, DGEMMA_TOKEN: undefined }, { ...env, DGEMMA_ENABLED: "false" }]) {
    const response = await post({ state: "x", images: [PNG], questions: QUESTIONS }, bindings as Env);
    expect(response.status).toBe(503);
    expect((await response.json() as { code: string }).code).toBe("dgemma_unavailable");
    expect(response.headers.get("retry-after")).toBe("60");
  }
  const plain = await post({ state: "x", questions: QUESTIONS }, { ...env, DGEMMA_URL: undefined } as Env);
  expect(plain.status).toBe(200);
  expect(calls.map((c) => c.url)).toEqual(["https://api.typesafe.ai/v1/systemone"]);
});

test("the service's refusals keep their meaning: 422 is the caller's error, 429 is busy, a dead pod is unavailable", async () => {
  let calls = mockUpstreams({ status: 422, body: { error: { message: "question 'red': at most 26 alternatives", type: "validation_error" } } });
  let response = await post({ state: "x", images: [PNG], questions: QUESTIONS });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ code: "dgemma_input", error: "question 'red': at most 26 alternatives" });

  calls = mockUpstreams({ status: 429 });
  response = await post({ state: "x", images: [PNG], questions: QUESTIONS });
  expect(response.status).toBe(429);
  expect((await response.json() as { code: string }).code).toBe("dgemma_busy");
  expect(response.headers.get("retry-after")).toBe("2");

  calls = mockUpstreams(new Error("connect ECONNREFUSED"));
  response = await post({ state: "x", images: [PNG], questions: QUESTIONS });
  expect(response.status).toBe(503);
  expect((await response.json() as { code: string }).code).toBe("dgemma_unavailable");
  expect(calls).toHaveLength(1); // one attempt, no retry, no TypeSafe
});

test("a 200 that is not the whole contract is an outage, and the pod is only ever reached over https", async () => {
  // An answer set missing a question, or reported under another model, must not become a confident 200.
  for (const body of [
    { model: "dgemma", answers: {}, usage: { input_tokens: 1, output_tokens: 1 } },
    { model: "other", answers: { red: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } },
    { model: "dgemma", answers: { red: { type: "noul", noul: 0.9 } } },
  ]) {
    mockUpstreams({ status: 200, body });
    const response = await post({ state: "x", images: [PNG], questions: QUESTIONS });
    expect(response.status).toBe(503);
    expect((await response.json() as { code: string }).code).toBe("dgemma_unavailable");
  }
  const calls = mockUpstreams();
  const plaintext = await post({ state: "x", images: [PNG], questions: QUESTIONS }, { ...env, DGEMMA_URL: "http://pod.example" } as Env);
  expect(plaintext.status).toBe(503);
  expect(calls).toHaveLength(0);
});

test("account billing prices dgemma at zero, and a spending permit accepts the route as dgemma", async () => {
  const card = parseTokenRateCard(JSON.stringify(rates))!;
  expect(providerCallBound(card, "dgemma", "dgemma", 0)).toBe(0);
  expect(priceTokens(card, [{ provider: "dgemma", model: "dgemma", calls: 1, inputTokens: 5_000, outputTokens: 8, cachedInputTokens: 0 }])?.nanodollars).toBe(0n);
  const calls = mockUpstreams();
  const meter = newMeter();
  meter.permit = new Permit(10_000_000_000, Date.now() + 90_000);
  meter.beforeCall = async () => {};
  const response = await post({ state: "x", images: [PNG], questions: QUESTIONS }, env, { meter });
  expect(response.status).toBe(200);
  expect(meter.permit.error).toBeUndefined();
  expect(calls).toHaveLength(1);
  expect(meter.permit.tokens.map((row) => [row.provider, row.model, row.inputTokens])).toEqual([["dgemma", "dgemma", 310]]);
  expect(meter.permit.used).toBe(0); // billed by the hour, not the token
});
