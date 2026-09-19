import {
  JevContextError,
  prepareJevBatches,
  runJevBatches,
  type JevBatch,
  type JevKeys,
  type JevQuestionGroup,
  type JevResult,
  type Question,
} from "./jev";
import type { Meter } from "./cost";

export type Dimension = { name: string; labels: string[]; instructions?: string };
export const MAX_DIMENSIONS = 20;
export const MAX_DECISIONS = 1000;

const labelsSchema = { type: "array", minItems: 2, maxItems: 100, uniqueItems: true,
  items: { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" } };
export const DIMENSIONS_SCHEMA = {
  type: "object", minProperties: 1, maxProperties: MAX_DIMENSIONS,
  propertyNames: { minLength: 1, maxLength: 64, pattern: "\\S" },
  description: "Named dimensions. Each is a label array or {labels, instructions}. At most 1,000 item × dimension decisions; definitions at most 16,000 characters combined.",
  additionalProperties: { oneOf: [labelsSchema, {
    type: "object", required: ["labels"], additionalProperties: false,
    properties: { labels: labelsSchema, instructions: { type: "string", maxLength: 4000 } },
  }] },
};

export class DimensionError extends Error {}

/** Keep the public shorthand small; an object adds a rubric for ambiguous labels. */
export function readDimensions(value: unknown): Dimension[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DimensionError("dimensions must be an object");
  const entries = Object.entries(value);
  if (!entries.length || entries.length > MAX_DIMENSIONS) throw new DimensionError(`Provide 1-${MAX_DIMENSIONS} dimensions`);
  if (JSON.stringify(value).length > 16000) throw new DimensionError("Dimension definitions must fit within 16,000 characters");
  return entries.map(([name, v]) => {
    if (!name.trim() || name.length > 64) throw new DimensionError("Dimension names must be non-empty and at most 64 characters");
    const config = !Array.isArray(v) && v && typeof v === "object" ? v as Record<string, unknown> : null;
    if (config && Object.keys(config).some((k) => k !== "labels" && k !== "instructions")) throw new DimensionError("A dimension accepts only labels and instructions");
    const labels = config ? config.labels : v;
    if (!Array.isArray(labels) || labels.length < 2 || labels.length > 100 ||
        labels.some((l) => typeof l !== "string" || !l.trim() || l.length > 200) || new Set(labels).size !== labels.length) {
      throw new DimensionError("Each dimension needs 2-100 distinct, non-empty labels of at most 200 characters");
    }
    const instructions = config?.instructions;
    if (instructions !== undefined && (typeof instructions !== "string" || instructions.length > 4000)) throw new DimensionError("Dimension instructions must be a string of at most 4,000 characters");
    return { name, labels, instructions: instructions as string | undefined };
  });
}

export function dimensionInstructions(d: Dimension, shared?: string) {
  return [`Classify the dimension ${JSON.stringify(d.name)}.`, shared, d.instructions].filter(Boolean).join(" ");
}

type Cell = { item: number; dimension: number; id: string; question: Extract<Question, { type: "choice" }> };
export type DimensionBatch = JevBatch<Cell>;

/** State is shared across questions. Respect BOTH Jev context limits, with headroom. */
export function packDimensions(inputs: string[], dimensions: Dimension[], shared?: string): DimensionBatch[] {
  const groups: JevQuestionGroup<Cell>[] = [];
  inputs.forEach((text, item) => dimensions.forEach((d, dimension) => {
      const question: Question = {
        type: "choice",
        instructions: `Which category does item i${item} belong to? Use only that item's text, ignoring other items in the state. ${dimensionInstructions(d, shared)}`,
        criteria: Object.fromEntries(d.labels.map((l) => [l, null])),
      };
      const cell = { item, dimension, id: `i${item}_d${dimension}`, question };
      groups.push({ state: { id: `i${item}`, text }, questions: { [cell.id]: question }, value: cell });
    }));
  try {
    return prepareJevBatches(groups, { rejectOversized: true });
  } catch (error) {
    if (error instanceof JevContextError) {
      throw new DimensionError("An input and dimension exceed Jev's context budget; shorten the input or dimension instructions");
    }
    throw error;
  }
}

/** One result per matrix cell. Splitting by question also handles a single wide item. */
export async function classifyDimensions(keys: JevKeys, batches: DimensionBatch[], meter?: Meter): Promise<JevResult[][]> {
  const results: JevResult[][] = [];
  for (const { value: cell, model, answers } of await runJevBatches(keys, batches, meter)) {
    const answer = answers[cell.id]; // The shared runner validates every answer before returning.
    (results[cell.item] ??= [])[cell.dimension] = {
      label: answer.choice!, confidence: answer.confidence!,
      scores: Object.fromEntries(Object.keys(cell.question.criteria).map((label) => [label, answer.probabilities![label]])),
      model,
    };
  }
  return results;
}
