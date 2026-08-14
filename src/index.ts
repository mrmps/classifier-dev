import { isUnintelligible, UNSCORED_REASON } from "./unintelligible";
import { SKILL_MD, skillIndex } from "./skill";
import { DOCS, BENCHMARK } from "./docs";
import { OPENAPI, LLMS_TXT } from "./openapi";
import { FAVICON_SVG, ogPngBytes, UNFURLERS, unfurlHtml } from "./brand";
import { dailyReport } from "./report";
export { RateLimiter } from "./limiter";

export interface Env {
  OPENROUTER_API_KEY: string;
  RESEND_API_KEY: string;
  REPORT_TO: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CF_ANALYTICS_TOKEN: string;
  STATS: KVNamespace;
  LIMITER: DurableObjectNamespace;
  AE: AnalyticsEngineDataset;
  REPORT_KEY: string;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const MAX_INPUTS = 20;
// Single-label answers ride on one letter token, which is what caps them at 26.
// Multi-label answers come back as numbers, so the ceiling is only prompt size.
const MAX_LABELS_SINGLE = 26;
const MAX_LABELS_MULTI = 100;
const MAX_CHARS = 32_000;

/**
 * Each tier is a chain, not a single model. The primary is the cheapest thing
 * that clears the accuracy bar; the fallback is on a *different* provider so a
 * provider-side outage cannot take the tier down. Measured failure rate on the
 * primary alone was about 15%, and ling-2.6-flash is served by exactly one
 * provider, so retries against it could not help.
 */
const TIERS = {
  fast: {
    rpm: 60,
    daily: 5000,
    chain: [
      { model: "inclusionai/ling-2.6-flash", provider: "Novita", maxTokens: 1, reasoning: false },
      { model: "ibm-granite/granite-4.0-h-micro", provider: "Cloudflare", maxTokens: 1, reasoning: false },
      { model: "mistralai/mistral-nemo", provider: "DeepInfra", maxTokens: 1, reasoning: false },
    ],
  },
  smart: {
    rpm: 10,
    daily: 500,
    chain: [
      { model: "qwen/qwen3.7-flash", provider: "Alibaba", maxTokens: 2000, reasoning: true },
      { model: "deepseek/deepseek-v4-flash-0731", provider: undefined, maxTokens: 2000, reasoning: true },
    ],
  },
} as const;
type Tier = keyof typeof TIERS;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "Content-Type",
};

