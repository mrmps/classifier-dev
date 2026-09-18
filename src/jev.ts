/**
 * TypeSafe's Jev, the model behind both tiers.
 *
 * Jev is not a language model prompted to classify; it is a decision model
 * that returns a calibrated probability per option. That changes the shape of
 * everything upstream of it:
 *
 *   - Many items ride in one request. State is an array of {id, text} and each
 *     item gets its own question, so a thousand short inputs cost one round
 *     trip (~1.5s) instead of a thousand. Measured: 100 items packed scored
 *     the same as 100 sent one at a time (0.72 vs 0.69 on six-way emotion).
 *   - Multi-label is one yes/no question per label, read straight off the
 *     probabilities. No chunking, no second pass: F1 0.879 on the seven-case
 *     set against 0.799 for the LLM cascade it replaces, in 200ms.
 *   - `confidence` means something. On six-way emotion, answers above 0.9
 *     were right 82% of the time and answers below 0.5 were right 29%, which
 *     is what lets the smart tier hand only the uncertain ones to a reasoning
 *     model.
 *
 * Limits, from the model card: 64k tokens per request across state and
 * questions, 32k for state plus the longest question. Requests are packed to
 * a conservative budget and run concurrently.
 */

import { addJevCost, type Meter } from "./cost";

const API = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

// Tokens per request, kept well under the documented 64k because the count
// here is an estimate. Per-item overhead was fitted from real usage figures.
const TOKEN_BUDGET = 48_000;
const MAX_ITEMS = 1000;
const CONCURRENCY = 8;
const est = (s: string) => Math.ceil(s.length / 3.5) + 1;

/** Below this a multi-label yes/no does not count. 0.7 maximised F1 on the eval set. */
export const MULTI_THRESHOLD = 0.7;

export type JevResult = {
  label: string;
  confidence: number;
  /** Probability per label; sums to 1 for single-label, independent per label for multi. */
  scores: Record<string, number>;
  model: string;
};

type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, null> }
  | { type: "noul"; instructions: string };

type Packed = { start: number; items: { id: string; text: string }[]; questions: Record<string, Question> };

function questionsFor(id: string, labels: string[], instructions: string | undefined, multi: boolean) {
  const extra = instructions ? ` ${instructions.trim()}` : "";
  const out: Record<string, Question> = {};
  if (multi) {
    labels.forEach((l, i) => {
      out[`${id}_${i}`] = {
        type: "noul",
        instructions:
          `Does the category "${l}" apply to item \`${id}\`? ` +
          `A category applies if the text meaningfully touches it, even briefly.${extra}`,
      };
    });
  } else {
    out[id] = {
      type: "choice",
      instructions: `Which category does item \`${id}\` belong to?${extra}`,
      criteria: Object.fromEntries(labels.map((l) => [l, null])),
    };
  }
  return out;
}

/** Greedy packing: fill each request up to the token budget, in input order. */
function pack(inputs: string[], labels: string[], instructions: string | undefined, multi: boolean): Packed[] {
  const labelTokens = labels.reduce((n, l) => n + est(l), 0);
  const instrTokens = instructions ? est(instructions) : 0;
  const perItemQuestions = multi
    ? labels.length * (36 + instrTokens) + labelTokens
    : 25 + 16 * labels.length + labelTokens + instrTokens;

  const out: Packed[] = [];
  let cur: Packed | null = null;
  let used = 0;
  inputs.forEach((text, i) => {
    const cost = est(text) + perItemQuestions;
    if (!cur || used + cost > TOKEN_BUDGET || cur.items.length >= MAX_ITEMS) {
      cur = { start: i, items: [], questions: {} };
      out.push(cur);
      used = 0;
    }
    const id = `i${i}`;
    cur.items.push({ id, text });
    Object.assign(cur.questions, questionsFor(id, labels, instructions, multi));
    used += cost;
  });
  return out;
}

async function post(key: string, body: unknown, meter?: Meter) {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(API, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      model?: string;
      answers?: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number }>;
      usage?: { input_tokens?: number };
      detail?: unknown;
    };
    if (res.ok && payload.answers) {
      // Only a call that answered is billed; a retried 429 is not.
      addJevCost(meter, payload.usage?.input_tokens);
      return payload as Required<Pick<typeof payload, "model" | "answers">>;
    }
    last = `typesafe ${res.status}: ${JSON.stringify(payload.detail ?? payload).slice(0, 200)}`;
    // 429 and 529 are the documented "back off and retry" statuses.
    if (res.status !== 429 && res.status !== 529 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 200));
  }
  throw new Error(last);
}

export async function jevClassify(
  key: string,
  inputs: string[],
  labels: string[],
  instructions: string | undefined,
  multi: boolean,
  meter?: Meter,
): Promise<JevResult[]> {
  const batches = pack(inputs, labels, instructions, multi);
  const out: JevResult[] = new Array(inputs.length);

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) {
        const b = batches[next++];
        const res = await post(key, { state: b.items, model: MODEL, questions: b.questions }, meter);
        b.items.forEach((item, k) => {
          const i = b.start + k;
          if (multi) {
            const scores: Record<string, number> = {};
            labels.forEach((l, li) => {
              scores[l] = Number((res.answers[`${item.id}_${li}`]?.noul ?? 0).toFixed(4));
            });
            const best = labels.reduce((a, l) => (scores[l] > scores[a] ? l : a), labels[0]);
            out[i] = { label: best, confidence: scores[best], scores, model: res.model };
          } else {
            const a = res.answers[item.id];
            const scores: Record<string, number> = {};
            for (const l of labels) scores[l] = Number((a?.probabilities?.[l] ?? 0).toFixed(4));
            out[i] = {
              label: a?.choice && labels.includes(a.choice) ? a.choice : labels[0],
              confidence: Number((a?.confidence ?? 0).toFixed(4)),
              scores,
              model: res.model,
            };
          }
        });
      }
    }),
  );
  return out;
}
