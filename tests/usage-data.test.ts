import { describe, expect, test } from "bun:test";
import type { UsageAggregate } from "../src/server/contracts";
import {
  dailyUsage,
  hourlyUsage,
  filterUsage,
  summarizeUsage,
  tokenTotal,
  usageBreakdown,
  usageRange,
} from "../src/features/usage/usage-data";

const row = (overrides: Partial<UsageAggregate> = {}): UsageAggregate => ({
  day: "2026-09-20",
  hour: "2026-09-20T00:00:00Z",
  keyId: "key_a",
  keyName: "Production",
  type: "API · Single-label",
  credits: 1,
  requests: 1,
  items: 1,
  inputTokens: null,
  outputTokens: null,
  ...overrides,
});

describe("usage reporting", () => {
  test("counts the full aggregate set, independent of the request log cap", () => {
    const rows = Array.from({ length: 150 }, () => row());
    expect(summarizeUsage(rows).requests).toBe(150);
    expect(usageBreakdown(rows, "key")[0].credits).toBe(150);
    expect(dailyUsage(rows, ["2026-09-20"])[0].spend).toBe(0.0015);
  });
  test("filters by UTC calendar range, credential, and classification type", () => {
    const range = usageRange(7, new Date("2026-09-20T23:59:59Z"));
    expect(range.start).toBe("2026-09-14");
    const rows = [
      row(),
      row({ day: "2026-09-13" }),
      row({ keyId: "key_b" }),
      row({ type: "MCP · Multi-label" }),
      row({ day: "2026-09-21" }),
    ];
    expect(filterUsage(rows, range, "key_a", "API · Single-label")).toEqual([
      rows[0],
    ]);
    expect(filterUsage(rows, range, "all", "all")).toHaveLength(3);
  });
  test("never treats unreported tokens as zero, including mixed reporting", () => {
    const totals = summarizeUsage([
      row({ inputTokens: 10, outputTokens: 2 }),
      row(),
    ]);
    expect(tokenTotal(totals)).toBeNull();
    expect(dailyUsage([row()], ["2026-09-19", "2026-09-20"])).toMatchObject([
      { tokens: 0 },
      { tokens: null },
    ]);
    expect(
      tokenTotal(summarizeUsage([row({ inputTokens: 10, outputTokens: 2 })])),
    ).toBe(12);
  });
  test("groups deleted keys and request types without conflating their identities", () => {
    const rows = [
      row(),
      row({ keyId: "deleted", keyName: "Old key", credits: 3 }),
      row({ type: "MCP · Multi-label", credits: 2 }),
    ];
    expect(
      usageBreakdown(rows, "key").map((group) => [group.name, group.credits]),
    ).toEqual([
      ["Production", 3],
      ["Old key", 3],
    ]);
    expect(usageBreakdown(rows, "type").map((group) => group.name)).toEqual([
      "API · Single-label",
      "MCP · Multi-label",
    ]);
  });
});

describe("hourly usage", () => {
  test("fills UTC hours across midnight without inventing future hours", () => {
    const now = new Date("2026-09-20T00:35:00Z");
    const range = usageRange(2, now);
    const result = hourlyUsage(
      [
        row({ day: "2026-09-19", hour: "2026-09-19T23:00:00Z", credits: 3 }),
        row({ hour: "2026-09-20T00:00:00Z", credits: 7 }),
      ],
      range,
      now,
    );
    expect(result).toHaveLength(25);
    expect(result[0]).toEqual({
      day: "2026-09-19T00:00:00Z",
      spend: 0,
      requests: 0,
      tokens: 0,
    });
    expect(result[23]).toMatchObject({
      day: "2026-09-19T23:00:00Z",
      spend: 0.00003,
      requests: 1,
      tokens: null,
    });
    expect(result[24]).toMatchObject({
      day: "2026-09-20T00:00:00Z",
      spend: 0.00007,
      requests: 1,
    });
  });
  test("timezone offsets and DST still produce UTC hours", () => {
    const now = new Date("2026-11-01T01:30:00-08:00");
    const result = hourlyUsage([], usageRange(1, now), now);
    expect(result).toHaveLength(10);
    expect(result.at(-1)?.day).toBe("2026-11-01T09:00:00Z");
  });
  test("hourly and daily totals match for filtered keys and types", () => {
    const now = new Date("2026-09-20T14:05:00Z");
    const range = usageRange(1, now);
    const rows = [
      row({ credits: 3, inputTokens: 10, outputTokens: 2 }),
      row({
        hour: "2026-09-20T14:00:00Z",
        credits: 7,
        inputTokens: 20,
        outputTokens: 4,
      }),
      row({ keyId: "key_b", credits: 99 }),
      row({ type: "MCP", credits: 88 }),
    ];
    const filtered = filterUsage(rows, range, "key_a", "API · Single-label");
    const hours = hourlyUsage(filtered, range, now);
    const day = dailyUsage(filtered, range.dates)[0];
    expect(hours.reduce((total, point) => total + point.spend, 0)).toBeCloseTo(
      day.spend,
    );
    expect(hours.reduce((total, point) => total + point.requests, 0)).toBe(
      day.requests,
    );
    expect(hours.reduce((total, point) => total + (point.tokens ?? 0), 0)).toBe(
      day.tokens!,
    );
    expect(hours[14].tokens).toBe(24);
  });
});
