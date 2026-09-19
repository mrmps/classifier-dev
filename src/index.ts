import { isUnintelligible, UNSCORED_REASON } from "./unintelligible";
import { SKILL_MD, skillIndex } from "./skill";
import { DOCS, BENCHMARK } from "./docs";
import { OPENAPI, LLMS_TXT } from "./openapi";
import { FAVICON_SVG, ogPngBytes, UNFURLERS, unfurlHtml } from "./brand";
import { homeHtml, benchmarkHtml } from "./home";
import { dailyReport } from "./report";
import { runAlerts } from "./alerts";
import { jevClassify, MULTI_THRESHOLD } from "./jev";
import { newMeter, addUsd, type Meter } from "./cost";
import { secretEquals } from "./secrets";
import { adminResponse } from "./admin";
export { RateLimiter } from "./limiter";

export interface Env {
  OPENROUTER_API_KEY: string;
  TYPESAFE_API_KEY?: string;
  ENTERPRISE_API_KEY?: string;
  RESEND_API_KEY: string;
  REPORT_TO: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CF_ANALYTICS_TOKEN: string;
  STATS: KVNamespace;
  LIMITER: DurableObjectNamespace;
  AE: AnalyticsEngineDataset;
  REPORT_KEY: string;
  /** Gates /admin. Set with `npx wrangler secret put ADMIN_PASSWORD`. */
  ADMIN_PASSWORD?: string;
  /** Signs the /admin session cookie. Random, and unrelated to the password. */
  ADMIN_SIGNING_KEY?: string;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
// Jev packs a thousand short inputs into one upstream request; see jev.ts.
const MAX_INPUTS = 1000;
const MAX_LABELS = 100;
// The LLM fallback answers single-label with one letter token, which caps it at
// 26; past that it runs the multi-label prompt and keeps the top pick.
const MAX_LABELS_SINGLE = 26;
// The fallback is one upstream call per input, so it cannot take a real batch.
const FALLBACK_MAX_INPUTS = 20;
const MAX_CHARS = 32_000;
/** The schedule that runs the alert check rather than the digest. */
const ALERT_CRON = "*/15 * * * *";
// Smart tier: a fast answer below this confidence is re-asked of the reasoning chain.
const ESCALATE_BELOW = 0.7;

/**
 * Each tier is a chain, not a single model. The primary is the cheapest thing
 * that clears the accuracy bar; the fallback is on a *different* provider so a
 * provider-side outage cannot take the tier down. Measured failure rate on a
 * single-provider primary was about 15%, and retries against the same provider
 * could not help.
 *
 * A model can also vanish outright: ling-2.6-flash was delisted upstream and
 * every fast request quietly paid a 404 and answered from the fallback for
 * weeks, at F1 0.546 against the 0.800 the docs advertised. `npm run bench`
 * exists to catch that, and the digest now reports which model actually served.
 *
 * Single-label and multi-label want different models, so the fast tier names
 * both. A single-label answer is one token, so a provider that returns
 * logprobs buys a real confidence score — only granite-4.0-h-micro and
 * deepseek-v4-flash do, of everything benchmarked. Multi-label answers carry no
 * confidence anyway, so that chain is free to pick on F1 and price alone.
 */
const TIERS = {
  fast: {
    // A full 1,000-input batch must not lock the caller out for the rest of
    // the minute; the daily cap is the real ceiling.
    rpm: 3000,
    daily: 20_000,
    // Logprob-capable, in latency order. Losing this chain's scores is a
    // visible product regression, so accuracy is traded for it deliberately.
    chain: [
      { model: "ibm-granite/granite-4.0-h-micro", provider: "Cloudflare", maxTokens: 1, reasoning: false },
      { model: "deepseek/deepseek-v4-flash", provider: "StreamLake", maxTokens: 1, reasoning: false },
      { model: "inclusionai/ling-3.0-flash", provider: "Novita", maxTokens: 1, reasoning: false },
    ],
    // Measured by eval/bench.py, 7 cases x 3 runs, multi-label pipeline:
    //   ling-3.0-flash   F1 0.799  1538ms  $0.008/1k   <- primary
    //   mercury-2.5      F1 0.797   945ms  $0.038/1k
    //   granite-4.2-8b   F1 0.704  1008ms  $0.036/1k
    //   mistral-nemo     F1 0.729  2098ms  $0.016/1k
    //   granite-4.0-h-micro F1 0.546 1575ms $0.017/1k  <- what shipped by accident
    // The top two are within noise of each other on F1 and sit on different
    // providers, which is exactly what a fallback pair should look like.
    multiChain: [
      { model: "inclusionai/ling-3.0-flash", provider: "Novita", maxTokens: 1, reasoning: false },
      { model: "inception/mercury-2.5", provider: "Inception", maxTokens: 1, reasoning: false },
      { model: "ibm-granite/granite-4.2-8b", provider: "DeepInfra", maxTokens: 1, reasoning: false },
    ],
  },
  smart: {
    rpm: 200,
    daily: 2000,
    // Only ever sees the answers Jev was unsure about, so it has to be a model
    // that is actually better than Jev on hard cases. Measured on the items
    // Jev put under 0.7 confidence (eval/single.py + escalate.py, 2026-09-17):
    //   six-way emotion, 122 items   jev 36.9%  gemini-3.8-flash 43.4%  qwen3.8-flash 36.1%  deepseek-v4-flash 36.9%
    //   four-way news, 49 items      jev 65.3%  gemini-3.8-flash 85.7%  qwen3.8-flash 79.6%  deepseek-v4-flash 34.7%
    // which moves the whole set from 61.8% to 63.7% and 87.5% to 90.0%.
    // Frontier models do much better here (claude-fable-5.1: 71.3% / 91.8%)
    // but cost ~$2 per thousand escalations; the brief is fast and cheap.
    chain: [
      { model: "google/gemini-3.8-flash", provider: undefined, maxTokens: 2000, reasoning: true },
      { model: "qwen/qwen3.8-flash", provider: undefined, maxTokens: 2000, reasoning: true },
    ],
  },
} as const;
type Tier = keyof typeof TIERS;

/**
 * The models a tier is supposed to answer from. Anything else in the digest
 * means the chain is falling through — which is how a delisted primary hid for
 * weeks. Both fast chains count, since either can legitimately serve.
 */
export function primaryModels(): string[] {
  // Jev answers as a versioned id ("jev-1.13.0") while we ask for "jev-latest",
  // so the digest matches it by prefix.
  const out: string[] = ["jev"];
  for (const tier of Object.keys(TIERS) as Tier[]) {
    const t = TIERS[tier] as { chain: readonly ModelCfg[]; multiChain?: readonly ModelCfg[] };
    out.push(t.chain[0].model);
    if (t.multiChain) out.push(t.multiChain[0].model);
  }
  return out;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization",
};

const text = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...CORS, ...extra },
  });

