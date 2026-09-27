import { describe, expect, test } from "bun:test";
import {
  aggregate,
  membershipGroups,
  membershipWeight,
  readMarketRequest,
  runVotes,
  samplePanel,
  seededRandom,
  voteBatches,
  type MarketRequest,
  type PanelMember,
  type Vote,
} from "../src/market";
import type { JevAnswer } from "../src/jev";

const options = [
  { id: "a", content: "Ask your users before you ship." },
  { id: "b", content: "The data layer for AI agents." },
];
const request: MarketRequest = { audience: "US software developers", options, decision: "Which tagline is stronger?", population: 100 };

describe("readMarketRequest", () => {
  test("fills ids, decision, and population", () => {
    const parsed = readMarketRequest({ audience: "devs", options: ["one", "two"] });
    expect(parsed.options.map((option) => option.id)).toEqual(["a", "b"]);
    expect(parsed.population).toBe(500);
    expect(parsed.decision).toContain("appealing");
  });

  test("rejects missing audience, bad counts, oversized options, and bad population", () => {
    expect(() => readMarketRequest({ options: ["x", "y"] })).toThrow("audience");
    expect(() => readMarketRequest({ audience: "devs", options: ["only"] })).toThrow("2-4");
    expect(() => readMarketRequest({ audience: "devs", options: ["x".repeat(2001), "y"] })).toThrow("2000");
    expect(() => readMarketRequest({ audience: "devs", options: ["x", "y"], population: 7 })).toThrow("between");
    expect(() => readMarketRequest({ audience: "devs", options: [{ id: "a", content: "x" }, { id: "a", content: "y" }] })).toThrow("Duplicate");
  });
});

describe("panel sampling", () => {
  test("is deterministic for a seed and honours the weight floor", () => {
    const candidates = Array.from({ length: 500 }, (_, i) => ({ id: i, weight: i % 7 === 0 ? 0.05 : 0.3 + (i % 10) / 20 }));
    const first = samplePanel(candidates, 100, "aud_x");
    const second = samplePanel(candidates, 100, "aud_x");
    expect(first.map((m) => m.id)).toEqual(second.map((m) => m.id));
    expect(first).toHaveLength(100);
    expect(first.every((m) => m.weight >= 0.15)).toBe(true);
    expect(samplePanel(candidates, 100, "aud_y").map((m) => m.id)).not.toEqual(first.map((m) => m.id));
  });

  test("seededRandom streams differ by seed and repeat by seed", () => {
    const a = seededRandom("one");
    const b = seededRandom("one");
    const c = seededRandom("two");
    const roll = (f: () => number) => Array.from({ length: 5 }, f);
    expect(roll(a)).toEqual(roll(b));
    expect(roll(seededRandom("two"))).toEqual(roll(c));
  });
});

describe("membership", () => {
  test("groups carry one score question per candidate", () => {
    const groups = membershipGroups("US nurses", [{ id: 7, text: "a nurse in Ohio" }]);
    expect(groups).toHaveLength(1);
    const question = Object.values(groups[0].questions)[0];
    expect(question.type).toBe("score");
    if (question.type === "score") expect(question.criteria).toHaveLength(4);
    expect(question.instructions).toContain("p7");
    expect(question.instructions).toContain("US nurses");
  });

  test("weight blends squarely and plausibly and survives missing answers", () => {
    expect(membershipWeight({ score: 2.8, confidence: 0.9, probabilities: { "0": 0, "1": 0, "2": 0.2, "3": 0.8 } })).toBeCloseTo(0.9);
    expect(membershipWeight({ score: 0.2, confidence: 0.9, probabilities: { "0": 0.9, "1": 0.1, "2": 0, "3": 0 } })).toBe(0);
    expect(membershipWeight(undefined)).toBe(0);
  });
});

describe("voteBatches", () => {
  test("shares options through state and counterbalances criteria order", () => {
    const panel = Array.from({ length: 90 }, (_, i) => ({ id: i, text: `person ${i}` }));
    const batches = voteBatches(options, panel, "Which is stronger?");
    expect(batches.length).toBe(3);
    for (const batch of batches) {
      expect(batch.state[0].id).toBe("option_a");
      expect(batch.state[1].id).toBe("option_b");
    }
    const orders = new Set<string>();
    for (const batch of batches) {
      for (const question of Object.values(batch.questions)) {
        if (question.type === "choice") orders.add(Object.keys(question.criteria).join(","));
      }
    }
    expect(orders).toEqual(new Set(["option_a,option_b", "option_b,option_a"]));
  });
});

