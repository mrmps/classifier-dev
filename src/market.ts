/**
 * Market: ask a simulated population which of several options it prefers.
 *
 * The pipeline is retrieval (Postgres, hybrid keyword + vector), then a Jev
 * Score per shortlisted persona for graded audience membership, then one Jev
 * Choice per panelist for the vote. Everything here is pure logic over the
 * shared Jev client; HTTP, billing and SQL live in http/market.ts.
 *
 * Two Jev jaggedness findings shape the vote packing. Accuracy falls when
 * state carries unrelated detail, so batches stay small (VOTE_BATCH personas
 * per request) even though the context budget would fit far more — personas
 * dominate the token bill and are paid once per panel at any batch size, so
 * smaller batches only re-send the two option texts. And a Choice may favour
 * whichever option is listed first, so half the panel sees the criteria in
 * each order; the gap between the two halves is reported as position_bias
 * rather than hidden in the average.
 */

import {
  estimateTokens,
  jevAsk,
  prepareJevBatches,
  runJevBatches,
  type JevAnswer,
  type JevKeys,
  type JevQuestionGroup,
  type Question,
} from "./jev";
import type { Meter } from "./cost";

export const MARKET_CORPUS_VERSION = "nemotron-personas-usa-v1";
/** Folded into the audience id: bump when the membership or vote prompts change, so stale panels are never reused. */
export const MARKET_RECIPE_VERSION = "r2";
export const MAX_OPTIONS = 4;
export const MAX_OPTION_CHARS = 2000;
export const MAX_AUDIENCE_CHARS = 400;
export const MIN_POPULATION = 50;
export const MAX_POPULATION = 2000;
export const DEFAULT_POPULATION = 500;
/** Shortlist scored for membership on an audience miss. */
export const MEMBERSHIP_SHORTLIST = 2200;
/** Below this membership weight a candidate never enters the panel. */
export const MIN_MEMBERSHIP_WEIGHT = 0.15;
/** Personas per vote request: small on purpose; see the header comment. */
const VOTE_BATCH = 40;
const VOTE_CONCURRENCY = 6;

export class MarketError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 422 | 502 | 503 = 400) {
    super(message);
  }
}

export type MarketOption = { id: string; content: string };
export type MarketRequest = {
  audience: string;
  options: MarketOption[];
  decision: string;
  population: number;
};

/** Validate the request body; errors name the field and the accepted range. */
export function readMarketRequest(body: Record<string, unknown>): MarketRequest {
  const audience = typeof body.audience === "string" ? body.audience.trim() : "";
  if (!audience) throw new MarketError("Provide an audience: one plain-English description of who should judge the options.");
  if (audience.length > MAX_AUDIENCE_CHARS) throw new MarketError(`The audience description must be at most ${MAX_AUDIENCE_CHARS} characters.`);
  if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > MAX_OPTIONS) {
    throw new MarketError(`Provide 2-${MAX_OPTIONS} options to compare.`);
  }
  const ids = new Set<string>();
  const options = body.options.map((raw, index) => {
    const record: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : { content: raw };
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!content) throw new MarketError(`Option ${index + 1} needs a non-empty "content" string.`);
    if (content.length > MAX_OPTION_CHARS) throw new MarketError(`Option ${index + 1} exceeds ${MAX_OPTION_CHARS} characters; Market compares short artifacts such as headlines, descriptions, or pricing copy.`);
    const id = typeof record.id === "string" && /^[a-z0-9_-]{1,32}$/i.test(record.id) ? record.id : String.fromCharCode(97 + index);
    if (ids.has(id)) throw new MarketError(`Duplicate option id "${id}".`);
    ids.add(id);
    return { id, content };
  });
  const decision = typeof body.decision === "string" && body.decision.trim()
    ? body.decision.trim()
    : "Which option would this person find more appealing?";
  if (decision.length > 500) throw new MarketError("The decision question must be at most 500 characters.");
  const population = body.population === undefined ? DEFAULT_POPULATION : Number(body.population);
  if (!Number.isSafeInteger(population) || population < MIN_POPULATION || population > MAX_POPULATION) {
    throw new MarketError(`population must be an integer between ${MIN_POPULATION} and ${MAX_POPULATION}.`);
  }
  return { audience, options, decision, population };
}

