import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { estimateTokens, jevAsk, jevClassify, jevKeys, pack, resetGatewayPause, type Question } from "../src/jev";
import { newMeter } from "../src/cost";

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

  test("keeps state plus the longest question below the separate 32k context limit", () => {
    const inputs = Array(70).fill(english.repeat(4));
    for (const multi of [false, true]) {
      for (const batch of pack(inputs, labels, undefined, multi)) {
        const state = batch.items.reduce((n, item) => n + estimateTokens(item.text) + 20, 0);
        const question = Math.max(...Object.values(batch.questions).map(q => estimateTokens(JSON.stringify(q))));
        expect(state + question).toBeLessThan(32000);
      }
    }
  });
});

describe("a batch Jev refuses as too large", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** A fake Jev that refuses any request over `limit` items and answers the rest. */
  const fakeJev = (limit: number, nested = false) => {
    const calls: number[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { state: { id: string }[]; questions: Record<string, unknown> };
      calls.push(body.state.length);
      if (body.state.length > limit) {
        const error = { error_type: "max_tokens_exceeded" };
        return Response.json(nested ? { detail: error } : error, { status: 400 });
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
    const out = await jevClassify({ typesafe: "key" }, inputs, labels, undefined, false);
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
    const out = await jevClassify({ typesafe: "key" }, ["a", "b", "c", "d"], labels, undefined, true);
    expect(out).toHaveLength(4);
    out.forEach((r) => expect(r.scores).toEqual({ bug: 0.9, feature: 0.9, praise: 0.9 }));
  });

  test("recognizes TypeSafe's live nested error and splits instead of failing the batch", async () => {
    const calls = fakeJev(3, true);
    const out = await jevClassify({ typesafe: "key" }, Array(25).fill("broken checkout"), labels, undefined, false);
    expect(out).toHaveLength(25);
    expect(out.every(r => r.label === "bug" && r.model === "jev-test")).toBe(true);
    expect(calls.filter(n => n <= 3).reduce((a, b) => a + b, 0)).toBe(25);
  });

  test("a single input that is still too large is a real failure", async () => {
    fakeJev(0);
    await expect(jevClassify({ typesafe: "key" }, ["one"], labels, undefined, false)).rejects.toThrow(/max_tokens_exceeded/);
  });

  test("does not accept a successful response that omits an answer", async () => {
    globalThis.fetch = (async () => Response.json({ model: "jev-test", answers: {} })) as typeof fetch;
    await expect(jevClassify({ typesafe: "key" }, ["one"], labels, undefined, false)).rejects.toThrow(/malformed response/);
  });

  test("treats a literal JSON null response as malformed", async () => {
    globalThis.fetch = (async () => Response.json(null)) as typeof fetch;
    await expect(jevClassify({ typesafe: "key" }, ["one"], labels, undefined, false)).rejects.toThrow(/malformed response/);
  });

  test("does not accept a missing model", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ answers: { i0: { choice: "bug", confidence: 0.8, probabilities: { bug: 0.8, feature: 0.1, praise: 0.1 } } } });
    }) as typeof fetch;
    await expect(jevClassify({ typesafe: "key" }, ["one"], labels, undefined, false)).rejects.toThrow(/malformed response/);
    expect(calls).toBe(3);
  });

  test("does not accept malformed probabilities", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ model: "jev-test", answers: { i0: { choice: "bug", confidence: "certain", probabilities: {} } } });
    }) as typeof fetch;
    await expect(jevClassify({ typesafe: "key" }, ["one"], labels, undefined, false)).rejects.toThrow(/malformed response/);
    expect(calls).toBe(3);
  });

  test("retries a transient network failure", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) throw new Error("connection reset");
      return Response.json({
        model: "jev-test",
        answers: { i0: { choice: "bug", confidence: 0.8, probabilities: { bug: 0.8, feature: 0.1, praise: 0.1 } } },
      });
    }) as typeof fetch;
    const out = await jevClassify({ typesafe: "key" }, ["one"], labels, undefined, false);
    expect(calls).toBe(2);
    expect(out[0].label).toBe("bug");
  });

  test("does not copy an arbitrary upstream error type into its error", async () => {
    globalThis.fetch = (async () => Response.json({ error_type: "caller secret body" }, { status: 400 })) as typeof fetch;
    await expect(jevClassify({ typesafe: "key" }, ["one"], labels, undefined, false)).rejects.toThrow(/typesafe 400: upstream failure/);
  });
});

