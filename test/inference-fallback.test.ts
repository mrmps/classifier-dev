import { afterEach, expect, test } from "bun:test";

import worker, { type Env } from "../src/index";

const realFetch = globalThis.fetch;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const env = {
  OPENROUTER_API_KEY: "test",
  STATS: { get: async () => null, put: async () => {} },
} as unknown as Env;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const single = (content: string) => Response.json({
  choices: [{ message: { content }, logprobs: { content: [{ top_logprobs: [{ token: "A", logprob: 0 }, { token: "B", logprob: -1 }] }] } }],
  usage: { cost: 0.001 },
});

const multi = (content: string) => Response.json({
  choices: [{ message: { content } }],
  usage: { cost: 0.001 },
});

async function classify(body: Record<string, unknown>) {
  return worker.fetch(new Request("https://classifier.dev/v1/classify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), env, ctx);
}

test.each(["fast", "smart"])("unconfigured %s fallback makes no provider requests", async tier => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return single("A"); }) as typeof fetch;
  const response = await worker.fetch(new Request("https://classifier.dev/v1/classify", {
    method: "POST", body: JSON.stringify({ input: "test", labels: ["yes", "no"], tier }),
  }), { ...env, OPENROUTER_API_KEY: "" }, ctx);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "inference_unavailable" });
  expect(calls).toBe(0);
});

test("empty 200 responses exhaust one model and fail over", async () => {
  const models: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const model = (JSON.parse(String(init?.body)) as { model: string }).model;
    models.push(model);
    return models.length <= 3 ? Response.json({}) : single("B");
  }) as typeof fetch;

  const response = await classify({ input: "a useful sentence", labels: ["bug", "feature"] });
  const body = await response.json() as { results: { label: string; model: string }[] };
  expect(response.status).toBe(200);
  expect(models).toEqual([
    "ibm-granite/granite-4.0-h-micro",
    "ibm-granite/granite-4.0-h-micro",
    "ibm-granite/granite-4.0-h-micro",
    "deepseek/deepseek-v4-flash",
  ]);
  expect(body.results[0]).toMatchObject({ label: "feature", model: "deepseek/deepseek-v4-flash" });
});

test("single-label prose is malformed instead of selecting its trailing letter", async () => {
  const models: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const model = (JSON.parse(String(init?.body)) as { model: string }).model;
    models.push(model);
    return models.length <= 3 ? single("The answer is A because it is obvious") : single("B");
  }) as typeof fetch;

  const response = await classify({ input: "a useful sentence", labels: ["bug", "feature"] });
  const body = await response.json() as { results: { label: string; model: string }[] };
  expect(response.status).toBe(200);
  expect(body.results[0]).toMatchObject({ label: "feature", model: "deepseek/deepseek-v4-flash" });
  expect(models).toEqual([
    "ibm-granite/granite-4.0-h-micro",
    "ibm-granite/granite-4.0-h-micro",
    "ibm-granite/granite-4.0-h-micro",
    "deepseek/deepseek-v4-flash",
  ]);
});

test("permanent provider errors do not retry the same model", async () => {
  const models: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    const model = (JSON.parse(String(init?.body)) as { model: string }).model;
    models.push(model);
    return models.length === 1
      ? new Response(JSON.stringify({ error: { code: "rate_limit", message: "caller secret body" } }), { status: 400 })
      : single("B");
  }) as typeof fetch;

  const response = await classify({ input: "a useful sentence", labels: ["bug", "feature"] });
  const body = await response.json() as { results: { label: string; model: string }[] };
  expect(response.status).toBe(200);
  expect(models).toEqual([
    "ibm-granite/granite-4.0-h-micro",
    "deepseek/deepseek-v4-flash",
  ]);
  expect(body.results[0]).toMatchObject({ label: "feature", model: "deepseek/deepseek-v4-flash" });
});

test("malformed logprobs do not invalidate an otherwise valid answer", async () => {
  const models: string[] = [];
  globalThis.fetch = (async (_url, init) => {
    models.push((JSON.parse(String(init?.body)) as { model: string }).model);
    return Response.json({
    choices: [{ message: { content: "A" }, logprobs: { content: [{ top_logprobs: [null] }] } }],
    });
  }) as typeof fetch;

  const response = await classify({ input: "a useful sentence", labels: ["bug", "feature"] });
  const body = await response.json() as { results: { label: string; confidence: number | null }[] };
  expect(response.status).toBe(200);
  expect(body.results[0]).toMatchObject({ label: "bug", confidence: null });
  expect(models).toEqual(["ibm-granite/granite-4.0-h-micro"]);
});

test("fallback preserves valid logprob scores for nonword input", async () => {
  globalThis.fetch = (async () => single("A")) as typeof fetch;

  const response = await classify({ input: "npm", labels: ["package manager", "other"] });
  const body = await response.json() as { results: { label: string; confidence: number | null; scores: Record<string, number> | null; unscored?: string }[] };
  expect(response.status).toBe(200);
  expect(body.results[0].label).toBe("package manager");
  expect(body.results[0].confidence).toBe(0.7311);
  expect(body.results[0].scores).toEqual({ "package manager": 0.7311, other: 0.2689 });
  expect(body.results[0].unscored).toBeUndefined();
});