export type Candidate = { id: number; text: string };
export type PanelMember = { id: number; weight: number; attrs: Record<string, unknown> };

/** Deterministic 32-bit PRNG so the same audience always yields the same panel. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Ruling-out semantics, because Jev reads literally: a broad behavioral
 * audience ("adults who read news online daily") names a behavior no corpus
 * profile records, and levels phrased as positive evidence score nearly
 * everyone as adjacent. Membership asks what the profile rules out, so broad
 * audiences keep most of the population at "plausible" while occupational
 * audiences still exclude the profiles that contradict them.
 */
const MEMBERSHIP_LEVELS = [
  "Clearly not in this audience: something in the profile rules them out",
  "Unlikely: nothing rules them out, but the profile makes membership improbable",
  "Plausible: nothing in the profile rules them out and the profile is consistent with this audience",
  "Strong fit: the profile directly indicates this audience",
];

/** One Score question per shortlisted persona; packed by the shared batcher. */
export function membershipGroups(audience: string, candidates: Candidate[]): JevQuestionGroup<number>[] {
  return candidates.map((candidate, index) => {
    const id = `p${candidate.id}`;
    const question: Question = {
      type: "score",
      instructions: `How well does the person described in \`${id}\` fit this audience: ${JSON.stringify(audience)}? Judge only from that person's description.`,
      criteria: MEMBERSHIP_LEVELS,
    };
    return { state: { id, text: candidate.text }, questions: { [id]: question }, value: index };
  });
}

/** Graded membership: full weight for "squarely", half for "plausibly". */
export function membershipWeight(answer: JevAnswer | undefined): number {
  const p = answer?.probabilities;
  if (!p) return 0;
  const squarely = p["3"] ?? 0;
  const plausibly = p["2"] ?? 0;
  return Math.min(1, squarely + 0.5 * plausibly);
}

export async function scoreMembership(
  keys: JevKeys,
  audience: string,
  candidates: Candidate[],
  meter?: Meter,
): Promise<number[]> {
  const groups = membershipGroups(audience, candidates);
  const answered = await runJevBatches(keys, prepareJevBatches(groups), meter);
  const weights = new Array<number>(candidates.length).fill(0);
  for (const { value: index, answers } of answered) {
    weights[index] = membershipWeight(answers[`p${candidates[index].id}`]);
  }
  return weights;
}

/**
 * Weighted sample without replacement (Efraimidis-Spirakis), seeded. Members
 * keep their membership weight so aggregation can reweight the headline share.
 */