const text = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...CORS, ...extra },
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
) {
  const body: Record<string, unknown> = {
    model: cfg.model,
    provider: { only: [cfg.provider], allow_fallbacks: false },
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
    };
    if (res.ok && !payload.error) {
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

/** Walk the tier's chain; the first model that answers wins. */
async function runChain(
  env: Env,
  input: string,
  labels: string[],
  tier: Tier,
  instructions?: string,
  multi?: MultiOpts,
) {
  let last: unknown;
  for (const cfg of TIERS[tier].chain) {
    try {
      return await callModel(env, cfg as ModelCfg, input, labels, instructions, multi);
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
) {
  if (!multi || labels.length <= MULTI_CHUNK) {
    return runChain(env, input, labels, tier, instructions, multi);
  }

  const groups = Math.ceil(labels.length / MULTI_CHUNK);
  const size = Math.ceil(labels.length / groups);
  const chunks: string[][] = [];
  for (let i = 0; i < labels.length; i += size) chunks.push(labels.slice(i, i + size));

  const started = Date.now();
  // No per-chunk cap: a chunk cannot know what the others found.
  const parts = await Promise.all(
    chunks.map((chunk) => runChain(env, input, chunk, "fast", instructions, {})),
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
      });
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

async function classifyMany(
  env: Env,
  inputs: string[],
  labels: string[],
  tier: Tier,
  instructions?: string,
  multi?: MultiOpts,
) {
  const out: Awaited<ReturnType<typeof classifyOne>>[] = new Array(inputs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, inputs.length) }, async () => {
      while (next < inputs.length) {
        const i = next++;
        out[i] = await classifyOne(env, inputs[i], labels, tier, instructions, multi);
      }
    }),
  );
  return out;
}

/** Fingerprint a label set so we can count distinct classifiers without storing text. */
function classifierId(labels: string[]) {
  return [...labels].map((l) => l.toLowerCase().trim()).sort().join("|").slice(0, 120);
}

function record(env: Env, ctx: ExecutionContext, d: {
  tier: Tier; n: number; ms: number; labels: string[]; ip: string; country: string; status: number;
}) {
  try {
    env.AE?.writeDataPoint({
      blobs: [d.tier, classifierId(d.labels), d.country, String(d.status)],
      doubles: [d.n, d.ms],
      indexes: [d.ip.slice(0, 32)],
    });
  } catch {
    /* analytics must never break a request */
  }
  // Distinct classifier registry, for the daily digest. Cheap: one write per new label set.
  ctx.waitUntil(
    (async () => {
      try {
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

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (req.method === "GET" && (path === "" || path === "index.html")) {
      if (UNFURLERS.test(req.headers.get("user-agent") ?? "")) {
        return new Response(unfurlHtml(), {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600", ...CORS },
        });
      }
      return text(DOCS);
    }
    if (req.method === "GET" && (path === "benchmark" || path === "benchmark.md")) return text(BENCHMARK);
    if (path === "robots.txt") {
      return text("User-agent: *\nAllow: /\n\nSitemap: https://classifier.dev/llms.txt\n");
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
    // Preview the daily digest on demand (also proves the cron path works).
    if (req.method === "GET" && path === "report") {
      if (!env.REPORT_KEY || url.searchParams.get("key") !== env.REPORT_KEY) {
        return text("not found\n", 404);
      }
      const send = url.searchParams.get("send") === "1";
      try {
        const body = await dailyReport(env, { send });
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
    if (path === "og.png" || path === "og-v2.png") {
      return new Response(ogPngBytes(), {
        headers: {
          "content-type": "image/png",
          "cache-control": path === "og-v2.png"
            ? "public, max-age=31536000, immutable"
            : "public, max-age=86400",
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

    const fail = (msg: string, status: number, extra: Record<string, string> = {}) =>
      wantJson ? json({ error: msg }, status, extra) : text(`error: ${msg}\n`, status, extra);

    if (!inputs.length || !inputs[0]) return fail("Provide text to classify. See https://classifier.dev", 400);
    if (inputs.length > MAX_INPUTS) return fail(`Maximum ${MAX_INPUTS} inputs per request`, 400);
    if (labels.length < 2) return fail("Provide at least 2 labels", 400);
    // A single-label answer rides on one letter, so past 26 the request can only
    // sensibly be multi-label. Rather than reject it, switch modes.
    if (!multi && labels.length > MAX_LABELS_SINGLE) multi = {};

    const labelCap = multi ? MAX_LABELS_MULTI : MAX_LABELS_SINGLE;
    if (labels.length > labelCap) {
      return fail(
        multi
          ? `Maximum ${MAX_LABELS_MULTI} labels`
          : `Maximum ${MAX_LABELS_SINGLE} labels`,
        400,
      );
    }
    if (inputs.some((i) => typeof i !== "string" || !i.trim())) return fail("Inputs must be non-empty strings", 400);
    if (inputs.some((i) => i.length > MAX_CHARS)) return fail(`Each input must be under ${MAX_CHARS} characters`, 400);

    const rpm = TIERS[tier].rpm;
    const gate = await limited(env, tier, ip, inputs.length);
    if (gate.limited) {
      record(env, ctx, { tier, n: 0, ms: 0, labels, ip, country, status: 429 });
      const perDay = gate.scope === "day";
      return fail(
        perDay
          ? `Daily limit reached: ${TIERS[tier].daily} ${tier} classifications per IP per day. Need more? https://cal.com/michaelsf/coffee`
          : `Rate limit: ${rpm} ${tier} classifications/minute per IP. Need more? https://cal.com/michaelsf/coffee`,
        429,
        {
          "retry-after": String(gate.resetIn ?? 60),
          "x-ratelimit-limit": perDay ? `${TIERS[tier].daily}/day` : `${rpm}/min`,
          "x-ratelimit-remaining": "0",
        },
      );
    }

    const started = Date.now();
    let results;
    try {
      results = await classifyMany(env, inputs, labels, tier, instructions, multi);
    } catch (e) {
      record(env, ctx, { tier, n: 0, ms: Date.now() - started, labels, ip, country, status: 502 });
      return fail(`upstream: ${(e as Error).message}`, 502);
    }
    const ms = Date.now() - started;
    record(env, ctx, { tier, n: results.length, ms, labels, ip, country, status: 200 });

    // The native limiter reports only pass/fail, so we publish the ceiling, not a
    // fabricated remaining count. The limit is also documented at GET /.
    const headers: Record<string, string> = { "x-ratelimit-limit": `${rpm}/min` };
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
        model: results[0]?.model,
        results: results.map((r) =>
          multi
            ? { labels: r.labels ?? [], ms: r.ms, model: r.model }
            : { label: r.label, confidence: r.confidence, scores: r.scores, unscored: r.unscored, ms: r.ms, model: r.model },
        ),
        usage: { classifications: results.length, ms },
      },
      200,
      headers,
    );
  },

  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dailyReport(env));
  },
};