test("fallback confidence describes the selected label rather than the largest score", async () => {
  globalThis.fetch = (async () => single("B")) as typeof fetch;
  const response = await classify({ input: "a useful sentence", labels: ["bug", "feature"] });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.results[0]).toMatchObject({ label: "feature", confidence: 0.2689 });
  expect(body.results[0].confidence).toBe(body.results[0].scores.feature);
});

test("prose tokens are not category probabilities", async () => {
  globalThis.fetch = (async () => Response.json({
    choices: [{ message: { content: "A" }, logprobs: { content: [{ top_logprobs: [
      { token: "Actually", logprob: -0.1 }, { token: "Because", logprob: -1 },
    ] }] } }],
  })) as typeof fetch;
  const response = await classify({ input: "a useful sentence", labels: ["bug", "feature"] });
  expect(response.status).toBe(200);
  expect((await response.json()).results[0]).toMatchObject({ label: "bug", confidence: null, scores: null });
});

test("a verifier's explicit none result clears the multi-label shortlist", async () => {
  const labels = Array.from({ length: 13 }, (_, i) => `label-${i}`);
  let calls = 0;
  globalThis.fetch = (async (_url, init) => {
    calls++;
    JSON.parse(String(init?.body));
    return multi(calls <= 2 ? "1,2" : "none");
  }) as typeof fetch;

  const response = await classify({ input: "a useful sentence", labels, multi: true });
  const body = await response.json() as { results: { labels: string[] }[] };
  expect(response.status).toBe(200);
  expect(calls).toBe(3);
  expect(body.results[0].labels).toEqual([]);
});

test("a >26-label single-label fallback cannot succeed with an empty answer", async () => {
  const labels = Array.from({ length: 27 }, (_, i) => `label-${i}`);
  globalThis.fetch = (async () => multi("none")) as typeof fetch;

  const response = await classify({ input: "a useful sentence", labels });
  const body = await response.json() as { code: string; error: string };
  expect(response.status).toBe(502);
  expect(body.code).toBe("upstream_other");
  expect(body.error).toContain("malformed_response");
});

test("multi-label none is valid, while explanatory prose fails over", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return multi(calls <= 3 ? "none because nothing applies" : "2");
  }) as typeof fetch;

  const response = await classify({ input: "a useful sentence", labels: ["bug", "feature"], multi: true });
  const body = await response.json() as { results: { labels: string[]; model: string }[] };
  expect(response.status).toBe(200);
  expect(body.results[0].labels).toEqual(["feature"]);
  expect(body.results[0].model).toBe("inception/mercury-2.5");
});

test("status and network failures retry, and the final failure does not add a delay", async () => {
  const delays: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: TimerHandler, ms?: number, ...args: unknown[]) => {
    delays.push(Number(ms ?? 0));
    return realSetTimeout(callback, 0, ...args);
  }) as typeof setTimeout;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls <= 3) return new Response(JSON.stringify({ error: { code: "temporarily_unavailable" } }), { status: 503 });
    if (calls === 4) throw new Error("connection reset");
    return single("A");
  }) as typeof fetch;

  try {
    const response = await classify({ input: "a useful sentence", labels: ["bug", "feature"] });
    const body = await response.json() as { results: { label: string }[] };
    expect(response.status).toBe(200);
    expect(body.results[0].label).toBe("bug");
    // Three 503s retry twice; the fourth call is a network retry and succeeds.
    expect(calls).toBe(5);
    expect(delays).toHaveLength(3);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("preserves the provider status code without exposing its error body", async () => {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: TimerHandler, ...args: unknown[]) => realSetTimeout(callback, 0, ...args)) as typeof setTimeout;
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "provider secret body" } }), { status: 503 })) as typeof fetch;

  try {
    const response = await classify({ input: "a useful sentence", labels: ["bug", "feature"] });
    const body = await response.json() as { error: string; code: string };
    expect(response.status).toBe(502);
    expect(body.code).toBe("openrouter_503");
    expect(body.error).not.toContain("provider secret body");
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("a reasoning fallback receives a longer bounded timeout signal", async () => {
  let signal: AbortSignal | undefined;
  let calls = 0;
  globalThis.fetch = (async (_url, init) => {
    signal = init?.signal as AbortSignal;
    calls++;
    if (calls === 1) throw new DOMException("deadline", "TimeoutError");
    return single("A");
  }) as typeof fetch;

  const response = await classify({ input: "a useful sentence", labels: ["bug", "feature"], tier: "smart" });
  expect(response.status).toBe(200);
  expect(calls).toBe(2);
  expect(signal).toBeInstanceOf(AbortSignal);
  expect(signal?.aborted).toBe(false);
});