export function samplePanel(
  candidates: { id: number; weight: number }[],
  population: number,
  seed: string,
): { id: number; weight: number }[] {
  const random = seededRandom(seed);
  return candidates
    .filter((candidate) => candidate.weight >= MIN_MEMBERSHIP_WEIGHT)
    .map((candidate) => ({ candidate, key: Math.pow(random(), 1 / candidate.weight) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, population)
    .map(({ candidate }) => candidate);
}

export type VoteBatch = {
  state: { id: string; text: string }[];
  questions: Record<string, Question>;
  /** Persona ids in this batch, keyed by question id. */
  members: Map<string, number>;
};

/**
 * Batches share the option texts through state and counterbalance criteria
 * order by panel position: even panelists see options in the given order and
 * odd panelists see them reversed, so a position preference cancels in the
 * mean and surfaces as `position_bias`.
 */
export function voteBatches(
  options: MarketOption[],
  panel: { id: number; text: string }[],
  decision: string,
): VoteBatch[] {
  const optionState = options.map((option) => ({ id: `option_${option.id}`, text: option.content }));
  const forward = options.map((option) => `option_${option.id}`);
  const names = forward.join(", ");
  const batches: VoteBatch[] = [];
  for (let start = 0; start < panel.length; start += VOTE_BATCH) {
    const slice = panel.slice(start, start + VOTE_BATCH);
    const questions: Record<string, Question> = {};
    const members = new Map<string, number>();
    slice.forEach((member, offset) => {
      const position = start + offset;
      const order = position % 2 === 0 ? forward : [...forward].reverse();
      const id = `v${member.id}`;
      questions[id] = {
        type: "choice",
        instructions:
          `Consider only the person described in \`p${member.id}\` and the option texts ${names}. ` +
          `${decision} Answer as that specific person would, from their occupation, life situation, and interests.`,
        criteria: Object.fromEntries(order.map((name) => [name, null])),
      };
      members.set(id, member.id);
    });
    batches.push({
      state: [...optionState, ...slice.map((member) => ({ id: `p${member.id}`, text: member.text }))],
      questions,
      members,
    });
  }
  return batches;
}

export type Vote = { personaId: number; option: string; confidence: number; position: "forward" | "reversed"; probabilities: Record<string, number> };

/**
 * Run vote batches with bounded concurrency and partial tolerance: a failed
 * batch after one halving retry costs its respondents, not the panel. Halving
 * rebuilds both halves with the option state included, which the generic
 * runner in jev.ts cannot do because its groups carry one state item each.
 */
export async function runVotes(
  keys: JevKeys,
  batches: VoteBatch[],
  options: MarketOption[],
  meter?: Meter,
  ask: typeof jevAsk = jevAsk,
): Promise<{ votes: Vote[]; failedRespondents: number }> {
  const queue = [...batches];
  const votes: Vote[] = [];
  let failedRespondents = 0;
  const optionState = new Set(options.map((option) => `option_${option.id}`));
  const forwardFirst = `option_${options[0].id}`;

  await Promise.all(
    Array.from({ length: Math.min(VOTE_CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const batch = queue.shift();
        if (!batch) break;
        try {
          const result = await ask(keys, batch.state, batch.questions, meter);
          for (const [questionId, personaId] of batch.members) {
            const answer = result.answers[questionId];
            const question = batch.questions[questionId];
            if (!answer?.choice || question.type !== "choice") continue;
            const probabilities: Record<string, number> = {};
            for (const [name, probability] of Object.entries(answer.probabilities ?? {})) {
              probabilities[name.replace(/^option_/, "")] = probability;
            }
            votes.push({
              personaId,
              option: answer.choice.replace(/^option_/, ""),
              confidence: answer.confidence ?? 0,
              position: Object.keys(question.criteria)[0] === forwardFirst ? "forward" : "reversed",
              probabilities,
            });
          }
        } catch (error) {
          const halvable = batch.members.size > 1;
          if (halvable) {
            const entries = [...batch.members.entries()];
            const mid = Math.ceil(entries.length / 2);
            for (const half of [entries.slice(0, mid), entries.slice(mid)]) {
              const ids = new Set(half.map(([questionId]) => questionId));
              const personaIds = new Set(half.map(([, personaId]) => `p${personaId}`));
              queue.push({
                state: batch.state.filter((item) => optionState.has(item.id) || personaIds.has(item.id)),
                questions: Object.fromEntries(Object.entries(batch.questions).filter(([id]) => ids.has(id))),
                members: new Map(half),
              });
            }
          } else {
            failedRespondents += batch.members.size;
          }
        }
      }
    }),
  );
  return { votes, failedRespondents };
}

export type SegmentRow = {
  attribute: string;
  value: string;
  n: number;
  preference: Record<string, number>;
};

export type MarketResult = {
  corpus_version: string;
  audience: string;
  audience_id: string;
  population: number;
  answered: number;
  candidates: number;
  preference: Record<string, number>;
  interval: Record<string, [number, number]>;
  effective_sample_size: number;
  position_bias: number | null;
  /** Weighted mean of each panelist's strongest option probability: 0.5 = individually torn, 1 = individually certain. */
  mean_certainty: number;
  segments: SegmentRow[];
  decision: string;
};

const SEGMENT_ATTRIBUTES = ["age_band", "sex", "education", "region", "marital"];
const MIN_SEGMENT_N = 25;

/** Weighted shares, a Kish-effective-sample interval, position bias, and the segment table. */
export function aggregate(
  request: MarketRequest,
  audienceId: string,
  candidates: number,
  panel: Map<number, PanelMember>,
  votes: Vote[],
): MarketResult {
  const totals: Record<string, number> = Object.fromEntries(request.options.map((option) => [option.id, 0]));
  let weightSum = 0;
  let weightSquares = 0;
  const byPosition: Record<"forward" | "reversed", { first: number; total: number }> = {
    forward: { first: 0, total: 0 },
    reversed: { first: 0, total: 0 },
  };
  const segmentTotals = new Map<string, { n: number; weight: number; options: Record<string, number> }>();

  let certaintySum = 0;
  for (const vote of votes) {
    const member = panel.get(vote.personaId);
    if (!member || !(vote.option in totals)) continue;
    const weight = member.weight;
    // Probability-mass voting: a persona that would pick A 70% of the time
    // contributes 0.7 to A, not 1.0. Argmax voting collapses within-person
    // uncertainty, and because Jev is deliberately consistent, that collapse
    // herds near-identical personas onto one option and fabricates 99/1
    // splits no human panel would produce.
    let mass = 0;
    for (const option of request.options) mass += Math.max(0, vote.probabilities[option.id] ?? 0);
    const shares: [string, number][] = mass > 0
      ? request.options.map((option) => [option.id, Math.max(0, vote.probabilities[option.id] ?? 0) / mass])
      : [[vote.option, 1]];
    for (const [optionId, share] of shares) totals[optionId] += weight * share;
    certaintySum += weight * Math.max(...shares.map(([, share]) => share));
    weightSum += weight;
    weightSquares += weight * weight;
    const positionCell = byPosition[vote.position];
    positionCell.total += 1;
    if (vote.option === request.options[0].id) positionCell.first += 1;
    for (const attribute of SEGMENT_ATTRIBUTES) {
      const value = member.attrs[attribute];
      if (typeof value !== "string" || !value) continue;
      const key = `${attribute}\u0000${value}`;
      const cell = segmentTotals.get(key) ?? { n: 0, weight: 0, options: Object.fromEntries(request.options.map((option) => [option.id, 0])) };
      cell.n += 1;
      cell.weight += weight;
      for (const [optionId, share] of shares) cell.options[optionId] += weight * share;
      segmentTotals.set(key, cell);
    }
  }

  const answered = votes.filter((vote) => vote.option in totals).length;
  const preference: Record<string, number> = {};
  for (const option of request.options) preference[option.id] = weightSum > 0 ? round(totals[option.id] / weightSum) : 0;

  // Kish effective sample size shrinks the interval honestly under reweighting.
  const effective = weightSum > 0 ? (weightSum * weightSum) / weightSquares : 0;
  const interval: Record<string, [number, number]> = {};
  for (const option of request.options) {
    const share = preference[option.id];
    const margin = effective > 1 ? 1.96 * Math.sqrt((share * (1 - share)) / effective) : 0.5;
    interval[option.id] = [round(Math.max(0, share - margin)), round(Math.min(1, share + margin))];
  }

  const positionBias =
    byPosition.forward.total >= 20 && byPosition.reversed.total >= 20
      ? round(Math.abs(byPosition.forward.first / byPosition.forward.total - byPosition.reversed.first / byPosition.reversed.total))
      : null;

  const overall = preference[request.options[0].id];
  const segments = [...segmentTotals.entries()]
    .filter(([, cell]) => cell.n >= MIN_SEGMENT_N && cell.weight > 0)
    .map(([key, cell]) => {
      const [attribute, value] = key.split("\u0000");
      const rowPreference: Record<string, number> = {};
      for (const option of request.options) rowPreference[option.id] = round(cell.options[option.id] / cell.weight);
      return {
        attribute,
        value,
        n: cell.n,
        preference: rowPreference,
        delta: Math.abs(rowPreference[request.options[0].id] - overall) * Math.sqrt(cell.n),
      };
    })
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 6)
    .map(({ delta: _delta, ...row }) => row);

  return {
    corpus_version: MARKET_CORPUS_VERSION,
    audience: request.audience,
    audience_id: audienceId,
    population: request.population,
    answered,
    candidates,
    preference,
    interval,
    effective_sample_size: Math.round(effective),
    position_bias: positionBias,
    mean_certainty: weightSum > 0 ? round(certaintySum / weightSum) : 0,
    segments,
    decision: request.decision,
  };
}

const round = (value: number) => Number(value.toFixed(4));

/** Options must be able to share a request with at least one persona. */
export function assertOptionsFit(options: MarketOption[]): void {
  const optionTokens = options.reduce((sum, option) => sum + estimateTokens(option.content) + 20, 0);
  if (optionTokens > 8000) {
    throw new MarketError("The options are too long to evaluate together; shorten them or compare fewer at once.", 422);
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
