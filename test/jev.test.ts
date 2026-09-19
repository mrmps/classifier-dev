import { afterEach, describe, expect, test } from "bun:test";

import { estimateTokens, jevClassify, pack } from "../src/jev";

/**
 * Jev takes at most 64k tokens a request and the packer estimates them, so
 * an estimate that undercounts turns into a 400 max_tokens_exceeded and the
 * request leaves the fast tier. Chinese text is where it happened: at 3.5
 * characters a token, 60 inputs of 900 characters packed into one request
 * that really carried four times the tokens it claimed.
 */
const cjk = "今天的天氣很好，我想去公園散步，但是結帳按鈕沒有反應。".repeat(40).slice(0, 900);
const english = "the checkout button does nothing and the page just sits there ".repeat(15).slice(0, 900);
const labels = ["bug", "feature", "praise"];

describe("the token estimate", () => {
  test("counts a non-ASCII character as two tokens, not a third of one", () => {
    expect(estimateTokens(cjk)).toBeGreaterThan(estimateTokens(english) * 4);
  });

  test("packs Chinese text into more requests than the same amount of English", () => {
    const zh = pack(Array.from({ length: 60 }, (_, i) => cjk + i), labels, undefined, false);
    const en = pack(Array.from({ length: 60 }, (_, i) => english + i), labels, undefined, false);
    expect(en).toHaveLength(1);
    expect(zh.length).toBeGreaterThan(1);
    // Every input is in exactly one request, in order.
    expect(zh.flatMap((b) => b.items.map((it) => it.id))).toEqual(Array.from({ length: 60 }, (_, i) => `i${i}`));
  });
});

describe("a batch Jev refuses as too large", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** A fake Jev that refuses any request over `limit` items and answers the rest. */
  const fakeJev = (limit: number) => {
    const calls: number[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { state: { id: string }[]; questions: Record<string, unknown> };
      calls.push(body.state.length);
      if (body.state.length > limit) {
        return new Response(JSON.stringify({ error_type: "max_tokens_exceeded" }), { status: 400 });
      }
      const answers: Record<string, unknown> = {};
      for (const qid of Object.keys(body.questions)) {
        answers[qid] = qid.includes("_")
          ? { noul: 0.9 }
          : { choice: "bug", confidence: 0.8, probabilities: { bug: 0.8, feature: 0.1, praise: 0.1 } };
      }
      return new Response(JSON.stringify({ model: "jev-test", answers, usage: { input_tokens: 10 } }), { status: 200 });
    }) as typeof fetch;
    return calls;
  };

  test("is halved until it fits, and every input still gets its answer in order", async () => {
    const calls = fakeJev(3);
    const inputs = Array.from({ length: 10 }, (_, i) => `text ${i}`);
    const out = await jevClassify("key", inputs, labels, undefined, false);
    expect(out).toHaveLength(10);
    out.forEach((r) => {
      expect(r.label).toBe("bug");
      expect(r.model).toBe("jev-test");
    });
    expect(calls[0]).toBe(10);
    expect(Math.max(...calls.slice(1))).toBeLessThanOrEqual(5);
    expect(calls.filter((n) => n <= 3).reduce((a, b) => a + b, 0)).toBe(10);
  });

  test("keeps each half's own questions in multi-label mode", async () => {
    fakeJev(2);
    const out = await jevClassify("key", ["a", "b", "c", "d"], labels, undefined, true);
    expect(out).toHaveLength(4);
    out.forEach((r) => expect(r.scores).toEqual({ bug: 0.9, feature: 0.9, praise: 0.9 }));
  });

  test("a single input that is still too large is a real failure", async () => {
    fakeJev(0);
    await expect(jevClassify("key", ["one"], labels, undefined, false)).rejects.toThrow(/max_tokens_exceeded/);
  });
});
