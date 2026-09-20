import { describe, expect, test } from "bun:test";

import { JEV_USD_PER_MTOK, newMeter, addJevCost, addUsd } from "../src/cost";

test("JEV_USD_PER_MTOK is the published rate", () => {
  expect(JEV_USD_PER_MTOK).toBe(0.042);
});

test("newMeter starts at zero", () => {
  expect(newMeter()).toEqual({ usd: 0 });
});

describe("addJevCost", () => {
  test("adds the correct amount for a token count", () => {
    const m = newMeter();
    addJevCost(m, 1_000_000);
    expect(m.usd).toBeCloseTo(JEV_USD_PER_MTOK, 10);
  });

  test("accumulates across calls", () => {
    const m = newMeter();
    addJevCost(m, 500_000);
    addJevCost(m, 500_000);
    expect(m.usd).toBeCloseTo(JEV_USD_PER_MTOK, 10);
  });

  test("ignores NaN, Infinity, negative, zero, and non-numbers", () => {
    const m = newMeter();
    for (const bad of [NaN, Infinity, -Infinity, -1, 0, "abc", null, undefined, false]) {
      addJevCost(m, bad);
    }
    expect(m.usd).toBe(0);
  });

  test("ignores undefined meter", () => {
    expect(() => addJevCost(undefined, 1000)).not.toThrow();
  });

  test("accepts numeric strings", () => {
    const m = newMeter();
    addJevCost(m, "1000000");
    expect(m.usd).toBeCloseTo(JEV_USD_PER_MTOK, 10);
  });
});

describe("addUsd", () => {
  test("adds the exact amount", () => {
    const m = newMeter();
    addUsd(m, 0.05);
    expect(m.usd).toBe(0.05);
  });

  test("accumulates across calls", () => {
    const m = newMeter();
    addUsd(m, 0.01);
    addUsd(m, 0.02);
    expect(m.usd).toBeCloseTo(0.03, 10);
  });

  test("ignores NaN, Infinity, negative, zero, and non-numbers", () => {
    const m = newMeter();
    for (const bad of [NaN, Infinity, -Infinity, -1, 0, "nope", null, undefined, false]) {
      addUsd(m, bad);
    }
    expect(m.usd).toBe(0);
  });

  test("ignores undefined meter", () => {
    expect(() => addUsd(undefined, 1)).not.toThrow();
  });

  test("accepts numeric strings", () => {
    const m = newMeter();
    addUsd(m, "0.25");
    expect(m.usd).toBe(0.25);
  });
});