/**
 * Vercel's AI Gateway serves Jev on a free credit, with the free tier's rate
 * limits on top. It goes first when its key is set; whatever it drops goes to
 * TypeSafe in the same request, and after a refusal it is left alone for a
 * while so a limited minute does not cost every request an extra round trip.
 */
describe("Jev through the AI Gateway", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    resetGatewayPause();
  });

  const gatewayAnswer = (cost?: string) => Response.json({
    answers: {
      i0: { type: "choice", choice: "bug", probabilities: { bug: 0.97, feature: 0.02, praise: 0.01 } },
      i0_0: { type: "boolean", probability: 0.91 },
    },
    usage: { inputTokens: 400, outputTokens: 12 },
    providerMetadata: { typesafe: { confidence: { i0: 0.88 } }, ...(cost !== undefined ? { gateway: { cost } } : {}) },
  });
  const typesafeAnswer = () => Response.json({
    model: "jev-1.13.0",
    answers: { i0: { choice: "feature", confidence: 0.6, probabilities: { bug: 0.3, feature: 0.6, praise: 0.1 } } },
    usage: { input_tokens: 100 },
  });

  /** Records which door each request went through and answers as told. */
  const doors = (gateway: () => Response, typesafe: () => Response = typesafeAnswer) => {
    const calls: { door: "gateway" | "typesafe"; init: RequestInit }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const door = String(url).includes("ai-gateway.vercel.sh") ? "gateway" : "typesafe";
      calls.push({ door, init: init! });
      return door === "gateway" ? gateway() : typesafe();
    }) as typeof fetch;
    return calls;
  };
  const both = { typesafe: "ts", gateway: "vck" };

  test("asks the gateway in its own vocabulary and answers in Jev's", async () => {
    const calls = doors(() => gatewayAnswer("0"));
    const meter = newMeter();
    const [r] = await jevClassify(both, ["the checkout button does nothing"], labels, undefined, false, meter);
    expect(calls.map((c) => c.door)).toEqual(["gateway"]);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["ai-model-id"]).toBe("typesafe-ai/jev");
    expect(headers.authorization).toBe("Bearer vck");
    const body = JSON.parse(String(calls[0].init.body)) as { state: unknown; questions: Record<string, { type: string; criteria?: unknown }> };
    expect(body.state).toEqual([{ id: "i0", text: "the checkout button does nothing" }]);
    expect(body.questions.i0.type).toBe("choice");
    expect(body.questions.i0.criteria).toEqual({ bug: null, feature: null, praise: null });
    // The calibrated confidence comes from the metadata, the label from the answer.
    expect(r).toEqual({ label: "bug", confidence: 0.88, scores: { bug: 0.97, feature: 0.02, praise: 0.01 }, model: "jev@vercel" });
    // What the gateway charged, which today is nothing.
    expect(meter.usd).toBe(0);
  });

  test("a yes/no question is a boolean there and a noul here", async () => {
    const calls = doors(() => Response.json({
      answers: { i0_0: { type: "boolean", probability: 0.91 }, i0_1: { type: "boolean", probability: 0.2 }, i0_2: { type: "boolean", probability: 0.05 } },
      usage: { inputTokens: 50 },
    }));
    const meter = newMeter();
    const [r] = await jevClassify(both, ["one"], labels, undefined, true, meter);
    const body = JSON.parse(String(calls[0].init.body)) as { questions: Record<string, { type: string }> };
    expect(Object.values(body.questions).map((q) => q.type)).toEqual(["boolean", "boolean", "boolean"]);
    expect(r.scores).toEqual({ bug: 0.91, feature: 0.2, praise: 0.05 });
    expect(r.label).toBe("bug");
    // No charge reported: metered at Jev's own rate rather than as free.
    expect(meter.usd).toBeCloseTo((50 * 0.042) / 1e6, 12);
  });

  test("a rate-limited gateway hands the request to TypeSafe and is skipped for a while", async () => {
    const calls = doors(() => new Response(JSON.stringify({ error: { message: "Rate limit exceeded", type: "rate_limit_exceeded" } }), { status: 429 }));
    const [first] = await jevClassify(both, ["one"], labels, undefined, false);
    expect(first.model).toBe("jev-1.13.0");
    expect(first.label).toBe("feature");
    const [second] = await jevClassify(both, ["two"], labels, undefined, false);
    expect(second.model).toBe("jev-1.13.0");
    expect(calls.map((c) => c.door)).toEqual(["gateway", "typesafe", "typesafe"]);
    resetGatewayPause();
    await jevClassify(both, ["three"], labels, undefined, false);
    expect(calls.map((c) => c.door).slice(3)).toEqual(["gateway", "typesafe"]);
  });

  test("a 400 is about the request, so the next request tries the gateway again", async () => {
    const calls = doors(() => new Response(JSON.stringify({ error: { message: "too big", type: "invalid_request_error" } }), { status: 400 }));
    await jevClassify(both, ["one"], labels, undefined, false);
    await jevClassify(both, ["two"], labels, undefined, false);
    expect(calls.map((c) => c.door)).toEqual(["gateway", "typesafe", "gateway", "typesafe"]);
  });

  test("a malformed gateway answer is not trusted", async () => {
    const calls = doors(() => Response.json({ answers: { i0: { type: "choice", choice: "nonsense", probabilities: {} } } }));
    const [r] = await jevClassify(both, ["one"], labels, undefined, false);
    expect(r.model).toBe("jev-1.13.0");
    expect(calls.map((c) => c.door)).toEqual(["gateway", "typesafe"]);
  });

  test("with no TypeSafe key the gateway is the only door and is never paused", async () => {
    const calls = doors(() => new Response(JSON.stringify({ error: { message: "card required", type: "customer_verification_required" } }), { status: 403 }));
    await expect(jevClassify({ gateway: "vck" }, ["one"], labels, undefined, false)).rejects.toThrow(/gateway 403: customer_verification_required/);
    await expect(jevClassify({ gateway: "vck" }, ["two"], labels, undefined, false)).rejects.toThrow(/gateway 403/);
    expect(calls.map((c) => c.door)).toEqual(["gateway", "gateway"]);
  });

  /** What the gateway really returns for a request over Jev's 64k tokens (probed September 2026): TypeSafe's body as a string inside its own error. */
  const tooBig = () => new Response(JSON.stringify({
    error: { message: '{"error_type":"max_tokens_exceeded"}', type: "AI_APICallError", param: { statusCode: 400, isRetryable: false } },
  }), { status: 400 });

  /** A fake gateway that refuses any request over `limit` items as too big and answers the rest. */
  const gatewayJev = (limit: number) => (init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { state: { id: string }[]; questions: Record<string, unknown> };
    if (body.state.length > limit) return tooBig();
    const answers: Record<string, unknown> = {};
    for (const qid of Object.keys(body.questions)) {
      answers[qid] = qid.includes("_")
        ? { type: "boolean", probability: 0.9 }
        : { type: "choice", choice: "bug", probabilities: { bug: 0.8, feature: 0.1, praise: 0.1 } };
    }
    return Response.json({ answers, usage: { inputTokens: 10 }, providerMetadata: { gateway: { cost: "0" } } });
  };
  /** Like `doors`, but the gateway sees the request. */
  const sizedDoors = (gateway: (init: RequestInit) => Response, typesafe: () => Response = typesafeAnswer) => {
    const calls: { door: "gateway" | "typesafe"; n: number }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const door = String(url).includes("ai-gateway.vercel.sh") ? "gateway" : "typesafe";
      calls.push({ door, n: (JSON.parse(String(init?.body)) as { state: unknown[] }).state.length });
      return door === "gateway" ? gateway(init!) : typesafe();
    }) as typeof fetch;
    return calls;
  };

  test("a batch the gateway refuses as too big is halved on the gateway, not handed to TypeSafe", async () => {
    const calls = sizedDoors(gatewayJev(3));
    const inputs = Array.from({ length: 10 }, (_, i) => `text ${i}`);
    const out = await jevClassify(both, inputs, labels, undefined, false);
    expect(out).toHaveLength(10);
    out.forEach((r) => {
      expect(r.label).toBe("bug");
      expect(r.model).toBe("jev@vercel");
    });
    // Every call went through the gateway: too big for Jev is too big either way.
    expect(calls.every((c) => c.door === "gateway")).toBe(true);
    expect(calls[0].n).toBe(10);
    expect(Math.max(...calls.slice(1).map((c) => c.n))).toBeLessThanOrEqual(5);
    expect(calls.filter((c) => c.n <= 3).reduce((a, c) => a + c.n, 0)).toBe(10);
  });

  test("halving works with the gateway alone", async () => {
    const calls = sizedDoors(gatewayJev(2));
    const out = await jevClassify({ gateway: "vck" }, ["a", "b", "c", "d"], labels, undefined, true);
    expect(out).toHaveLength(4);
    out.forEach((r) => expect(r.scores).toEqual({ bug: 0.9, feature: 0.9, praise: 0.9 }));
    expect(calls.map((c) => c.n)).toEqual([4, 2, 2]);
    expect(calls.every((c) => c.door === "gateway")).toBe(true);
  });

  test("a single input the gateway still refuses is a real failure, and the gateway is not paused for it", async () => {
    const calls = sizedDoors(gatewayJev(0));
    await expect(jevClassify({ gateway: "vck" }, ["one"], labels, undefined, false)).rejects.toThrow(/gateway 400: max_tokens_exceeded/);
    await expect(jevClassify({ gateway: "vck" }, ["two"], labels, undefined, false)).rejects.toThrow(/max_tokens_exceeded/);
    expect(calls.map((c) => c.door)).toEqual(["gateway", "gateway"]);
  });

  test("a 5xx from the gateway hands the request to TypeSafe and pauses the gateway", async () => {
    const calls = doors(() => new Response(JSON.stringify({ error: { message: "upstream unavailable", type: "AI_APICallError" } }), { status: 502 }));
    const [first] = await jevClassify(both, ["one"], labels, undefined, false);
    expect(first.model).toBe("jev-1.13.0");
    await jevClassify(both, ["two"], labels, undefined, false);
    expect(calls.map((c) => c.door)).toEqual(["gateway", "typesafe", "typesafe"]);
  });

  describe("Retry-After on a 429", () => {
    const limited = (retryAfter: string) => () =>
      new Response(JSON.stringify({ error: { message: "Rate limit exceeded", type: "rate_limit_exceeded" } }), {
        status: 429,
        headers: { "retry-after": retryAfter },
      });
    let now = 1_800_000_000_000;
    let clock: ReturnType<typeof spyOn> | undefined;
    afterEach(() => {
      clock?.mockRestore();
      clock = undefined;
    });
    const at = (ms: number) => {
      clock ??= spyOn(Date, "now");
      clock.mockImplementation(() => now + ms);
    };

    test("is honoured: the gateway is skipped for exactly as long as it asked", async () => {
      at(0);
      const calls = doors(limited("3"));
      await jevClassify(both, ["one"], labels, undefined, false);
      at(2_000);
      await jevClassify(both, ["two"], labels, undefined, false);
      expect(calls.map((c) => c.door)).toEqual(["gateway", "typesafe", "typesafe"]);
      at(3_100);
      await jevClassify(both, ["three"], labels, undefined, false);
      expect(calls.map((c) => c.door).slice(3)).toEqual(["gateway", "typesafe"]);
    });

    test("is capped at five minutes", async () => {
      at(0);
      const calls = doors(limited("3600"));
      await jevClassify(both, ["one"], labels, undefined, false);
      at(4 * 60_000);
      await jevClassify(both, ["two"], labels, undefined, false);
      expect(calls.map((c) => c.door)).toEqual(["gateway", "typesafe", "typesafe"]);
      at(5 * 60_000 + 100);
      await jevClassify(both, ["three"], labels, undefined, false);
      expect(calls.map((c) => c.door).slice(3)).toEqual(["gateway", "typesafe"]);
    });
  });

  test("jevAsk carries a mix of yes/no and choice questions through the gateway, as the skills gate sends them", async () => {
    const questions: Record<string, Question> = {
      intent: { type: "choice", instructions: "What is the intent of item `s1`?", criteria: { malicious: null, risky: null, benign: null } },
      genuine: { type: "noul", instructions: "Is item `s1` a genuine skill?" },
      spam: { type: "noul", instructions: "Is item `s1` spam?" },
    };
    const calls = doors(() => Response.json({
      answers: {
        intent: { type: "choice", choice: "benign", probabilities: { malicious: 0.01, risky: 0.04, benign: 0.95 } },
        genuine: { type: "boolean", probability: 0.88 },
        spam: { type: "boolean", probability: 0.03 },
      },
      usage: { inputTokens: 120 },
      providerMetadata: { typesafe: { confidence: { intent: 0.93 } }, gateway: { cost: "0" } },
    }));
    const { model, answers } = await jevAsk(both, [{ id: "s1", text: "# Deploy\n\nRun `npm run deploy`." }], questions);
    expect(calls.map((c) => c.door)).toEqual(["gateway"]);
    const body = JSON.parse(String(calls[0].init.body)) as { questions: Record<string, { type: string; criteria?: unknown }> };
    expect(body.questions.intent.type).toBe("choice");
    expect(body.questions.intent.criteria).toEqual({ malicious: null, risky: null, benign: null });
    expect(body.questions.genuine).toEqual({ type: "boolean", instructions: "Is item `s1` a genuine skill?" });
    expect(body.questions.spam.type).toBe("boolean");
    expect(model).toBe("jev@vercel");
    expect(answers.intent).toEqual({ choice: "benign", confidence: 0.93, probabilities: { malicious: 0.01, risky: 0.04, benign: 0.95 } });
    expect(answers.genuine).toEqual({ noul: 0.88 });
    expect(answers.spam).toEqual({ noul: 0.03 });
  });

  test("a gateway confidence that is not a probability is replaced by the chosen option's own", async () => {
    doors(() => Response.json({
      answers: { i0: { type: "choice", choice: "bug", probabilities: { bug: 0.97, feature: 0.02, praise: 0.01 } } },
      usage: { inputTokens: 40 },
      providerMetadata: { typesafe: { confidence: { i0: "high" } } },
    }));
    const [r] = await jevClassify(both, ["one"], labels, undefined, false);
    expect(r.confidence).toBe(0.97);
    expect(r.model).toBe("jev@vercel");
  });

  test("rollback bypasses the gateway while retaining TypeSafe and telemetry", async () => {
    const points: any[] = [];
    const analytics = { writeDataPoint: (p: unknown) => points.push(p) } as unknown as AnalyticsEngineDataset;
    const keys = jevKeys({ TYPESAFE_API_KEY: "ts", AI_GATEWAY_API_KEY: "vck", AI_GATEWAY_DISABLED: "true", JEV_AE: analytics })!;
    const calls = doors(() => gatewayAnswer("0"));
    await jevClassify(keys, ["private input"], labels, undefined, false);
    expect(calls.map((c) => c.door)).toEqual(["typesafe"]);
    expect(points[0].blobs).toEqual(["typesafe", "success", ""]);
    expect(JSON.stringify(points)).not.toContain("private input");
    expect(jevKeys({ AI_GATEWAY_API_KEY: "vck", AI_GATEWAY_DISABLED: "true" })).toBeNull();
  });

  test("a recovered gateway failure and a later cooldown skip remain distinct events", async () => {
    const points: any[] = [];
    const analytics = { writeDataPoint: (p: unknown) => points.push(p) } as unknown as AnalyticsEngineDataset;
    doors(() => Response.json({ error: { type: "private_customer_text", message: "private input" } }, { status: 429 }));
    const keys = { ...both, analytics };
    await jevClassify(keys, ["private input"], labels, undefined, false);
    await jevClassify(keys, ["private input"], labels, undefined, false);
    expect(points.map((p) => p.blobs)).toEqual([
      ["gateway", "failure", "rate_limit"], ["typesafe", "success", ""],
      ["gateway", "skipped", "cooldown"], ["typesafe", "success", ""],
    ]);
    expect(points[0].doubles[0]).toBe(429);
    expect(points[0].doubles.slice(2)).toEqual([1, 1]);
    expect(JSON.stringify(points)).not.toContain("private");
  });

  test("TypeSafe retries record failures even when the final attempt succeeds", async () => {
    const points: any[] = [];
    const analytics = { writeDataPoint: (p: unknown) => points.push(p) } as unknown as AnalyticsEngineDataset;
    let attempt = 0;
    doors(() => gatewayAnswer("0"), () => ++attempt === 1 ? new Response("bad", { status: 503 }) : typesafeAnswer());
    await jevClassify({ typesafe: "ts", analytics }, ["one"], labels, undefined, false);
    expect(points.map((p) => p.blobs)).toEqual([["typesafe", "failure", "upstream_error"], ["typesafe", "success", ""]]);
    expect(points.map((p) => p.doubles[3])).toEqual([1, 2]);
  });

  test("telemetry failure cannot break a successful classification", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      doors(() => gatewayAnswer("0"));
      const analytics = { writeDataPoint: () => { throw new Error("unavailable"); } } as unknown as AnalyticsEngineDataset;
      const [result] = await jevClassify({ ...both, analytics }, ["one"], labels, undefined, false);
      expect(result.model).toBe("jev@vercel");
      expect(warning).toHaveBeenCalledWith("jev_analytics_write_failed");
    } finally { warning.mockRestore(); }
  });

  test("the keys come from the environment, and neither means no Jev", () => {
    expect(jevKeys({})).toBeNull();
    expect(jevKeys({ TYPESAFE_API_KEY: "t" })).toEqual({ typesafe: "t", gateway: undefined });
    expect(jevKeys({ AI_GATEWAY_API_KEY: "v" })).toEqual({ typesafe: undefined, gateway: "v" });
  });
});
