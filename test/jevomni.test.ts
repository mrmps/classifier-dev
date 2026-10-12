import { test, expect, afterEach } from "bun:test";
import worker, { type Env } from "../src/index";
import { jevomniState, JEVOMNI_MAX_INPUT_TOKENS } from "../src/jevomni";
import { unsupportedSystemOneInput } from "../src/typesafe-compat";
import { parseTokenRateCard, priceTokens } from "../src/server/token-pricing";
import { providerCallBound } from "../src/server/token-reservation";
import rates from "../src/retail-rates.json";

/**
 * Jev-Omni is opt-in by name. These pin the routing (it never takes imajev's
 * default and imajev never takes it), what crosses to the pod, what is refused
 * before the GPU is touched, and how the pod's answers are checked and billed.
 */
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

const POD = "https://jevomni-pod.example/v1/systemone";
const env = {
  JEVOMNI_URL: POD, JEVOMNI_TOKEN: "pod-bearer", TYPESAFE_API_KEY: "test",
  // As in production: the spending wrapper is what turns a refusal into its HTTP error.
  SPENDING_ENABLED: "true",
  STATS: { get: async () => null, put: async () => {} },
  LIMITER: { idFromName: (s: string) => s, get: () => ({ fetch: async () => Response.json({ limited: false, remaining: 59 }) }) },
} as unknown as Env;
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
const PNG = "data:image/png;base64,aGVsbG8=";
const WAV = "data:audio/wav;base64,UklGRg==";
const CHOICE = { type: "choice", instructions: "Which fits item `a`?", criteria: { billing: null, technical: null } };
const body = (extra: object = {}) => ({ model: "jev-omni", state: "PRIVATE STATE", questions: { a: CHOICE }, ...extra });
// Funded, as a workspace key's call arrives after account reservation: the
// path every paid Jev-Omni request takes, including the GPU starting alongside
// the quota check. e2e/jevomni-billing.ts covers the account layer above it.
const send = (payload: object, bindings = env, path = "/v1/systemone") => worker.fetch(new Request(`https://classifier.dev${path}`, {
  method: "POST", body: JSON.stringify(payload) }), bindings, ctx, { funded: true });

type Call = { url: string; headers: Headers; init: RequestInit; body: Record<string, any> };

/** A pod that answers every question in the documented shape, or the response given. */
function mockPod(reply?: (body: Record<string, any>) => Response) {
  const calls: Call[] = [];
  globalThis.fetch = (async (url, init) => {
    if (String(url) !== POD) return Response.json({ models: [] });
    const parsed = JSON.parse(String(init?.body));
    calls.push({ url: String(url), headers: new Headers(init?.headers), init: init!, body: parsed });
    if (reply) return reply(parsed);
    const answers = Object.fromEntries(Object.entries(parsed.questions as Record<string, any>).map(([id, q]) => {
      const labels = Object.keys(q.criteria ?? {});
      return [id, q.type === "noul" ? { type: "noul", noul: 0.8 } : { type: "choice", choice: labels[0], confidence: 0.9,
        probabilities: Object.fromEntries(labels.map((label, i) => [label, i ? 0.1 / (labels.length - 1) : 0.9])) }];
    }));
    return Response.json({ model: "jev-omni", answers,
      usage: { input_tokens: 1000, output_tokens: 0, forward_passes: 1, inference_ms: 75 } });
  }) as typeof fetch;
  return calls;
}

test("model jev-omni reaches the pod with its bearer, and only the request's own fields cross", async () => {
  const calls = mockPod();
  const response = await send(body({ media: [PNG], share_data: true }));
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].headers.get("authorization")).toBe("Bearer pod-bearer");
  expect(calls[0].headers.get("user-agent")).toBe("classifier.dev");
  expect(calls[0].init.redirect).toBe("manual");
  expect(Object.keys(calls[0].body).sort()).toEqual(["media", "model", "questions", "state"]);
  expect(calls[0].body.media).toEqual([PNG]);
  const result = await response.json() as any;
  expect(result).toEqual({ model: "jev-omni", answers: { a: { type: "choice", choice: "billing", confidence: 0.9,
    probabilities: { billing: 0.9, technical: 0.1 } } }, usage: { input_tokens: 1000, output_tokens: 0 } });
  // Media is never kept for training, whatever share_data says.
  expect(response.headers.get("x-classifier-data-sharing")).toBe("off");
});

