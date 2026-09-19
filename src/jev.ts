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

/**
 * Tokens in a string, estimated. ASCII runs at about 3.5 characters a token;
 * everything else is counted at two tokens a character, which is what CJK
 * text costs on the tokenizers this is modelled on and a safe overcount for
 * accented Latin. The old estimate divided every character by 3.5, so a
 * batch of Chinese text packed to 20k estimated tokens carried 80k real
 * ones, Jev answered 400 max_tokens_exceeded, and the request fell to the
 * LLM fallback (slow) or, past FALLBACK_MAX_INPUTS, to a 502. Overcounting
 * only costs an extra request, which runs concurrently.
 */
export function estimateTokens(s: string) {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < s.length; i++) (s.charCodeAt(i) < 128 ? ascii++ : other++);
  return Math.ceil(ascii / 3.5) + other * 2 + 1;
}
const est = estimateTokens;

/** A refusal from Jev, with the status and the error_type the API gives. */
export class JevError extends Error {
  constructor(message: string, readonly status: number, readonly errorType: string) {
    super(message);
  }
}

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

/** Greedy packing: fill each request up to the token budget, in input order. Exported for the tests. */
export function pack(inputs: string[], labels: string[], instructions: string | undefined, multi: boolean): Packed[] {
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
  let last: Error = new Error("typesafe: no attempt made");
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
      error_type?: string;
    };
    if (res.ok && payload.answers) {
      // Only a call that answered is billed; a retried 429 is not.
      addJevCost(meter, payload.usage?.input_tokens);
      return payload as Required<Pick<typeof payload, "model" | "answers">>;
    }
    last = new JevError(
      `typesafe ${res.status}: ${JSON.stringify(payload.detail ?? payload).slice(0, 200)}`,
      res.status,
      typeof payload.error_type === "string" ? payload.error_type : "",
    );
    // 429 and 529 are the documented "back off and retry" statuses.
    if (res.status !== 429 && res.status !== 529 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 200));
  }
  throw last;
}

/** Two halves of a packed request, each addressed to its own slice of the inputs. */
function halve(b: Packed): [Packed, Packed] {
  const mid = Math.ceil(b.items.length / 2);
  const part = (items: Packed["items"], start: number): Packed => {
    const ids = new Set(items.map((it) => it.id));
    const questions: Packed["questions"] = {};
    for (const [qid, q] of Object.entries(b.questions)) {
      if (ids.has(qid.replace(/_\d+$/, "")) || ids.has(qid)) questions[qid] = q;
    }
    return { start, items, questions };
  };
  return [part(b.items.slice(0, mid), b.start), part(b.items.slice(mid), b.start + mid)];
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
        let res: Awaited<ReturnType<typeof post>>;
        try {
          res = await post(key, { state: b.items, model: MODEL, questions: b.questions }, meter);
        } catch (e) {
          // The estimate undercounted this batch. Halve it and let the loop
          // pick both halves up; a single item that is still too large is a
          // real failure and falls back like any other.
          if (e instanceof JevError && e.errorType === "max_tokens_exceeded" && b.items.length > 1) {
            batches.push(...halve(b));
            continue;
          }
          throw e;
        }
        b.items.forEach((item, k) => {
          const i = b.start + k;
          if (multi) {
            // Define own properties so labels such as __proto__ remain data.
            const scores = Object.fromEntries(labels.map((l, li) => [
              l, Number((res.answers[`${item.id}_${li}`]?.noul ?? 0).toFixed(4)),
            ]));
            const best = labels.reduce((a, l) => (scores[l] > scores[a] ? l : a), labels[0]);
            out[i] = { label: best, confidence: scores[best], scores, model: res.model };
          } else {
            const a = res.answers[item.id];
            const scores = Object.fromEntries(labels.map((l) => [
              l, Number((a?.probabilities?.[l] ?? 0).toFixed(4)),
            ]));
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
