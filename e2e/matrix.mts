import assert from "node:assert/strict";

export type Dimensions = Record<string, readonly string[] | { labels: readonly string[]; instructions?: string }>;
type Labels<D> = D extends readonly string[] ? D[number] : D extends { labels: readonly string[] } ? D["labels"][number] : never;
type Field<L extends string> = {
  label: L; model: string; ms: number; escalated?: boolean;
} & (
  | { confidence: number; scores: Record<L, number>; unscored?: never }
  | { confidence: null; scores: null; unscored: string }
);
export type Matrix<D extends Dimensions> = {
  tier: "fast" | "smart";
  model: string;
  modelsUsed: string[];
  results: { dimensions: { [K in keyof D]: Field<Labels<D[K]>> } }[];
  usage: { items: number; dimensions: number; classifications: number; escalated: number; fallback: number; ms: number; escalation_failed?: number };
};

export function record(value: unknown): asserts value is Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "expected an object");
}
function probability(value: unknown): asserts value is number {
  assert.ok(typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1, "invalid probability");
}
function count(value: unknown): asserts value is number {
  assert.ok(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, "invalid count or latency");
}
function nonempty(value: unknown): asserts value is string {
  assert.ok(typeof value === "string" && value.trim().length > 0, "expected a nonempty string");
}

/** Validate untrusted JSON before narrowing it to the caller's dimension and label types. */
export function assertMatrix<D extends Dimensions>(value: unknown, items: number, dimensions: D, tier: "fast" | "smart" = "fast"): asserts value is Matrix<D> {
  record(value);
  assert.equal(value.tier, tier);
  nonempty(value.model);
  assert.ok(Array.isArray(value.modelsUsed));
  value.modelsUsed.forEach(nonempty);
  assert.ok(Array.isArray(value.results));
  assert.equal(value.results.length, items);
  const names = Object.keys(dimensions);
  const models = new Set<string>();
  let escalated = 0;
  for (const row of value.results) {
    record(row); record(row.dimensions);
    assert.deepEqual(Object.keys(row.dimensions).sort(), [...names].sort(), "missing or unexpected dimension");
    for (const name of names) {
      const definition = dimensions[name]!;
      const labels: readonly string[] = "labels" in definition ? definition.labels : definition;
      const field: unknown = row.dimensions[name];
      record(field);
      nonempty(field.label); nonempty(field.model); count(field.ms);
      assert.ok(labels.includes(field.label), `unexpected label for ${name}`);
      models.add(field.model);
      if (field.escalated !== undefined) assert.equal(typeof field.escalated, "boolean");
      if (field.escalated) {
        assert.equal(tier, "smart");
        assert.equal(field.confidence, null, "escalation must not retain stale confidence");
        escalated++;
      }
      if (field.confidence === null) {
        assert.equal(field.scores, null);
        nonempty(field.unscored);
      } else {
        probability(field.confidence); record(field.scores);
        assert.equal(field.unscored, undefined);
        assert.deepEqual(Object.keys(field.scores).sort(), [...labels].sort(), "scores must cover exactly the supplied labels");
        let total = 0;
        for (const score of Object.values(field.scores)) { probability(score); total += score; }
        assert.ok(Math.abs(total - 1) < 0.01, "probabilities must sum to one");
      }
    }
  }
  assert.deepEqual([...value.modelsUsed].sort(), [...models].sort());
  assert.equal(value.model, models.size === 1 ? [...models][0] : "mixed");
  record(value.usage);
  assert.equal(value.usage.items, items);
  assert.equal(value.usage.dimensions, names.length);
  assert.equal(value.usage.classifications, items * names.length);
  assert.equal(value.usage.escalated, escalated);
  count(value.usage.ms); count(value.usage.fallback);
  assert.ok(value.usage.fallback <= items * names.length);
  if (value.usage.escalation_failed !== undefined) {
    count(value.usage.escalation_failed);
    assert.ok(value.usage.escalation_failed <= items * names.length - escalated);
  }
}