/** The rendered site. Same document as text(), for clients that asked for HTML. */
const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      // The plain text and the page differ by Accept, so caches must vary on it.
      vary: "accept",
      ...CORS,
      ...extra,
    },
  });

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extra },
  });

function buildMultiPrompt(
  labels: string[],
  instructions?: string,
  max?: number,
  strict?: boolean,
) {
  return [
    strict
      ? "You are a multi-label classifier reviewing a shortlist. Keep only the categories the input clearly and substantively addresses."
      : "You are a multi-label classifier. Select EVERY category that applies to the input, and only those.",
    strict
      ? "Drop any category that is merely adjacent, implied, or a stretch. Keep the ones a careful human tagger would defend."
      : "A category applies if the input meaningfully touches it, even briefly or in passing. Do not restrict yourself to the single main topic.",
    instructions ? `\nCRITERIA\n${instructions}` : "",
    `\nCATEGORIES\n${labels.map((l, i) => `${i + 1} = ${l}`).join("\n")}`,
    max ? `\nSelect at most ${max}, the most clearly applicable ones.` : "",
    "\nAnswer with the numbers that apply, separated by commas, like: 2,5,9",
    'If none apply, answer exactly: none',
    "Answer with numbers only. Do not explain.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Pull category numbers out of a free-text answer, in the label's own order. */
function parseNumbers(answer: string, n: number, max?: number): number[] {
  const seen = new Set<number>();
  for (const m of answer.matchAll(/\d+/g)) {
    const v = Number.parseInt(m[0], 10);
    if (v >= 1 && v <= n) seen.add(v);
  }
  const picked = [...seen].sort((a, b) => a - b);
  return max && picked.length > max ? picked.slice(0, max) : picked;
}

function buildPrompt(labels: string[], instructions?: string) {
  return [
    "You are a classifier. Assign the input to exactly one category.",
    instructions ? `\nCRITERIA\n${instructions}` : "",
    `\nCATEGORIES\n${labels.map((l, i) => `${LETTERS[i]} = ${l}`).join("\n")}`,
    `\nAnswer with a single character: ${labels.map((_, i) => LETTERS[i]).join(", ")}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function scoresFrom(top: { token: string; logprob: number }[] | undefined, n: number) {
  if (!top?.length) return null;
  const valid = LETTERS.slice(0, n);
  const p: Record<string, number> = Object.fromEntries(valid.map((l) => [l, 0]));
  let total = 0;
  for (const t of top) {
    const c = t.token.trim().toUpperCase()[0];
    if (valid.includes(c)) {
      const e = Math.exp(t.logprob);
      p[c] += e;
      total += e;
    }
  }
  if (!total) return null;
  for (const k of valid) p[k] /= total;
  return p;
}

function parseLetter(s: string, n: number) {
  const valid = LETTERS.slice(0, n);
  const u = (s ?? "").toUpperCase();
  for (let i = u.length - 1; i >= 0; i--) if (valid.includes(u[i])) return u[i];
  return null;
}

type ModelCfg = { model: string; provider?: string; maxTokens: number; reasoning: boolean };
type MultiOpts = { max?: number; strict?: boolean };

async function callModel(
  env: Env,
  cfg: ModelCfg,
  input: string,
  labels: string[],
  instructions?: string,
  multi?: MultiOpts,
  meter?: Meter,
) {
  const body: Record<string, unknown> = {
    model: cfg.model,
    // An unpinned entry means "any provider"; sending only:[undefined] pins it
    // to nothing and the call fails.
    ...(cfg.provider ? { provider: { only: [cfg.provider], allow_fallbacks: false } } : {}),
    messages: [
      {
        role: "system",
        content: multi
          ? buildMultiPrompt(labels, instructions, multi.max, multi.strict)
          : buildPrompt(labels, instructions),
      },
      { role: "user", content: `${input}\nANSWER:` },
    ],
    // A list of numbers needs room to finish; a single letter does not. Keeping
    // this tight is most of why multi-label stays close to single-label latency.
    // Reasoning models must keep their full budget: the reasoning tokens are
    // drawn from the same allowance, so a tight cap is spent before any answer
    // is emitted and the response comes back empty.
    max_tokens: multi
      ? cfg.reasoning
        ? cfg.maxTokens
        : Math.min(16 + labels.length * 2, 160)
      : cfg.maxTokens,
    temperature: 0,
    // Ask OpenRouter to price the call. The dashboard reports what the
    // provider actually charged rather than a rate card that can drift.
    usage: { include: true },
  };
  if (cfg.reasoning) body.reasoning = { effort: "low" };
  else {
    body.reasoning = { enabled: false };
    // Logprobs describe one token, which says nothing useful about a list.
    if (!multi) {
      body.logprobs = true;
      body.top_logprobs = 8;
    }
  }

  const started = Date.now();
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "content-type": "application/json",
        "http-referer": "https://classifier.dev",
        "x-title": "classifier.dev",
      },
      body: JSON.stringify(body),
    });
    const payload = (await res.json()) as {
      error?: { message?: string };
      choices?: { message?: { content?: string }; logprobs?: { content?: { top_logprobs?: { token: string; logprob: number }[] }[] } }[];
      usage?: { cost?: number };
    };
    if (res.ok && !payload.error) {
      // Charged only for a call that answered; a failed attempt that falls
      // through to the next model in the chain is not billed here.
      addUsd(meter, payload.usage?.cost);
      const choice = payload.choices?.[0];
      if (multi) {
        const answer = choice?.message?.content ?? "";
        const picked = /\bnone\b/i.test(answer) && !/\d/.test(answer)
          ? []
          : parseNumbers(answer, labels.length, multi.max);
        return {
          label: labels[picked[0] - 1] ?? "",
          labels: picked.map((n) => labels[n - 1]),
          confidence: null as number | null,
          scores: null as Record<string, number> | null,
          unscored: undefined as string | undefined,
          ms: Date.now() - started,
          model: cfg.model,
        };
      }
      const letter = parseLetter(choice?.message?.content ?? "", labels.length);
      const raw = scoresFrom(choice?.logprobs?.content?.[0]?.top_logprobs, labels.length);
      const idx = letter ? LETTERS.indexOf(letter) : -1;
      const label = idx >= 0 && idx < labels.length ? labels[idx] : labels[0];
      // The model still picks a letter for input that is not language, and does
      // so with a near-perfect score. Publishing that invites callers to
      // threshold on it, so the label ships without a score instead.
      const unreadable = isUnintelligible(input);
      const scores =
        raw && !unreadable
          ? Object.fromEntries(
              Object.entries(raw).map(([l, v]) => [labels[LETTERS.indexOf(l)] ?? l, Number(v.toFixed(4))]),
            )
          : null;
      return {
        label,
        labels: undefined as string[] | undefined,
        confidence: scores ? Number(Math.max(...Object.values(scores)).toFixed(4)) : null,
        scores,
        unscored: unreadable ? UNSCORED_REASON : undefined,
        ms: Date.now() - started,
        model: cfg.model,
      };
    }
    last = payload.error?.message ?? `upstream ${res.status}`;
    if (!/429|rate|timeout|50\d|Provider returned error|overload/i.test(last)) break;
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 200));
  }
  throw new Error(last || "upstream failure");
}

/** Single-label and multi-label can run different models; smart shares one chain. */
function chainFor(tier: Tier, multi?: MultiOpts): readonly ModelCfg[] {
  const t = TIERS[tier] as { chain: readonly ModelCfg[]; multiChain?: readonly ModelCfg[] };
  return multi && t.multiChain ? t.multiChain : t.chain;
}

/** Walk the tier's chain; the first model that answers wins. */
async function runChain(
  env: Env,
  input: string,
  labels: string[],
  tier: Tier,
  instructions?: string,
  multi?: MultiOpts,
  meter?: Meter,
) {
  let last: unknown;
  for (const cfg of chainFor(tier, multi)) {
    try {
      return await callModel(env, cfg, input, labels, instructions, multi, meter);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("all models failed");
}

/**
 * Asked to pick from fifty categories at once, a small model returns the ten
 * most *salient* rather than every one that *applies* — it dropped topics the
 * text names outright. Splitting the label set into small groups turns one hard
 * judgement into several easy ones, and the groups run concurrently so the wall
 * clock stays close to a single call.
 */
const MULTI_CHUNK = 12;

async function classifyOne(
  env: Env,
  input: string,
  labels: string[],
  tier: Tier,
  instructions?: string,
  multi?: MultiOpts,
  meter?: Meter,
) {
  if (!multi || labels.length <= MULTI_CHUNK) {
    return runChain(env, input, labels, tier, instructions, multi, meter);
  }

  const groups = Math.ceil(labels.length / MULTI_CHUNK);
  const size = Math.ceil(labels.length / groups);
  const chunks: string[][] = [];
  for (let i = 0; i < labels.length; i += size) chunks.push(labels.slice(i, i + size));

  const started = Date.now();
  // No per-chunk cap: a chunk cannot know what the others found.
  const parts = await Promise.all(
    chunks.map((chunk) => runChain(env, input, chunk, "fast", instructions, {}, meter)),
  );

  const hit = new Set<string>();
  for (const part of parts) for (const l of part.labels ?? []) hit.add(l);
  let picked = labels.filter((l) => hit.has(l));

  // A chunk cannot see its competition, so it over-selects: the sweep buys
  // recall and spends precision. One more pass over just the survivors gets the
  // precision back, because now every candidate is in view at once and they can
  // be judged against each other.
  // A chunk cannot see its competition, so the sweep buys recall and spends
  // precision. One pass over just the survivors gets the precision back, with
  // every candidate finally in view at once.
  //
  // On a 7-case set this pass moved fast-tier F1 from 0.761 to 0.800. Judging
  // each survivor alone as a yes/no question was tried and scored worse (0.612)
  // — isolating a label throws away the comparison that makes the call.
  //
  // When the caller asks for the smart tier, only this pass uses it. The sweep
  // stays on the cheap model: verifying is where judgement pays, and the split
  // measured the same as running smart throughout (0.876 vs 0.879) in a little
  // over half the time.
  if (picked.length > 2) {
    try {
      const verified = await runChain(env, input, picked, tier, instructions, {
        max: multi.max,
      }, meter);
      const keep = new Set(verified.labels ?? []);
      const narrowed = picked.filter((l) => keep.has(l));
      if (narrowed.length) picked = narrowed;
    } catch {
      // Verification is an improvement, not a requirement; keep the sweep.
    }
  }
  if (multi.max && picked.length > multi.max) picked = picked.slice(0, multi.max);

  return {
    label: picked[0] ?? "",
    labels: picked,
    confidence: null as number | null,
    scores: null as Record<string, number> | null,
    unscored: undefined as string | undefined,
    ms: Date.now() - started,
    model: parts[0]?.model ?? "",
  };
}

type Result = {
  label: string;
  labels?: string[];
  confidence: number | null;
  scores: Record<string, number> | null;
  unscored?: string;
  ms: number;
  model: string;
  escalated?: true;
};

export function summarizeModels(results: readonly { model: string }[]) {
  const modelsUsed = [...new Set(results.map((result) => result.model).filter(Boolean))];
  return {
    model: modelsUsed.length > 1 ? "mixed" : modelsUsed[0] ?? "",
    modelsUsed,
  };
}

/** The LLM chain, one upstream call per input. Fallback for when Jev is unavailable. */
async function llmClassifyMany(
  env: Env,
  inputs: string[],
  labels: string[],
  tier: Tier,
  instructions?: string,
  multi?: MultiOpts,
  meter?: Meter,
): Promise<Result[]> {
  // Single-label past 26 labels has no letter to ride on: run the multi prompt
  // and keep its top pick, so the response shape the caller asked for holds.
  const asMulti = multi ?? (labels.length > MAX_LABELS_SINGLE ? { max: 1 } : undefined);
  const out: Result[] = new Array(inputs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, inputs.length) }, async () => {
      while (next < inputs.length) {
        const i = next++;
        const r = await classifyOne(env, inputs[i], labels, tier, instructions, asMulti, meter);
        out[i] = multi ? r : { ...r, labels: undefined };
      }
    }),
  );
  return out;
}

/**
 * Smart tier. Jev is right about as often as the reasoning model, but it also
 * knows when it is unsure, and that is where the reasoning model earns its
 * cost: only the answers below ESCALATE_BELOW are re-asked, in place.
 */
async function escalate(env: Env, inputs: string[], labels: string[], instructions: string | undefined, results: Result[], meter?: Meter) {
  const idx = results.flatMap((r, i) => (r.confidence !== null && r.confidence < ESCALATE_BELOW ? [i] : []));
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, idx.length) }, async () => {
      while (next < idx.length) {
        const i = idx[next++];
        try {
          const r =
            labels.length > MAX_LABELS_SINGLE
              ? await runChain(env, inputs[i], labels, "smart", instructions, { max: 1 }, meter)
              : await runChain(env, inputs[i], labels, "smart", instructions, undefined, meter);
          if (r.label) results[i] = { ...results[i], label: r.label, model: r.model, escalated: true };
        } catch (e) {
          // The fast answer stands; it was uncertain, not absent. Say so in
          // the logs, because a chain that fails every time looks identical
          // to a batch that was simply confident.
          failed++;
          console.warn(`escalation failed: ${(e as Error).message}`);
        }
      }
    }),
  );
  return failed;
}

/**
 * `escalationFailed` counts smart-tier answers that could not reach the
 * reasoning model, so the response can say so instead of quietly returning
 * fast-tier answers under a smart-tier label.
 */
async function classifyMany(
  env: Env,
  inputs: string[],
  labels: string[],
  tier: Tier,
  instructions?: string,
  multi?: MultiOpts,
  meter?: Meter,
): Promise<{ results: Result[]; escalationFailed: number }> {
  if (env.TYPESAFE_API_KEY) {
    const started = Date.now();
    let jev: Awaited<ReturnType<typeof jevClassify>> | null = null;
    try {
      jev = await jevClassify(env.TYPESAFE_API_KEY, inputs, labels, instructions, !!multi, meter);
    } catch (e) {
      console.warn(`jev failed, falling back: ${(e as Error).message}`);
    }
    if (jev) {
      const ms = Date.now() - started;
      const results: Result[] = jev.map((r, i) => {
        // Jev still picks confidently for input that is not language, so the
        // score is withheld there exactly as it was for the LLMs.
        const unreadable = isUnintelligible(inputs[i]);
        if (multi) {
          let picked = labels
            .filter((l) => r.scores[l] >= MULTI_THRESHOLD)
            .sort((a, b) => r.scores[b] - r.scores[a]);
          if (multi.max) picked = picked.slice(0, multi.max);
          return {
            label: picked[0] ?? "",
            labels: picked,
            confidence: null,
            scores: unreadable ? null : r.scores,
            unscored: unreadable ? UNSCORED_REASON : undefined,
            ms,
            model: r.model,
          };
        }
        return {
          label: r.label,
          confidence: unreadable ? null : r.confidence,
          scores: unreadable ? null : r.scores,
          unscored: unreadable ? UNSCORED_REASON : undefined,
          ms,
          model: r.model,
        };
      });
      const escalationFailed =
        tier === "smart" && !multi ? await escalate(env, inputs, labels, instructions, results, meter) : 0;
      return { results, escalationFailed };
    }
  }
  if (inputs.length > FALLBACK_MAX_INPUTS) {
    throw new Error(`batch classification is temporarily unavailable; send up to ${FALLBACK_MAX_INPUTS} inputs or retry shortly`);
  }
  return { results: await llmClassifyMany(env, inputs, labels, tier, instructions, multi, meter), escalationFailed: 0 };
}

/**
 * Which kind of client called, as a low-cardinality family rather than the raw
 * User-Agent. Enough to tell one broken integration from broad traffic without
 * turning the dataset into a fingerprint of individual callers.
 */
function agentFamily(ua: string) {
  const s = ua.toLowerCase().trim();
  if (!s) return "none";
  if (s.startsWith("classify-cli/")) return "classify-cli";
  if (s.startsWith("curl/")) return "curl";
  if (s.includes("python-requests") || s.includes("httpx") || s.includes("aiohttp") || s.startsWith("python-urllib"))
    return "python";
  if (s.includes("undici") || s.includes("axios") || s.includes("node-fetch") || s.includes("bun/")) return "node";
  if (s.includes("go-http-client")) return "go";
  if (s.includes("java") || s.includes("okhttp")) return "java";
  if (s.includes("bot") || s.includes("crawler") || s.includes("spider")) return "bot";
  if (s.includes("mozilla") || s.includes("safari")) return "browser";
  return "other";
}

/**
 * Collapse an upstream failure to a stable code. The raw message carries
 * provider ids and timings that would make every row unique; the dashboard
 * wants to know which *kind* of failure is happening and how often.
 */
function upstreamReason(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes("typesafe")) {
    const code = m.match(/typesafe (\d{3})/);
    return code ? `typesafe_${code[1]}` : "typesafe";
  }
  if (m.includes("all models failed")) return "chain_exhausted";
  if (m.includes("batch classification is temporarily unavailable")) return "batch_unavailable";
  if (m.includes("timeout") || m.includes("timed out")) return "timeout";
  return "upstream_other";
}

/** Fingerprint a label set so we can count distinct classifiers without storing text. */
function classifierId(labels: string[]) {
  return [...labels].map((l) => l.toLowerCase().trim()).sort().join("|").slice(0, 120);
}

/** Enterprise callers use a secret bearer token and are not application-rate-limited. */
async function hasEnterpriseAccess(req: Request, env: Env) {
  if (!env.ENTERPRISE_API_KEY) return false;
  const authorization = req.headers.get("authorization");
  if (!authorization) return false;
  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (extra || scheme.toLowerCase() !== "bearer" || !token) return false;
  return secretEquals(token, env.ENTERPRISE_API_KEY);
}

function record(env: Env, ctx: ExecutionContext, d: {
  tier: Tier;
  n: number;
  ms: number;
  labels: string[];
  ip: string;
  country: string;
  status: number;
  client: "public" | "enterprise";
  model: string;
  /** Upstream spend for this request, in USD. See cost.ts. */
  usd: number;
  /** Why this request failed, as a stable code; "" when it succeeded. */
  reason: string;
  /** Client family, from the User-Agent. See agentFamily(). */
  agent: string;
  /** Inputs the caller sent, even when validation rejected them. */
  attempted: number;
  /** Smart-tier answers that could not reach the reasoning model. */
  escalationFailed: number;
}) {
  try {
    env.AE?.writeDataPoint({
      blobs: [d.tier, classifierId(d.labels), d.country, String(d.status), d.client, d.model, d.reason, d.agent],
      // double3 and blob7/blob8 were added after launch: rows written before
      // that read back as 0 and "", so cost and failure reasons are only
      // meaningful from that deploy forward.
      doubles: [d.n, d.ms, d.usd, d.attempted, d.escalationFailed],
      indexes: [d.ip.slice(0, 32)],
    });
  } catch {
    /* analytics must never break a request */
  }
  // Distinct classifier registry, for the daily digest. Cheap: one write per new label set.
  ctx.waitUntil(
    (async () => {
      try {
        if (!d.labels.length) return;
        const key = `cls:${classifierId(d.labels)}`;
        if (!(await env.STATS.get(key))) {
          await env.STATS.put(key, new Date().toISOString(), { expirationTtl: 60 * 60 * 24 * 90 });
        }
      } catch {
        /* ignore */
      }
    })(),
  );
}

/** Ask the per-IP Durable Object whether this request fits inside the window. */
async function limited(env: Env, tier: Tier, ip: string, cost: number) {
  const rpm = TIERS[tier].rpm;
  try {
    const id = env.LIMITER.idFromName(`${tier}:${ip}`);
    const res = await env.LIMITER.get(id).fetch(
      `https://limiter/?limit=${rpm}&daily=${TIERS[tier].daily}&cost=${cost}`,
    );
    return (await res.json()) as {
      limited: boolean;
      remaining: number;
      scope?: "minute" | "day";
      resetIn?: number;
    };
  } catch {
    // Never fail closed because the limiter had a bad moment.
    return { limited: false, remaining: -1 };
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip") ?? "anon";
    const country = (req as { cf?: { country?: string } }).cf?.country ?? "??";
    const enterprise = await hasEnterpriseAccess(req, env);
    const client = enterprise ? "enterprise" : "public";
    const agent = agentFamily(req.headers.get("user-agent") ?? "");
    // One meter per request, read once by record(). Never a module global:
    // the isolate serves concurrent requests.
    const meter = newMeter();

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    // Browsers announce text/html; curl sends */* and agents ask for text or
    // markdown. Only the first gets the rendered page — `curl classifier.dev`
    // prints exactly what it always did. ?format=text opts out by hand.
    const accept = req.headers.get("accept") ?? "";
    const wantsHtml =
      req.method === "GET" &&
      url.searchParams.get("format") !== "text" &&
      /\btext\/html\b/.test(accept);
    // The operator dashboard. Returns null for every other path.
    const admin = await adminResponse(req, env, path, ip);
    if (admin) return admin;
    if (req.method === "GET" && (path === "" || path === "index.html")) {
      if (UNFURLERS.test(req.headers.get("user-agent") ?? "")) {
        return new Response(unfurlHtml(), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", ...CORS },
        });
      }
      if (wantsHtml) return html(homeHtml());
      return text(DOCS, 200, { vary: "accept" });
    }
    if (req.method === "GET" && (path === "benchmark" || path === "benchmark.md")) {
      if (wantsHtml && path === "benchmark") return html(benchmarkHtml());
      return text(BENCHMARK, 200, { vary: "accept" });
    }
    if (path === "robots.txt") {
      return text("User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: https://classifier.dev/llms.txt\n");
    }
    // Machine-readable surfaces. /openapi.json is the conventional location;
    // /.well-known/ and /llms.txt are where agents increasingly look first.
    // Agent Skills discovery (RFC 8615). Lets `npx skills add https://classifier.dev`
    // install the skill straight from here, with no repository in the middle.
    // The legacy path is served too because the CLI falls back to it.
    if (
      path === ".well-known/agent-skills/index.json" ||
      path === ".well-known/skills/index.json"
    ) {
      return json(await skillIndex(new URL(req.url).origin));
    }
    if (path === "skill.md" || path === "SKILL.md") {
      return new Response(SKILL_MD, {
        headers: { "content-type": "text/markdown; charset=utf-8", ...CORS },
      });
    }
    if (path === "openapi.json" || path === ".well-known/openapi.json") {
      return json(OPENAPI, 200, { "cache-control": "public, max-age=3600" });
    }
    if (path === "llms.txt" || path === ".well-known/llms.txt") {
      return text(LLMS_TXT, 200, { "cache-control": "public, max-age=3600" });
    }
    // Preview the alert check on demand, without waiting a quarter hour.
    if (req.method === "GET" && path === "alerts") {
      const bearer = (req.headers.get("authorization") ?? "").replace(/^[Bb]earer\s+/, "");
      const given = bearer || url.searchParams.get("key") || "";
      if (!env.REPORT_KEY || !given || !(await secretEquals(given, env.REPORT_KEY))) {
        return text("not found\n", 404);
      }
      try {
        return text(
          await runAlerts(env, {
            send: url.searchParams.get("send") === "1",
            demo: url.searchParams.get("demo") === "1",
          }),
        );
      } catch (e) {
        return text(`alerts failed: ${(e as Error).message}\n`, 500);
      }
    }

    // Preview the daily digest on demand (also proves the cron path works).
    if (req.method === "GET" && path === "report") {
      // A query string is copied into logs, history and Referer headers, so
      // the header is the documented way in; ?key= stays for compatibility.
      const bearer = (req.headers.get("authorization") ?? "").replace(/^[Bb]earer\s+/, "");
      const given = bearer || url.searchParams.get("key") || "";
      if (!env.REPORT_KEY || !given || !(await secretEquals(given, env.REPORT_KEY))) {
        // 404, not 401: there is no reason to confirm the endpoint exists.
        return text("not found\n", 404);
      }
      const send = url.searchParams.get("send") === "1";
      try {
        const body = await dailyReport(env, { send, primaries: primaryModels() });
        return text(body);
      } catch (e) {
        return text(`report failed: ${(e as Error).message}\n`, 500);
      }
    }
    if (path === "favicon.svg") {
      return new Response(FAVICON_SVG, {
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400", ...CORS },
      });
    }
    if (path === "favicon.ico") {
      return new Response(FAVICON_SVG, {
        headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400", ...CORS },
      });
    }
    if (path === "og.png" || path === "og-v2.png" || path === "og-v3.png") {
      return new Response(ogPngBytes(), {
        headers: {
          "content-type": "image/png",
          // The versioned names are immutable by construction: new art gets a
          // new number, which is what makes a crawler re-fetch it.
          "cache-control": path === "og.png"
            ? "public, max-age=86400"
            : "public, max-age=31536000, immutable",
          ...CORS,
        },
      });
    }

    // ---- gather params from either shape -----------------------------------
    let inputs: string[] = [];
    let labels: string[] = [];
    let tier: Tier = "fast";
    let instructions: string | undefined;
    let multi: MultiOpts | undefined;
    let wantJson = req.method === "POST";

    if (req.method === "POST") {
      let body: Record<string, unknown>;
      try {
        body = (await req.json()) as Record<string, unknown>;
      } catch {
        record(env, ctx, { tier, n: 0, ms: 0, labels, ip, country, status: 400, client, model: "",
          usd: meter.usd, reason: "bad_json", agent, attempted: 0, escalationFailed: 0 });
        return json({ error: "Body must be JSON. See https://classifier.dev" }, 400);
      }
      inputs = Array.isArray(body.inputs)
        ? (body.inputs as string[])
        : typeof body.input === "string"
          ? [body.input]
          : [];
      labels = Array.isArray(body.labels) ? (body.labels as string[]) : [];
      if (body.tier === "smart") tier = "smart";
      if (typeof body.instructions === "string") instructions = body.instructions;
      if (body.multi === true || typeof body.max_labels === "number") {
        const max = typeof body.max_labels === "number" ? body.max_labels : undefined;
        multi = { max: max && max > 0 ? Math.floor(max) : undefined };
      }
    } else {
      // GET /{labels}/{text}
      const slash = path.indexOf("/");
      if (slash <= 0) return text(DOCS, 404);
      labels = path
        .slice(0, slash)
        .split(",")
        .map((l) => l.replace(/\+/g, " ").trim())
        .filter(Boolean);
      inputs = [path.slice(slash + 1).replace(/\+/g, " ").trim()];
      if (url.searchParams.get("tier") === "smart") tier = "smart";
      instructions = url.searchParams.get("instructions") ?? undefined;
      wantJson = url.searchParams.get("verbose") === "1";
      const maxParam = Number.parseInt(url.searchParams.get("max_labels") ?? "", 10);
      if (url.searchParams.get("multi") === "1" || maxParam > 0) {
        multi = { max: maxParam > 0 ? maxParam : undefined };
      }
    }

    const fail = (msg: string, status: number, reason: string, extra: Record<string, string> = {}, ms = 0) => {
      record(env, ctx, { tier, n: 0, ms, labels, ip, country, status, client, model: "",
        usd: meter.usd, reason, agent, attempted: inputs.length, escalationFailed: 0 });
      return wantJson ? json({ error: msg }, status, extra) : text(`error: ${msg}\n`, status, extra);
    };

    if (!inputs.length || !inputs[0]) return fail("Provide text to classify. See https://classifier.dev", 400, "no_input");
    if (inputs.length > MAX_INPUTS) return fail(`Maximum ${MAX_INPUTS} inputs per request`, 400, "too_many_inputs");
    if (labels.length < 2) return fail("Provide at least 2 labels", 400, "too_few_labels");
    if (labels.length > MAX_LABELS) return fail(`Maximum ${MAX_LABELS} labels`, 400, "too_many_labels");
    if (labels.some((l) => typeof l !== "string" || !l.trim())) return fail("Labels must be non-empty strings", 400, "empty_label");
    if (new Set(labels).size !== labels.length) return fail("Labels must be distinct", 400, "duplicate_labels");
    if (inputs.some((i) => typeof i !== "string" || !i.trim())) return fail("Inputs must be non-empty strings", 400, "empty_input");
    if (inputs.some((i) => i.length > MAX_CHARS)) return fail(`Each input must be under ${MAX_CHARS} characters`, 400, "input_too_long");

    const rpm = TIERS[tier].rpm;
    const gate = enterprise
      ? { limited: false, remaining: -1 }
      : await limited(env, tier, ip, inputs.length);
    if (gate.limited) {
      const perDay = gate.scope === "day";
      return fail(
        perDay
          ? `Daily limit reached: ${TIERS[tier].daily} ${tier} classifications per IP per day. Need more? https://cal.com/michaelsf/coffee`
          : `Rate limit: ${rpm} ${tier} classifications/minute per IP. Need more? https://cal.com/michaelsf/coffee`,
        429,
        perDay ? "rate_limit_day" : "rate_limit_minute",
        {
          "retry-after": String(gate.resetIn ?? 60),
          "x-ratelimit-limit": perDay ? `${TIERS[tier].daily}/day` : `${rpm}/min`,
          "x-ratelimit-remaining": "0",
        },
      );
    }

    const started = Date.now();
    let results: Result[];
    let escalationFailed = 0;
    try {
      ({ results, escalationFailed } = await classifyMany(env, inputs, labels, tier, instructions, multi, meter));
    } catch (e) {
      const msg = (e as Error).message;
      return fail(`upstream: ${msg}`, 502, upstreamReason(msg), {}, Date.now() - started);
    }
    const ms = Date.now() - started;
    const modelSummary = summarizeModels(results);
    record(env, ctx, {
      tier, n: results.length, ms, labels, ip, country, status: 200, client,
      model: modelSummary.modelsUsed.join(","), usd: meter.usd,
      reason: "", agent, attempted: inputs.length, escalationFailed,
    });

    // The native limiter reports only pass/fail, so we publish the ceiling, not a
    // fabricated remaining count. The limit is also documented at GET /.
    const headers: Record<string, string> = {
      "x-ratelimit-limit": enterprise ? "unlimited" : `${rpm}/min`,
    };
    if (gate.remaining >= 0) headers["x-ratelimit-remaining"] = String(gate.remaining);

    if (!wantJson) {
      // r.jina.ai style: the answer, nothing else. Multi-label answers are one
      // label per line, so the response stays greppable.
      const body = multi
        ? results.map((r) => (r.labels ?? []).join("\n")).join("\n")
        : results.map((r) => r.label).join("\n");
      return text(body + "\n", 200, headers);
    }
    if (req.method === "GET") {
      return json({ ...results[0], tier }, 200, headers);
    }
    return json(
      {
        tier,
        ...modelSummary,
        results: results.map((r) =>
          multi
            ? { labels: r.labels ?? [], scores: r.scores, unscored: r.unscored, ms: r.ms, model: r.model }
            : {
                label: r.label,
                confidence: r.confidence,
                scores: r.scores,
                unscored: r.unscored,
                escalated: r.escalated,
                ms: r.ms,
                model: r.model,
              },
        ),
        usage: {
          classifications: results.length,
          escalated: results.filter((r) => r.escalated).length,
          ...(escalationFailed ? { escalation_failed: escalationFailed } : {}),
          ms,
        },
      },
      200,
      headers,
    );
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // The quarter-hourly trigger is the alert check; the three daily ones are
    // the digest. An alert failure must not be silent, since silence is what
    // this is here to prevent.
    if (controller.cron === ALERT_CRON) {
      ctx.waitUntil(
        runAlerts(env, { send: true }).catch((e) => console.error(`alerts failed: ${(e as Error).message}`)),
      );
      return;
    }
    ctx.waitUntil(dailyReport(env, { send: true, primaries: primaryModels() }));
  },
};