test("jev-omni with an images field still goes to Jev-Omni, even with imajev unconfigured", async () => {
  const calls = mockPod();
  expect(unsupportedSystemOneInput({ model: "jev-omni", images: [PNG] }, false)).toBeNull();
  const response = await send(body({ images: [PNG] }));
  expect(response.status).toBe(200);
  expect(calls[0].body.media).toEqual([PNG]);
});

test("the default is unchanged: images with no model never reach Jev-Omni", async () => {
  const calls = mockPod();
  const { model, ...noModel } = body({ images: [PNG] });
  const response = await send(noModel);
  expect(calls).toHaveLength(0);
  expect(response.status).toBe(400);
  expect((await response.json() as any).code).toBe("images_unsupported");
});

test("state of every System One shape becomes the pod's items", () => {
  expect(jevomniState("a ticket")).toEqual([{ id: "state", text: "a ticket" }]);
  expect(jevomniState(null)).toEqual([{ id: "state", text: "" }]);
  expect(jevomniState({ ticket: "charged twice", meta: { n: 1 } }))
    .toEqual([{ id: "ticket", text: "charged twice" }, { id: "meta", text: '{"n":1}' }]);
  expect(jevomniState([{ id: "a", text: "x", rubric: "r" }])).toEqual([{ id: "a", text: "x", rubric: "r" }]);
  expect(jevomniState([1, 2])).toEqual([{ id: "state", text: "[1,2]" }]);
});

test("everything the pod would refuse is refused first, without touching the GPU", async () => {
  const calls = mockPod();
  const cases: [string, object][] = [
    ["two media", body({ media: [PNG, WAV] })],
    ["media and images together", body({ media: [PNG], images: [PNG] })],
    ["a remote URL", body({ media: ["https://example.com/cat.png"] })],
    ["an unsupported type", body({ media: ["data:application/pdf;base64,aGVsbG8="] })],
    ["oversized media", body({ media: ["data:image/png;base64," + "A".repeat(900_000)] })],
    ["a score question", body({ questions: { a: { type: "score", instructions: "?", criteria: ["low", "high"] } } })],
    ["nine questions", body({ questions: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`q${i}`, CHOICE])) })],
    ["a one-option choice", body({ questions: { a: { type: "choice", instructions: "?", criteria: { only: null } } } })],
    ["an unknown question field", body({ questions: { a: { ...CHOICE, examples: [] } } })],
    ["per-request config", body({ config: { temperature: 0 } })],
    ["twenty-one state items", body({ state: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "x"])) })],
  ];
  for (const [name, payload] of cases) {
    const response = await send(payload);
    expect([name, response.status]).toEqual([name, 400]);
  }
  expect(calls).toHaveLength(0);
});

test("an unconfigured Jev-Omni is unavailable and calls nothing", async () => {
  const calls = mockPod();
  const response = await send(body(), { ...env, JEVOMNI_URL: undefined } as unknown as Env);
  expect(response.status).toBe(503);
  expect((await response.json() as any).code).toBe("jevomni_unavailable");
  expect(calls).toHaveLength(0);
});

