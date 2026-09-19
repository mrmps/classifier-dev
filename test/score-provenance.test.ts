import { afterEach, describe, expect, test } from "bun:test";

import worker, { type Env } from "../src/index";

const realFetch = globalThis.fetch;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

afterEach(() => { globalThis.fetch = realFetch; });

const inputs = [
  "SQL",
  "CSS",
  "d41d8cd98f00b204e9800998ecf8427e",
  "42",
  "こんにちは",
  "asdkjfhaskdjfh",
];
const scores = { relevant: 0.9, irrelevant: 0.1 };

describe("scores describe the provider decision for every input shape", () => {
  for (const multi of [false, true]) test(`Jev scores are preserved (multi=${multi})`, async () => {
    globalThis.fetch = (async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      expect(request.state.map((item: { text: string }) => item.text)).toEqual(inputs);
      const answers = multi
        ? Object.fromEntries(inputs.flatMap((_, i) => [
            [`i${i}_0`, { noul: scores.relevant }],
            [`i${i}_1`, { noul: scores.irrelevant }],
          ]))
        : Object.fromEntries(inputs.map((_, i) => [`i${i}`, {
            choice: "relevant",
            confidence: scores.relevant,
            probabilities: scores,
          }]));
      return Response.json({ model: "jev-test", answers });
    }) as typeof fetch;

    const response = await worker.fetch(new Request("https://classifier.dev/v1/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs, labels: Object.keys(scores), multi }),
    }), { TYPESAFE_API_KEY: "test" } as Env, ctx);
    const body = await response.json() as { results: { confidence?: number | null; scores: typeof scores | null; unscored?: string }[] };

    expect(response.status).toBe(200);
    expect(body.results).toHaveLength(inputs.length);
    for (const result of body.results) {
      expect(result.scores).toEqual(scores);
      expect(result.unscored).toBeUndefined();
      expect(result.confidence).toBe(multi ? undefined : scores.relevant);
    }
  });
});
