import { DOCS, BENCHMARK } from "./docs";
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
const MAX_CHARS = 32_000;

const TIERS = {
  fast: { model: "inclusionai/ling-2.6-flash", provider: "Novita", maxTokens: 1, reasoning: false, rpm: 60 },
  smart: { model: "qwen/qwen3.7-flash", provider: "Alibaba", maxTokens: 2000, reasoning: true, rpm: 10 },
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

async function classifyOne(
  env: Env,
  input: string,
  labels: string[],
  tier: Tier,
  instructions?: string,
) {
  const cfg = TIERS[tier];
  const body: Record<string, unknown> = {
    model: cfg.model,
    provider: { only: [cfg.provider], allow_fallbacks: false },
    messages: [
      { role: "system", content: buildPrompt(labels, instructions) },
      { role: "user", content: `${input}\nANSWER:` },
    ],
    max_tokens: cfg.maxTokens,
    temperature: 0,
  };
  if (cfg.reasoning) body.reasoning = { effort: "low" };
  else {
    body.reasoning = { enabled: false };
    body.logprobs = true;
    body.top_logprobs = 8;
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
      const letter = parseLetter(choice?.message?.content ?? "", labels.length);
      const raw = scoresFrom(choice?.logprobs?.content?.[0]?.top_logprobs, labels.length);
      const idx = letter ? LETTERS.indexOf(letter) : -1;
      const label = idx >= 0 && idx < labels.length ? labels[idx] : labels[0];
      const scores = raw
        ? Object.fromEntries(
            Object.entries(raw).map(([l, v]) => [labels[LETTERS.indexOf(l)] ?? l, Number(v.toFixed(4))]),
          )
        : null;
      return {
        label,
        confidence: scores ? Number(Math.max(...Object.values(scores)).toFixed(4)) : null,
        scores,
        ms: Date.now() - started,
      };
    }
    last = payload.error?.message ?? `upstream ${res.status}`;
    if (!/429|rate|timeout|50\d|Provider returned error/i.test(last)) break;
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  throw new Error(last || "upstream failure");
}

async function classifyMany(
  env: Env,
  inputs: string[],
  labels: string[],
  tier: Tier,
  instructions?: string,
) {
  const out: Awaited<ReturnType<typeof classifyOne>>[] = new Array(inputs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, inputs.length) }, async () => {
      while (next < inputs.length) {
        const i = next++;
        out[i] = await classifyOne(env, inputs[i], labels, tier, instructions);
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
      `https://limiter/?limit=${rpm}&cost=${cost}`,
    );
    return (await res.json()) as { limited: boolean; remaining: number; resetIn?: number };
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
    if (req.method === "GET" && (path === "" || path === "index.html")) return text(DOCS);
    if (req.method === "GET" && (path === "benchmark" || path === "benchmark.md")) return text(BENCHMARK);
    if (path === "robots.txt") return text("User-agent: *\nAllow: /\n");
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
    if (path === "favicon.ico") return new Response(null, { status: 204 });

    // ---- gather params from either shape -----------------------------------
    let inputs: string[] = [];
    let labels: string[] = [];
    let tier: Tier = "fast";
    let instructions: string | undefined;
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
    }

    const fail = (msg: string, status: number, extra: Record<string, string> = {}) =>
      wantJson ? json({ error: msg }, status, extra) : text(`error: ${msg}\n`, status, extra);

    if (!inputs.length || !inputs[0]) return fail("Provide text to classify. See https://classifier.dev", 400);
    if (inputs.length > MAX_INPUTS) return fail(`Maximum ${MAX_INPUTS} inputs per request`, 400);
    if (labels.length < 2) return fail("Provide at least 2 labels", 400);
    if (labels.length > 26) return fail("Maximum 26 labels", 400);
    if (inputs.some((i) => typeof i !== "string" || !i.trim())) return fail("Inputs must be non-empty strings", 400);
    if (inputs.some((i) => i.length > MAX_CHARS)) return fail(`Each input must be under ${MAX_CHARS} characters`, 400);

    const rpm = TIERS[tier].rpm;
    const gate = await limited(env, tier, ip, inputs.length);
    if (gate.limited) {
      record(env, ctx, { tier, n: 0, ms: 0, labels, ip, country, status: 429 });
      return fail(
        `Rate limit: ${rpm} ${tier} requests/minute per IP. Need more? https://cal.com/michaelsf/coffee`,
        429,
        { "retry-after": "60", "x-ratelimit-limit": `${rpm}/min`, "x-ratelimit-remaining": "0" },
      );
    }

    const started = Date.now();
    let results;
    try {
      results = await classifyMany(env, inputs, labels, tier, instructions);
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
      // r.jina.ai style: the answer, nothing else.
      return text(results.map((r) => r.label).join("\n") + "\n", 200, headers);
    }
    if (req.method === "GET") {
      return json({ ...results[0], tier, model: TIERS[tier].model }, 200, headers);
    }
    return json(
      {
        tier,
        model: TIERS[tier].model,
        results: results.map((r) => ({ label: r.label, confidence: r.confidence, scores: r.scores, ms: r.ms })),
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
