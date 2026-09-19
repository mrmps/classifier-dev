import { afterEach, expect, test } from "bun:test";
import worker, { type Env } from "../src/index";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const labels = ["__proto__", "constructor", "toString", "other"];
const scores = Object.fromEntries(labels.map((label, i) => [label, i === 0 ? 0.97 : 0.01]));
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

test.each([false, true])("all caller labels retain their scores (multi=%s)", async (multi) => {
  globalThis.fetch = (async (url, init) => {
    expect(String(url)).toBe("https://api.typesafe.ai/v1/systemone");
    const sent = JSON.parse(String(init?.body));
    if (!multi) expect(Object.keys(sent.questions.i0.criteria)).toEqual(labels);
    const answers = multi
      ? Object.fromEntries(labels.map((label, i) => [`i0_${i}`, { noul: scores[label] }]))
      : { i0: { choice: "__proto__", confidence: 0.97, probabilities: scores } };
    return Response.json({ model: "jev-test", answers });
  }) as typeof fetch;

  const response = await worker.fetch(new Request("https://classifier.dev/v1/classify", {
    method: "POST",
    body: JSON.stringify({ input: "This text is about the JavaScript prototype property.", labels, multi }),
  }), { TYPESAFE_API_KEY: "test" } as Env, ctx);
  expect(response.status).toBe(200);
  const body = await response.json() as { results: { label?: string; labels?: string[]; scores: Record<string, number>; model: string }[] };
  expect(body.results[0].model).toBe("jev-test");
  expect(Object.keys(body.results[0].scores)).toEqual(labels);
  expect(body.results[0].scores).toEqual(scores);
  if (multi) expect(body.results[0].labels).toEqual(["__proto__"]);
  else expect(body.results[0].label).toBe("__proto__");
});