describe("runVotes", () => {
  const panel = Array.from({ length: 8 }, (_, i) => ({ id: i, text: `person ${i}` }));

  test("collects votes and maps criteria back to option ids", async () => {
    const batches = voteBatches(options, panel, "Which?");
    const { votes, failedRespondents } = await runVotes({} as never, batches, options, undefined, async (_keys, _state, questions) => ({
      model: "test",
      answers: Object.fromEntries(Object.keys(questions).map((id) => [
        id, { choice: "option_b", confidence: 0.8, probabilities: { option_a: 0.2, option_b: 0.8 } } satisfies JevAnswer,
      ])),
    }));
    expect(failedRespondents).toBe(0);
    expect(votes).toHaveLength(8);
    expect(new Set(votes.map((vote) => vote.option))).toEqual(new Set(["b"]));
    expect(new Set(votes.map((vote) => vote.position))).toEqual(new Set(["forward", "reversed"]));
  });

  test("halves failed batches so one bad request only costs its own respondents", async () => {
    const batches = voteBatches(options, panel, "Which?");
    let calls = 0;
    const { votes, failedRespondents } = await runVotes({} as never, batches, options, undefined, async (_keys, state, questions) => {
      calls++;
      const personas = state.filter((item) => item.id.startsWith("p"));
      if (personas.some((item) => item.id === "p3") && personas.length > 1) throw new Error("boom");
      return {
        model: "test",
        answers: Object.fromEntries(Object.keys(questions).map((id) => [
          id, { choice: "option_a", confidence: 0.7, probabilities: { option_a: 0.7, option_b: 0.3 } } satisfies JevAnswer,
        ])),
      };
    });
    expect(calls).toBeGreaterThan(1);
    expect(votes.length + failedRespondents).toBe(8);
    expect(failedRespondents).toBeLessThanOrEqual(1);
    for (const batchVote of votes) expect(batchVote.option).toBe("a");
  });
});

describe("aggregate", () => {
  function buildPanel(n: number): Map<number, PanelMember> {
    const panel = new Map<number, PanelMember>();
    for (let i = 0; i < n; i++) {
      panel.set(i, {
        id: i, weight: 1,
        attrs: { age_band: i < n / 2 ? "25-34" : "55-64", sex: i % 2 ? "male" : "female", education: "some college", region: "West", marital: "single" },
      });
    }
    return panel;
  }

  test("weighted shares, interval, position bias, and segments", () => {
    const panel = buildPanel(200);
    const votes: Vote[] = [...panel.values()].map((member, index) => {
      const prefersB = member.attrs.age_band === "25-34" ? index % 10 < 8 : index % 2 === 0;
      return {
        personaId: member.id,
        option: prefersB ? "b" : "a",
        confidence: 0.8,
        position: (index % 2 === 0 ? "forward" : "reversed") as Vote["position"],
        probabilities: prefersB ? { a: 0.2, b: 0.8 } : { a: 0.8, b: 0.2 },
      };
    });
    const result = aggregate(request, "aud_1", 1500, panel, votes);
    expect(result.answered).toBe(200);
    expect(result.preference.a + result.preference.b).toBeCloseTo(1, 5);
    expect(result.preference.b).toBeGreaterThan(0.5);
    expect(result.interval.b[0]).toBeLessThan(result.preference.b);
    expect(result.interval.b[1]).toBeGreaterThan(result.preference.b);
    expect(result.effective_sample_size).toBe(200);
    expect(result.position_bias).not.toBeNull();
    const ageRows = result.segments.filter((segment) => segment.attribute === "age_band");
    expect(ageRows.length).toBeGreaterThan(0);
    const young = ageRows.find((segment) => segment.value === "25-34");
    const old = ageRows.find((segment) => segment.value === "55-64");
    if (young && old) expect(young.preference.b).toBeGreaterThan(old.preference.b);
  });

  test("unequal weights shrink the effective sample size", () => {
    const panel = buildPanel(100);
    for (const member of panel.values()) member.weight = member.id % 2 ? 1 : 0.2;
    const votes: Vote[] = [...panel.values()].map((member) => ({
      personaId: member.id, option: "a", confidence: 0.9, position: "forward" as const, probabilities: { a: 1, b: 0 },
    }));
    const result = aggregate(request, "aud_2", 900, panel, votes);
    expect(result.effective_sample_size).toBeLessThan(100);
    expect(result.preference.a).toBe(1);
  });
});

describe("account MCP server", () => {
  test("exposes the market tool exactly when a market callback is wired", async () => {
    const { productServer } = await import("../src/mcp");
    const noop = async () => ({ status: 200, body: {} });
    expect(productServer(noop, noop).tools.map((tool) => tool.name)).toContain("compare_market_preference");
    expect(productServer(noop).tools.map((tool) => tool.name)).not.toContain("compare_market_preference");
    // The account layer passes that callback; a regression here silently
    // serves the free five-tool list to paying MCP clients.
    const source = await Bun.file(new URL("../src/http/mcp.ts", import.meta.url)).text();
    expect(source).toContain("}, marketFn),");
  });
});