test("the pod's refusals keep their meaning; its own failures say nothing about it", async () => {
  mockPod(() => Response.json({ error: { type: "jevomni_input", message: "audio must be at most 30 seconds" } }, { status: 400 }));
  let response = await send(body({ media: [WAV] }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "audio must be at most 30 seconds", code: "jevomni_input" });

  mockPod(() => Response.json({ error: { type: "jevomni_input", message: "would read more than 65,536 tokens" } }, { status: 413 }));
  response = await send(body());
  expect(response.status).toBe(413);

  mockPod(() => Response.json({ error: { type: "jevomni_unauthorized", message: "A bearer token is required" } }, { status: 401 }));
  response = await send(body());
  expect(response.status).toBe(502);
  expect(JSON.stringify(await response.json())).not.toContain("bearer");

  mockPod(() => new Response("busy", { status: 429, headers: { "retry-after": "2" } }));
  response = await send(body());
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("2");
});

test("an answer that is incomplete, mismatched or over the token ceiling is not passed on", async () => {
  const good = { type: "choice", choice: "billing", confidence: 0.9, probabilities: { billing: 0.9, technical: 0.1 } };
  const bad: [string, object][] = [
    ["missing usage", { model: "jev-omni", answers: { a: good }, usage: {} }],
    ["zero tokens", { model: "jev-omni", answers: { a: good }, usage: { input_tokens: 0, output_tokens: 0 } }],
    ["over the ceiling", { model: "jev-omni", answers: { a: good }, usage: { input_tokens: JEVOMNI_MAX_INPUT_TOKENS + 1, output_tokens: 0 } }],
    ["another model", { model: "imajev-4b", answers: { a: good }, usage: { input_tokens: 10, output_tokens: 0 } }],
    ["wrong type", { model: "jev-omni", answers: { a: { ...good, type: "noul" } }, usage: { input_tokens: 10, output_tokens: 0 } }],
    ["choice outside the criteria", { model: "jev-omni", answers: { a: { ...good, choice: "refund" } }, usage: { input_tokens: 10, output_tokens: 0 } }],
    ["probabilities not summing to 1", { model: "jev-omni", answers: { a: { ...good, probabilities: { billing: 0.9, technical: 0.5 } } }, usage: { input_tokens: 10, output_tokens: 0 } }],
    ["a missing answer", { model: "jev-omni", answers: {}, usage: { input_tokens: 10, output_tokens: 0 } }],
  ];
  for (const [name, payload] of bad) {
    mockPod(() => Response.json(payload));
    const response = await send(body());
    expect([name, response.status]).toEqual([name, 502]);
  }
});

test("a noul is answered as a probability", async () => {
  mockPod();
  const response = await send(body({ questions: { urgent: { type: "noul", instructions: "Is it urgent?" } } }));
  expect(response.status).toBe(200);
  expect((await response.json() as any).answers.urgent).toEqual({ type: "noul", noul: 0.8 });
});

test("GET /v1/models lists Jev-Omni only when it is configured", async () => {
  mockPod();
  const list = async (bindings: Env) => (await (await worker.fetch(new Request("https://classifier.dev/v1/models"), bindings, ctx))
    .json() as { models: { name: string }[] }).models.map(m => m.name);
  expect(await list(env)).toContain("jev-omni");
  expect(await list({ ...env, JEVOMNI_TOKEN: undefined } as unknown as Env)).not.toContain("jev-omni");
});

test("account billing prices Jev-Omni like imajev and reserves its true token ceiling", () => {
  const card = parseTokenRateCard(JSON.stringify(rates));
  const usage = (inputTokens: number) => [{ provider: "runpod" as const, model: "jev-omni", calls: 1, inputTokens, outputTokens: 0, cachedInputTokens: 0 }];
  expect(priceTokens(card, usage(1000))!.nanodollars).toBe(42_000n);
  expect(priceTokens(card, usage(1000))!.nanodollars)
    .toBe(priceTokens(card, [{ ...usage(1000)[0], model: "imajev-4b" }])!.nanodollars);
  // 65,536 tokens at 42 nanodollars, rounded up to whole credits of 10,000.
  expect(providerCallBound(card, "runpod", "jev-omni", 0)).toBe(Math.ceil(65_536 * 42 / 10_000));
});
