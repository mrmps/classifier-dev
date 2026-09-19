import { expect, test } from "bun:test";
import { assertMatrix } from "../e2e/matrix.mts";

const dimensions = { team: ["billing", "platform"] } as const;
const field = { label: "billing", confidence: 0.9, scores: { billing: 0.9, platform: 0.1 }, model: "jev-test", ms: 10 };
const valid = {
  tier: "fast", model: "jev-test", modelsUsed: ["jev-test"],
  results: [{ dimensions: { team: field } }],
  usage: { items: 1, dimensions: 1, classifications: 1, escalated: 0, fallback: 0, ms: 10 },
};
test("live contract accepts a complete scored response", () => {
  expect(() => assertMatrix(valid, 1, dimensions)).not.toThrow();
});
const corruptFields = [
  { ...field, label: "unknown" },
  { ...field, scores: { billing: 1 } },
  { ...field, scores: { billing: 0.9, platform: 0.9 } },
  { ...field, scores: { billing: NaN, platform: 0.1 } },
  { ...field, confidence: null, scores: null },
  { ...field, confidence: 2 },
  { ...field, ms: -1 },
];
for (const [i, corrupt] of corruptFields.entries()) test(`live contract rejects corrupt field ${i}`, () => {
  const data = { ...valid, results: [{ dimensions: { team: corrupt } }] };
  expect(() => assertMatrix(data, 1, dimensions)).toThrow();
});
test("live contract rejects missing dimensions and wrong decision counts", () => {
  expect(() => assertMatrix({ ...valid, results: [{ dimensions: {} }] }, 1, dimensions)).toThrow();
  expect(() => assertMatrix({ ...valid, usage: { ...valid.usage, classifications: 0 } }, 1, dimensions)).toThrow();
});
test("live contract rejects stale scores after escalation", () => {
  const data = { ...valid, tier: "smart", results: [{ dimensions: { team: { ...field, escalated: true } } }], usage: { ...valid.usage, escalated: 1 } };
  expect(() => assertMatrix(data, 1, dimensions, "smart")).toThrow();
});
