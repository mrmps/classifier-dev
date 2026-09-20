import { HL_ORIGIN } from "./ui";
import { SKILL_MD, skillIndex } from "./skill";
import { DOCS, BENCHMARK } from "./docs";
import { OPENAPI, LLMS_TXT, type ErrorCode } from "./openapi";
import { FAVICON_SVG, ogPngBytes, UNFURLERS, unfurlHtml } from "./brand";
import { homeHtml, benchmarkHtml, docHtml } from "./home";
import { handleMcp, productServer, docsServer, type ClassifyFn } from "./mcp";
import { ABOUT, CONTACT, DEVELOPERS, MCP_SETUP, PRICING, PRIVACY, TERMS, isHeading, toMarkdown } from "./pages";
import { AGENTS_MD } from "./agents";
import { VS_JEV } from "./vsjev";
import { chatStream, parseMessages } from "./chat";
import {
  AUTH_MD, AI_CATALOG_TYPE, API_CATALOG_TYPE, MCP_REGISTRY_AUTH, SERVER_CARD_TYPE, agentCard, apiCatalog, ardCatalog, docsServerCard,
  oauthProtectedResource, securityTxt, robotsTxt, serverCard, sitemapXml,
} from "./wellknown";
import { dailyReport } from "./report";
import { runAlerts } from "./alerts";
import * as feedback from "./feedback";
import * as newsletter from "./newsletter";
import * as skills from "./skills";
import { jevClassify, jevKeys, MULTI_THRESHOLD } from "./jev";
import { LAYA_LIMITS, LayaError, planLaya, runLaya, limitLaya, layaModel, type LayaEnv, type LayaPlan, type LayaTiming, type Processing } from "./laya";
import { readDimensions, packDimensions, classifyDimensions, dimensionInstructions, MAX_DECISIONS, type Dimension, type DimensionBatch } from "./dimensions";
import { newMeter, addUsd, addTokens, type Meter } from "./cost";
import { secretEquals } from "./secrets";
import { callerId, labelFingerprint } from "./privacy";
import { adminResponse } from "./admin";
import { hasClassifyQuery, readGet, readTier, suggest, USAGE, type GetRequest } from "./query";
export { RateLimiter } from "./limiter";
export { BillingAccount } from "./billing";
import { authenticatePro, handleBilling, BillingError, type BillingEnv } from "./billing";
import { pricingHtml } from "./pricingui";

export interface Env extends BillingEnv, LayaEnv {
  OPENROUTER_API_KEY: string;
  TYPESAFE_API_KEY?: string;
  /**
   * Vercel AI Gateway, which serves Jev on a free monthly credit. With it set,
   * Jev is asked there first and TYPESAFE_API_KEY catches what the gateway
   * refuses (see src/jev.ts). Either key alone is enough to run the fast tier.
   */
  AI_GATEWAY_API_KEY?: string;
  /** Operational rollback: keep the key but send Jev directly to TypeSafe. */
  AI_GATEWAY_DISABLED?: string;
  JEV_AE?: AnalyticsEngineDataset;
  /** context.dev, for the chat's web search and page reads only. Never served. */
  CONTEXT_API_KEY?: string;
  ENTERPRISE_API_KEY?: string;
  /** Dedicated operator credential for bulk agent work; independent of enterprise callers. */
  AGENT_API_KEY?: string;
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
  /**
   * Keys the hashes in src/privacy.ts, which stand in for the caller's IP and
   * label set everywhere either would otherwise be written down. Random, and
   * unrelated to everything else here. See src/privacy.ts for what falls back
   * to what when it is unset.
   */
  PRIVACY_SALT?: string;
  /**
   * The token OpenAI's plugin portal issues when a draft claims this domain;
   * served verbatim at /.well-known/openai-apps-challenge until the claim is
   * checked. A Wrangler secret, never in the repository.
   */
  OPENAI_APPS_CHALLENGE?: string;
  /** Shared application Postgres, including the subscriber table. */
  DATABASE_URL?: string;
  NEWSLETTER_CONFIRMATION_SECRET?: string;
  NEWSLETTER_FROM?: string;
  NEWSLETTER_RESEND_API_KEY?: string;
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
    // Jev put under 0.7 confidence (eval/fallback_bench.py, 2026-09-20):
    //   six-way emotion, 122 items   jev 36.9%  gemini-3.8-flash 46.7%  qwen3.8-flash 34.4%
    //   four-way news, 49 items      jev 65.3%  gemini-3.8-flash 87.8%  qwen3.8-flash 75.5%
    // Qwen's combined gain over retaining Jev was 2/171 answers and it made
    // emotion worse, so a failed Gemini escalation now leaves Jev's answer
    // standing instead of paying for a second, weaker reasoning model.
    // Frontier models do much better here (claude-fable-5.1: 71.3% / 91.8%)
    // but cost ~$2 per thousand escalations; the brief is fast and cheap.
    chain: [
      { model: "google/gemini-3.8-flash", provider: undefined, maxTokens: 2000, reasoning: true },
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
  const out: string[] = ["jev", "laya"];
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
  "access-control-allow-headers": "Content-Type, Authorization, Accept, Idempotency-Key, If-None-Match, Mcp-Session-Id, MCP-Protocol-Version",
  "access-control-expose-headers": "RateLimit-Limit, RateLimit-Remaining, RateLimit-Policy, Retry-After, x-api-version, Idempotency-Key",
};

/**
 * On every answer, whatever its content type. None of it is negotiable by a
 * caller and none of it costs anything: HTTPS only from here on, no sniffing a
 * content type we already stated, and a path in the Referer header is nobody
 * else's business. `preload` is deliberately not on the HSTS line — that is a
 * commitment to a browser list that is slow and awkward to walk back.
 */
const SECURITY = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

/**
 * What a page of ours may do, which is talk to this origin and nothing else.
 *
 * The scripts are named by hash rather than by nonce. These pages are public
 * and the edge caches them for five minutes, and a nonce on a response handed
 * to everyone for five minutes is a nonce an attacker can read off the page and
 * paste into their own injection. A hash stays true however long the page is
 * cached, and every script here is ours and fixed, so there is nothing to
 * thread through the builders and nothing to forget.
 */
const SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const policies = new Map<string, string>();

async function pagePolicy(body: string): Promise<string> {
  const scripts = [...body.matchAll(SCRIPT)].map((m) => m[1]);
  const cached = policies.get(scripts.join("\u0000"));
  if (cached) return cached;
  const hashes = await Promise.all(
    scripts.map(async (src) => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(src));
      return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
    }),
  );
  const policy = [
    "default-src 'none'",
    // Our own scripts by hash, and highlight.js by its one directory on cdnjs
    // (the path, not the host, so nothing else hosted there is allowed in).
    `script-src ${[...hashes, HL_ORIGIN].join(" ")}`,
    // Inline `style=` attributes are how the pages draw; none of them is
    // caller-controlled, and no page here loads a stylesheet from anywhere.
    "style-src 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https://classifier.dev",
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
  // Bounded by the number of distinct pages, which is a handful.
  if (policies.size < 64) policies.set(scripts.join("\u0000"), policy);
  return policy;
}

const API_VERSION = "v1";

/** Markdown for agents that ask for it: same document, one content type over. */
const markdown = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/markdown; charset=utf-8", vary: "accept, user-agent", ...CORS, ...SECURITY, ...extra },
  });

/** RFC 8288 Link headers on the pages agents land on, so discovery needs no parsing. */
const LINKS = (origin: string) =>
  [
    `<${origin}/sitemap.xml>; rel="sitemap"; type="application/xml"`,
    `<${origin}/index.md>; rel="alternate"; type="text/markdown"`,
    `<${origin}/openapi.json>; rel="service-desc"; type="application/openapi+json"`,
    `<${origin}/developers>; rel="service-doc"`,
    // RFC 8288 quotes the whole type; the profile parameter's own quotes go
    // in as quoted-pairs, so the value is still one well-formed media type.
    `<${origin}/.well-known/api-catalog>; rel="api-catalog"; type="${API_CATALOG_TYPE.replace(/"/g, '\\"')}"`,
    `<${origin}/.well-known/mcp/server-card.json>; rel="describedby"; type="application/json"; title="MCP server card"`,
    `<${origin}/llms.txt>; rel="help"; type="text/plain"`,
    `<${origin}/agents.md>; rel="help"; type="text/markdown"; title="For agents"`,
  ].join(", ");

/** The machine view of the front page: where everything is, in one JSON object. */
const agentView = (origin: string) => ({
  name: "classifier.dev",
  description: "Zero-shot text classification over plain HTTP. No API key, no account.",
  version: API_VERSION,
  authentication: { required: false, optional_bearer: "Workspace keys use the workspace balance; legacy Pro and partner keys retain their arranged limits", docs: `${origin}/auth.md` },
  api: {
    classify: { method: "POST", url: `${origin}/v1/classify`, alias: `${origin}/`, body: { inputs: ["..."], labels: ["a", "b"], tier: "fast|smart", multi: false } },
    classify_dimensions: { method: "POST", url: `${origin}/v1/classify`, body: { items: ["..."], dimensions: { team: ["billing", "platform"], kind: ["bug", "request"] } } },
    classify_one: { method: "GET", url: `${origin}/{labels}/{text}`, query_form: `${origin}/?labels={a,b}&text={text}` },
    subscribe: {
      method: "POST", url: `${origin}/${newsletter.SUBSCRIBE_PATH}`,
      content_type: "application/json", body: { email: "agent@example.com", wants: ["faster"], desired_latency_ms: 100 },
      description: "Subscribe your own inbox to product updates. Use an address you control, or one whose owner explicitly requested updates. No API key or browser needed. `wants` is optional: the roadmap items the subscriber would use first. `desired_latency_ms` is required when `wants` includes `faster`.",
      wants: Object.fromEntries(newsletter.ROADMAP.map((r) => [r.key, `${r.name}: ${r.what}`])),
      confirmation_required: true,
      confirm: { method: "POST", url: `${origin}/${newsletter.CONFIRM_PATH}`, body: { token: "token from the confirmation email" } },
      response: { status: 202, body: { ok: true, status: "pending_confirmation" } },
      limits: "5 signups/min, 50/day per IP; retry a 429 after Retry-After seconds",
      unsubscribe: "Reply to an update to unsubscribe.",
    },
    skills: {
      list: { method: "GET", url: `${origin}/${skills.API_PATH}`, description: "Skills by agents, reviewed and ranked. Each is raw Markdown at /skills/{name}.md." },
      submit: {
        method: "POST", url: `${origin}/${skills.API_PATH}`, content_type: "application/json",
        body: { skill: "<the SKILL.md text>", author: "optional handle or URL", source: "optional https URL" },
        description: "Submit a SKILL.md for review by a scanner, the decision model and a reasoning model. The answer is the review either way; 201 when listed.",
        limits: `${skills.PER_IP_PER_HOUR} reviews/hour per IP, ${skills.GLOBAL_PER_DAY}/day for everyone`,
      },
      page: `${origin}/${skills.SKILLS_PATH}`,
    },
    openapi: `${origin}/openapi.json`,
  },
  mcp: { tools: `${origin}/mcp`, docs: `${origin}/mcp/docs`, card: `${origin}/.well-known/mcp/server-card.json`, setup: `${origin}/mcp-setup` },
  cli: { install: "npm i -g classifier-dev", example: "classify bug,feature,praise < feedback.txt" },
  sdks: { python: 'pip install "classifier-dev @ git+https://github.com/mrmps/classifier-dev.git@python-v0.1.0#subdirectory=sdk/python"', go: "go get github.com/mrmps/classifier-dev/sdk/go", javascript: "fetch(); no package needed" },
  skill: { install: `npx skills add ${origin}`, url: `${origin}/skill.md` },
  limits: { fast: "3,000 classifications/min, 20,000/day per IP", smart: "200/min, 2,000/day per IP", headers: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Policy", "Retry-After"] },
  pricing: { price: 0, currency: "USD", url: `${origin}/pricing` },
  docs: { llms: `${origin}/llms.txt`, developers: `${origin}/developers`, benchmark: `${origin}/benchmark`, privacy: `${origin}/privacy`, terms: `${origin}/terms`, contact: `${origin}/contact` },
  discovery: [`${origin}/.well-known/ard.json`, `${origin}/.well-known/agent-card.json`, `${origin}/.well-known/api-catalog`, `${origin}/.well-known/agent-skills/index.json`, `${origin}/sitemap.xml`],
});

/** Everything that is not a route: a real 404 that says where to go, in the caller's format. */
function notFound(req: Request, origin: string) {
  const accept = req.headers.get("accept") ?? "";
  const pointers = { docs: `${origin}/`, llms: `${origin}/llms.txt`, openapi: `${origin}/openapi.json`, sitemap: `${origin}/sitemap.xml` };
  if (/\btext\/markdown\b/.test(accept)) {
    return markdown(
      `# Not found\n\nThere is nothing at this path. The API is \`POST ${origin}/v1/classify\`, \`GET ${origin}/{labels}/{text}\` or \`GET ${origin}/?labels=a,b&text=...\`. ` +
        `Start at [llms.txt](${pointers.llms}), the [documentation](${pointers.docs}), the [OpenAPI spec](${pointers.openapi}) or the [sitemap](${pointers.sitemap}).\n`,
      404,
    );
  }
  if (/\bapplication\/json\b/.test(accept) || req.method !== "GET") {
    return json({ error: "Not found. The API is POST /v1/classify, GET /{labels}/{text} or GET /?labels=a,b&text=...", code: "not_found", see: pointers }, 404, { vary: "accept" });
  }
  return markdown(
    `# Not found\n\nThere is nothing at this path. The API is \`POST ${origin}/v1/classify\`, \`GET ${origin}/{labels}/{text}\` or \`GET ${origin}/?labels=a,b&text=...\`.\n\n` +
      `Start at ${pointers.llms}, the documentation at ${pointers.docs}, the OpenAPI spec at ${pointers.openapi} or the sitemap at ${pointers.sitemap}.\n`,
    404,
  );
}

/** The plain-text pages and how each is described to browsers and crawlers. */
const PAGE_DOCS: Record<string, { doc: string; title: string; desc: string }> = {
  developers: { doc: DEVELOPERS, title: "developers", desc: "Quickstart, every surface (REST, MCP, CLI, skill), limits, errors, versioning. No key needed." },
  "mcp-setup": { doc: MCP_SETUP, title: "MCP setup", desc: "Connect classifier.dev to Claude, ChatGPT, Codex, Cursor or any MCP client, step by step." },
  pricing: { doc: PRICING, title: "pricing", desc: "Start free, then add a workspace plan for usage credits, API keys and billing." },
  about: { doc: ABOUT, title: "about", desc: "What classifier.dev is, why it exists, what it runs on, and who runs it." },
  contact: { doc: CONTACT, title: "contact", desc: "How to reach a person: issues, a call, email." },
  privacy: { doc: PRIVACY, title: "privacy", desc: "Inputs are not stored. What is logged, and what is not collected." },
  terms: { doc: TERMS, title: "terms", desc: "Free within the limits, offered as is; what you agree to by using it." },
};

const DOCS_MCP = docsServer([
  { id: "api", title: "classifier.dev API reference", url: "https://classifier.dev/", text: DOCS },
  { id: "developers", title: "Developer guide", url: "https://classifier.dev/developers", text: DEVELOPERS },
  { id: "mcp-setup", title: "MCP setup", url: "https://classifier.dev/mcp-setup", text: MCP_SETUP },
  { id: "benchmark", title: "Benchmark", url: "https://classifier.dev/benchmark", text: BENCHMARK },
  { id: "skill", title: "Agent skill", url: "https://classifier.dev/skill.md", text: SKILL_MD },
  { id: "llms", title: "llms.txt", url: "https://classifier.dev/llms.txt", text: LLMS_TXT },
  { id: "pricing", title: "Pricing", url: "https://classifier.dev/pricing", text: PRICING },
  { id: "auth", title: "Authentication", url: "https://classifier.dev/auth.md", text: AUTH_MD },
  { id: "agents", title: "For agents: when and how to use classifier.dev", url: "https://classifier.dev/agents.md", text: AGENTS_MD },
  { id: "privacy", title: "Privacy", url: "https://classifier.dev/privacy", text: PRIVACY },
  { id: "terms", title: "Terms", url: "https://classifier.dev/terms", text: TERMS },
  { id: "about", title: "About", url: "https://classifier.dev/about", text: ABOUT },
  { id: "contact", title: "Contact", url: "https://classifier.dev/contact", text: CONTACT },
]);

/** Every documentation section, flattened, for GET /v1/docs. Ids are stable while headings are. */
function docSections() {
  const out: { id: string; doc: string; heading: string; url: string; text: string }[] = [];
  const src: [string, string, string][] = [
    ["api", DOCS, "https://classifier.dev/"], ["developers", DEVELOPERS, "https://classifier.dev/developers"],
    ["mcp-setup", MCP_SETUP, "https://classifier.dev/mcp-setup"], ["benchmark", BENCHMARK, "https://classifier.dev/benchmark"],
    ["pricing", PRICING, "https://classifier.dev/pricing"], ["privacy", PRIVACY, "https://classifier.dev/privacy"], ["terms", TERMS, "https://classifier.dev/terms"],
    ["about", ABOUT, "https://classifier.dev/about"], ["contact", CONTACT, "https://classifier.dev/contact"],
  ];
  for (const [doc, text, url] of src) {
    let heading = "intro";
    let buf: string[] = [];
    const flush = () => {
      const body = buf.join("\n").trim();
      if (body) out.push({ id: `${doc}/${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`, doc, heading, url, text: body });
      buf = [];
    };
    for (const line of text.split("\n").slice(1)) {
      if (isHeading(line)) { flush(); heading = line; }
      else buf.push(line);
    }
    flush();
  }
  return out;
}

/** For the cards and catalogs, which describe the tools without running them. */
const PRODUCT_MCP_STATIC = productServer(async () => ({ status: 503, body: { error: "static description only" } }));

/** The MCP endpoints, whose preflight is the transport's own and not the site's. */
const MCP_PATHS = new Set(["mcp", ".well-known/mcp", "mcp/docs"]);
/** One chat turn counts against the smart-tier window as this many classifications: ten turns a minute, a hundred a day. */
const CHAT_COST = 20;

const CACHE_HOUR = { "cache-control": "public, max-age=3600" };

/** FNV-1a over the text: a cheap, stable validator for a document that is a pure function of the source. */
function etagOf(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return `"${h.toString(16).padStart(8, "0")}-${text.length.toString(16)}"`;
}

/**
 * A server card, the way the Server Card extension asks for one: its own
 * media type when the client asks for it (plain JSON otherwise), an ETag,
 * and 304 for a client that already holds this version.
 */
function serverCardResponse(req: Request, card: unknown) {
  const text = JSON.stringify(card, null, 2);
  const etag = etagOf(text);
  const accept = req.headers.get("accept") ?? "";
  const type = accept.includes(SERVER_CARD_TYPE) ? SERVER_CARD_TYPE : "application/json; charset=utf-8";
  const headers = { "content-type": type, etag, vary: "accept", ...CORS, ...SECURITY, ...CACHE_HOUR };
  const held = (req.headers.get("if-none-match") ?? "").split(",").map((s) => s.trim().replace(/^W\//, ""));
  if (held.includes(etag) || held.includes("*")) return new Response(null, { status: 304, headers });
  return new Response(text, { headers });
}

const text = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...CORS, ...SECURITY, ...extra },
  });

/** The rendered site. Same document as text(), for clients that asked for HTML. */
const html = async (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      // Representations depend on Accept and agent-specific User-Agent handling.
      vary: "accept, user-agent",
      "content-security-policy": await pagePolicy(body),
      ...CORS,
      ...SECURITY,
      ...extra,
    },
  });

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...SECURITY, ...extra },
  });

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

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

/** Parse the exact number list the prompt asks for; prose is an invalid answer. */
function parseNumbers(answer: string, n: number, max?: number): number[] | null {
  const text = answer.trim();
  if (/^none$/i.test(text)) return [];
  if (!/^\d+(?:\s*,\s*\d+)*$/.test(text)) return null;
  const seen = new Set<number>();
  for (const part of text.split(",")) {
    const v = Number.parseInt(part, 10);
    if (v < 1 || v > n) return null;
    seen.add(v);
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
  if (!Array.isArray(top) || !top.length) return null;
  const valid = LETTERS.slice(0, n);
  const p: Record<string, number> = Object.fromEntries(valid.map((l) => [l, 0]));
  let total = 0;
  for (const t of top) {
    if (!t || typeof t !== "object") continue;
    const token = (t as { token?: unknown }).token;
    const logprob = (t as { logprob?: unknown }).logprob;
    if (typeof token !== "string" || typeof logprob !== "number" || !Number.isFinite(logprob) || logprob > 0) continue;
    const c = token.trim().toUpperCase();
    if (valid.includes(c)) {
      const e = Math.exp(logprob);
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
  const match = (s ?? "").match(/^\s*([A-Z])\s*[.!?)]?\s*$/i);
  const letter = match?.[1]?.toUpperCase();
  return letter && valid.includes(letter) ? letter : null;
}

type ModelCfg = { model: string; provider?: string; maxTokens: number; reasoning: boolean };
type MultiOpts = { max?: number; strict?: boolean };
type OpenRouterChoice = {
  message?: { content?: unknown };
  logprobs?: { content?: { top_logprobs?: { token: string; logprob: number }[] }[] };
};
type OpenRouterPayload = {
  model?: unknown;
  error?: unknown;
  choices?: OpenRouterChoice[];
  usage?: {
    cost?: number;
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown };
  };
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorKind(value: unknown) {
  const error = recordValue(value);
  const raw = error ? (typeof error.code === "string" ? error.code : typeof error.type === "string" ? error.type : "") : "";
  const kind = raw.toLowerCase();
  if (kind.includes("rate") || kind.includes("429")) return "rate_limit";
  if (kind.includes("timeout") || kind.includes("timed_out")) return "timeout";
  if (kind.includes("overload") || kind.includes("capacity") || kind.includes("unavailable")) return "overload";
  return "provider_error";
}

function retryableModelFailure(status: number, malformedSuccess: boolean) {
  return malformedSuccess || status === 408 || status === 425 || status === 429 || status >= 500;
}

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
  let last = "upstream failure";
  for (let attempt = 0; attempt < 3; attempt++) {
    await meter?.beforeCall?.("openrouter", cfg.model, Number(body.max_tokens));
    let res: Response;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          "content-type": "application/json",
          "http-referer": "https://classifier.dev",
          "x-title": "classifier.dev",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.reasoning ? 60_000 : 15_000),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
      last = timeout ? "upstream timeout" : "upstream network failure";
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 200));
      continue;
    }
    const parsed = await res.json().catch(() => null);
    const payload = recordValue(parsed) as OpenRouterPayload | null;
    const choice = payload?.choices?.[0];
    const content = typeof choice?.message?.content === "string" ? choice.message.content : null;
    const malformed = !payload || !Array.isArray(payload.choices) || !choice || content === null;
    const providerError = !!payload?.error;
    if (res.ok && !providerError && !malformed) {
      // Charged only for a call that answered; a failed attempt that falls
      // through to the next model in the chain is not billed here.
      addUsd(meter, payload.usage?.cost);
      addTokens(meter, "openrouter", typeof payload.model === "string" && payload.model ? payload.model : cfg.model, {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
        cachedInputTokens: payload.usage?.prompt_tokens_details?.cached_tokens,
      });
      if (multi) {
        const picked = parseNumbers(content, labels.length, multi.max);
        if (!picked) {
          last = "upstream malformed_response";
          if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 200));
          continue;
        }
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
      const letter = parseLetter(content, labels.length);
      if (!letter) {
        last = "upstream malformed_response";
        if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 200));
        continue;
      }
      const raw = scoresFrom(choice?.logprobs?.content?.[0]?.top_logprobs, labels.length);
      const idx = letter ? LETTERS.indexOf(letter) : -1;
      const label = idx >= 0 && idx < labels.length ? labels[idx] : labels[0];
      const scores =
        raw
          ? Object.fromEntries(
              Object.entries(raw).map(([l, v]) => [labels[LETTERS.indexOf(l)] ?? l, Number(v.toFixed(4))]),
            )
          : null;
      return {
        label,
        labels: undefined as string[] | undefined,
        confidence: scores ? scores[label] : null,
        scores,
        unscored: undefined as string | undefined,
        ms: Date.now() - started,
        model: cfg.model,
      };
    }
    const kind = providerError ? errorKind(payload?.error) : malformed ? "malformed_response" : "provider_error";
    last = `upstream ${res.status}: ${kind}`;
    if (!retryableModelFailure(res.status, res.ok && (providerError || malformed)) || attempt >= 2) break;
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 200));
  }
  throw new Error(last);
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
  // Every chunk shares the request's meter. Wait for all admitted calls before
  // propagating a failure so settlement cannot run ahead of sibling usage.
  const completed = await Promise.allSettled(
    chunks.map((chunk) => runChain(env, input, chunk, "fast", instructions, {}, meter)),
  );
  const parts = completed.map((part) => {
    if (part.status === "rejected") throw part.reason;
    return part.value;
  });

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
      picked = narrowed;
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
  const work = Array.from({ length: Math.min(4, inputs.length) }, async () => {
      while (next < inputs.length) {
        const i = next++;
        const r = await classifyOne(env, inputs[i], labels, tier, instructions, asMulti, meter);
        if (!multi && !r.label) throw new Error("upstream malformed_response");
        out[i] = multi ? r : { ...r, labels: undefined };
      }
    });
  if (meter?.beforeCall) {
    // Do not settle/refund while a sibling provider call is still running.
    const completed = await Promise.allSettled(work);
    const failure = completed.find((entry) => entry.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  } else await Promise.all(work);
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
          if (r.label) results[i] = {
            ...results[i], label: r.label, model: r.model, escalated: true,
            // The first model's probabilities do not describe this answer,
            // even when the reasoning model happens to choose the same label.
            confidence: null, scores: null,
            unscored: "reasoning model does not return comparable probabilities",
          };
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
type LayaRequestTiming = LayaTiming & { runMs?: number };

async function classifyMany(
  env: Env,
  inputs: string[],
  labels: string[],
  tier: Tier,
  instructions?: string,
  multi?: MultiOpts,
  meter?: Meter,
  layaPlan?: LayaPlan,
  layaTiming?: LayaRequestTiming,
): Promise<{ results: Result[]; escalationFailed: number }> {
  const keys = jevKeys(env);
  if (keys || layaPlan) {
    const started = Date.now();
    let jev: Awaited<ReturnType<typeof jevClassify>> | null = null;
    try {
      if (layaPlan) {
        const runStarted = performance.now();
        jev = await runLaya(env, layaPlan, meter, layaTiming);
        if (layaTiming) layaTiming.runMs = performance.now() - runStarted;
      } else jev = await jevClassify(keys!, inputs, labels, instructions, !!multi, meter);
    } catch (e) {
      if (layaPlan) throw e;
      console.warn(`jev failed, falling back: ${(e as Error).message}`);
    }
    if (jev) {
      const ms = Date.now() - started;
      const results: Result[] = jev.map((r) => {
        if (multi) {
          let picked = labels
            .filter((l) => r.scores[l] >= MULTI_THRESHOLD)
            .sort((a, b) => r.scores[b] - r.scores[a]);
          if (multi.max) picked = picked.slice(0, multi.max);
          return {
            label: picked[0] ?? "",
            labels: picked,
            confidence: null,
            scores: r.scores,
            unscored: undefined,
            ms,
            model: r.model,
          };
        }
        return {
          label: r.label,
          confidence: r.confidence,
          scores: r.scores,
          unscored: undefined,
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

/** Keep each field independent, including smart escalation and the bounded LLM fallback. */
async function classifyMatrix(env: Env, inputs: string[], dimensions: Dimension[], batches: DimensionBatch[], tier: Tier, instructions: string | undefined, meter: Meter, layaPlan?: LayaPlan, layaTiming?: LayaRequestTiming) {
  const started = Date.now();
  let jev: Awaited<ReturnType<typeof classifyDimensions>> | undefined;
  const keys = jevKeys(env);
  if (layaPlan) {
    const runStarted = performance.now();
    const flat = await runLaya(env, layaPlan, meter, layaTiming);
    if (layaTiming) layaTiming.runMs = performance.now() - runStarted;
    jev = inputs.map((_, i) => flat.slice(i * dimensions.length, (i + 1) * dimensions.length));
  } else if (keys) {
    try { jev = await classifyDimensions(keys, batches, meter); }
    catch (e) { console.warn(`dimensions Jev failed: ${(e as Error).message}`); }
  }
  if (!jev && inputs.length * dimensions.length > FALLBACK_MAX_INPUTS) {
    throw new Error(`batch classification is temporarily unavailable; send up to ${FALLBACK_MAX_INPUTS} decisions or retry shortly`);
  }
  const results: Result[][] = inputs.map(() => []);
  let escalationFailed = 0;
  let fallbackDecisions = 0;
  // Sequential dimensions bound fallback/escalation concurrency across the entire request.
  for (const [d, dimension] of dimensions.entries()) {
    const criteria = dimensionInstructions(dimension, instructions);
    const column: Result[] = jev ? inputs.map((_, i) => ({
      ...jev[i][d], ms: Date.now() - started,
    })) : await llmClassifyMany(env, inputs, dimension.labels, tier, criteria, undefined, meter);
    if (!jev) fallbackDecisions += column.length;
    if (jev && tier === "smart") {
      escalationFailed += await escalate(env, inputs, dimension.labels, criteria, column, meter);
    }
    column.forEach((r, i) => { results[i][d] = r; });
  }
  return { results, escalationFailed, fallbackDecisions };
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
  if (s.startsWith("mcp/")) return "mcp";
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
function upstreamReason(msg: string): ErrorCode {
  const m = msg.toLowerCase();
  if (m.includes("typesafe")) {
    const code = m.match(/typesafe (\d{3})/);
    return code ? `typesafe_${Number(code[1])}` : "typesafe";
  }
  const openrouter = m.match(/\bupstream (\d{3})(?:\b|:)/);
  if (openrouter) return `openrouter_${Number(openrouter[1])}`;
  if (m.includes("all models failed")) return "chain_exhausted";
  if (m.includes("batch classification is temporarily unavailable")) return "batch_unavailable";
  if (m.includes("timeout") || m.includes("timed out")) return "timeout";
  return "upstream_other";
}

/**
 * Name a label set so we can count distinct classifiers without keeping one.
 * This used to be the labels themselves, lowercased and joined, which meant
 * every caller's wording sat in analytics and on the dashboard for 90 days.
 */
function classifierId(env: Env, labels: string[]) {
  return labelFingerprint(env, labels);
}

/** Enterprise and operator-agent callers use dedicated unmetered bearer credentials. */
async function hasEnterpriseAccess(req: Request, env: Env) {
  const keys = [env.ENTERPRISE_API_KEY, env.AGENT_API_KEY].filter((key): key is string => !!key);
  if (!keys.length) return false;
  const authorization = req.headers.get("authorization");
  if (!authorization) return false;
  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (extra || scheme.toLowerCase() !== "bearer" || !token) return false;
  const matches = await Promise.all(keys.map((key) => secretEquals(token, key)));
  return matches.some(Boolean);
}

export function record(env: Env, ctx: ExecutionContext, d: {
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
  mode?: "single" | "multi" | "dimensions";
  dimensions?: number;
  uncertain?: number;
  fallbackDecisions?: number;
}) {
  // Hashing is async, so the write moved off the response path entirely. The
  // point is unchanged apart from the two columns that used to carry the
  // caller: blob2 is a label-set fingerprint, index1 a day-scoped pseudonym.
  // Neither can be read back into what the caller sent. See src/privacy.ts.
  ctx.waitUntil(
    (async () => {
      const [caller, labels] = await Promise.all([callerId(env, d.ip), classifierId(env, d.labels)]);
      try {
        env.AE?.writeDataPoint({
          blobs: [d.tier, labels, d.country, String(d.status), d.client, d.model, d.reason, d.agent, d.mode ?? "single"],
          // double3 and blob7/blob8 were added after launch: rows written before
          // that read back as 0 and "", so cost and failure reasons are only
          // meaningful from that deploy forward.
          doubles: [d.n, d.ms, d.usd, d.attempted, d.escalationFailed, d.status === 200 ? d.attempted : 0, d.dimensions ?? 1, d.uncertain ?? 0, d.fallbackDecisions ?? 0],
          indexes: [caller],
        });
      } catch {
        /* analytics must never break a request */
      }
      // Distinct classifier registry, for the daily digest. Cheap: one write per new label set.
      try {
        if (!labels) return;
        const key = `cls:${labels}`;
        if (!(await env.STATS.get(key))) {
          await env.STATS.put(key, new Date().toISOString(), { expirationTtl: 60 * 60 * 24 * 90 });
        }
      } catch {
        /* ignore */
      }
    })(),
  );
}

/** Ask the IP or Pro account Durable Object whether the batch fits. */
async function limited(env: Env, tier: Tier, ip: string, cost: number, multiplier = 1) {
  const rpm = TIERS[tier].rpm * multiplier;
  try {
    const id = env.LIMITER.idFromName(`${tier}:${ip}`);
    const res = await env.LIMITER.get(id).fetch(
      `https://limiter/?limit=${rpm}&daily=${TIERS[tier].daily * multiplier}&cost=${cost}`,
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

/** Trusted in-process context supplied only after account authorization/reservation. */
export type ClassificationExecution = {
  meter?: Meter;
  account?: { id: string; multiplier: number };
};

const worker = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext, execution?: ClassificationExecution): Promise<Response> {
    const workerStarted = performance.now();
    const account = execution?.account;
    if (account && (!account.id.trim() || !Number.isSafeInteger(account.multiplier) || account.multiplier < 1)) {
      throw new Error("Invalid internal classification account context");
    }
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip") ?? "anon";
    const country = (req as { cf?: { country?: string } }).cf?.country ?? "??";
    const enterprise = account ? false : await hasEnterpriseAccess(req, env);
    const client = enterprise ? "enterprise" : "public";
    const agent = agentFamily(req.headers.get("user-agent") ?? "");
    // One meter per request, read once by record(). Never a module global:
    // the isolate serves concurrent requests.
    const meter = execution?.meter ?? newMeter();

    // The pathname as the caller wrote it, and decoded for routing. A stray
    // "%" is not valid percent-encoding: decodeURIComponent throws on it, and
    // an uncaught throw here was a 500 for every scanner that sent one. It is
    // not a route, so it is a 404.
    const rawPath = url.pathname.replace(/^\/+/, "");
    let path: string;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      return notFound(req, url.origin);
    }
    if (req.method === "OPTIONS") {
      // The MCP transport names its own headers and methods in its preflight.
      if (MCP_PATHS.has(path)) return handleMcp(req, DOCS_MCP);
      return new Response(null, { status: 204, headers: CORS });
    }
    // HEAD is GET without the body; crawlers and link checkers lean on it.
    if (req.method === "HEAD") {
      const r = await worker.fetch(new Request(req.url, { method: "GET", headers: req.headers }), env, ctx, execution);
      return new Response(null, { status: r.status, headers: r.headers });
    }

    // GET /?labels=a,b&text=... is a classification, not the front page. See query.ts.
    const classifyByQuery = req.method === "GET" && hasClassifyQuery(url);
    // Browsers announce text/html; curl sends */* and agents ask for text or
    // markdown. Only the first gets the rendered page — `curl classifier.dev`
    // prints exactly what it always did. ?format=text opts out by hand.
    const accept = req.headers.get("accept") ?? "";
    const wantsHtml =
      req.method === "GET" &&
      url.searchParams.get("format") !== "text" &&
      (url.searchParams.get("format") === "html" || /\btext\/html\b/.test(accept));
    // Agents that ask for Markdown get the same document with Markdown headings.
    const wantsMarkdown =
      req.method === "GET" && (url.searchParams.get("format") === "markdown" || /\btext\/markdown\b/.test(accept));
    const origin = url.origin;
    if (path === "pro" && req.method === "GET") {
      return new Response(null, {
        status: 308,
        // Old email links carry a token in the fragment. An explicit empty
        // fragment prevents it being inherited by the new account login flow.
        headers: { Location: `${origin}/app/plans#`, ...SECURITY },
      });
    }
    const billing = await handleBilling(req, env);
    if (billing) return billing;
    // The operator dashboard. Returns null for every other path.
    const admin = await adminResponse(req, env, path, ip);
    if (admin) return admin;

    // ---- MCP -----------------------------------------------------------------
    // Tools call the API through the same front door as everyone else, so the
    // limits, the metering and the logging are identical; only the client
    // family differs.
    const mcpClassify: ClassifyFn = async (body, original) => {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "user-agent": `mcp/1.0 (${original.headers.get("user-agent") ?? "unknown client"})`,
        "cf-connecting-ip": ip,
      };
      const auth = original.headers.get("authorization");
      if (auth) headers.authorization = auth;
      const r = await worker.fetch(new Request(`${origin}/${API_VERSION}/classify`, { method: "POST", headers, body: JSON.stringify(body) }), env, ctx, execution);
      const parsed = (await r.json().catch(() => ({ error: `HTTP ${r.status}`, code: `http_${r.status}` }))) as Record<string, unknown>;
      return { status: r.status, body: parsed };
    };
    if (MCP_PATHS.has(path)) {
      return handleMcp(req, path === "mcp/docs" ? DOCS_MCP : productServer(mcpClassify));
    }

    // ---- chat --------------------------------------------------------------
    // The sidebar's assistant: a model holding the product MCP server as its
    // tools. The conversation arrives whole and leaves as a stream; nothing in
    // it is kept. Cheap to call and not free to serve, so it is limited per
    // IP like a smart-tier classification is.
    if (path === `${API_VERSION}/chat`) {
      if (req.method !== "POST") return json({ error: "POST a JSON body with messages", code: "method_not_allowed" }, 405, { allow: "POST, OPTIONS" });
      if (!env.OPENROUTER_API_KEY) return json({ error: "chat is not configured", code: "chat_unavailable" }, 503);
      let messages;
      try {
        messages = parseMessages((await readJsonObject(req)).messages);
      } catch (e) {
        return json({ error: (e as Error).message, code: "invalid_request" }, 400);
      }
      const gate = await limited(env, "smart", ip, CHAT_COST);
      if (gate.limited) {
        return json({ error: `Chat limit reached; try again in ${gate.resetIn ?? 60}s`, code: "rate_limited" }, 429, {
          "retry-after": String(gate.resetIn ?? 60),
        });
      }
      // The assistant classifies on the service's own key, so a visitor who
      // has spent their public quota can still watch it work; the per-turn
      // gate above and the per-call cap in chat.ts bound what a turn can cost.
      const asService = new Request(req.url, {
        headers: env.ENTERPRISE_API_KEY
          ? { "user-agent": req.headers.get("user-agent") ?? "", authorization: `Bearer ${env.ENTERPRISE_API_KEY}` }
          : req.headers,
      });
      return new Response(chatStream({ key: env.OPENROUTER_API_KEY, webKey: env.CONTEXT_API_KEY, server: productServer(mcpClassify), req: asService, messages }), {
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", ...CORS, ...SECURITY },
      });
    }

    // ---- discovery documents -------------------------------------------------
    // Each card lives where the Server Card extension reserves it, next to its
    // endpoint, and at the .well-known path everything here has linked since.
    if (path === "mcp/server-card" || path === ".well-known/mcp/server-card.json") {
      return serverCardResponse(req, serverCard(origin, PRODUCT_MCP_STATIC, DOCS_MCP));
    }
    if (path === "mcp/docs/server-card" || path === ".well-known/mcp/docs-server-card.json") {
      return serverCardResponse(req, docsServerCard(origin, DOCS_MCP));
    }
    if (path === ".well-known/ard.json" || path === ".well-known/ai-catalog.json") {
      // One catalog, two names: ARD's, and the AI Catalog media type the MCP
      // discovery draft has clients ask for at ai-catalog.json.
      const type = path.endsWith("ai-catalog.json") ? AI_CATALOG_TYPE : "application/json; charset=utf-8";
      return json(ardCatalog(origin, PRODUCT_MCP_STATIC, DOCS_MCP), 200, { ...CACHE_HOUR, "content-type": type });
    }
    if (path === ".well-known/agent-card.json" || path === ".well-known/agent.json") return json(agentCard(origin, PRODUCT_MCP_STATIC), 200, CACHE_HOUR);
    if (path === ".well-known/api-catalog") {
      return new Response(JSON.stringify(apiCatalog(origin), null, 2), {
        headers: { "content-type": API_CATALOG_TYPE, ...CORS, ...SECURITY, ...CACHE_HOUR },
      });
    }
    if (path === ".well-known/oauth-protected-resource") return json(oauthProtectedResource(origin), 200, CACHE_HOUR);
    if (path === "sitemap.xml") {
      return new Response(sitemapXml(origin), { headers: { "content-type": "application/xml; charset=utf-8", ...CORS, ...SECURITY, ...CACHE_HOUR } });
    }
    if (path === ".well-known/mcp-registry-auth") return text(MCP_REGISTRY_AUTH + "\n", 200, CACHE_HOUR);
    if (path === ".well-known/openai-apps-challenge") {
      // Domain verification for the ChatGPT plugin directory: the token must be the whole body.
      const token = (env.OPENAI_APPS_CHALLENGE ?? "").trim();
      return token ? text(token, 200, { "cache-control": "no-store" }) : notFound(req, origin);
    }
    if (path === ".well-known/security.txt" || path === "security.txt") {
      return text(securityTxt(origin), 200, CACHE_HOUR);
    }
    if (req.method === "GET" && (path === "v1/health" || path === "health")) {
      const base = { ok: true, service: "classifier.dev", version: API_VERSION, time: new Date().toISOString(), docs: `${origin}/developers` };
      const verbose = url.searchParams.get("verbose") === "true" || url.searchParams.get("verbose") === "1";
      return json(
        verbose
          ? { ...base, limits: { fast: { per_minute: TIERS.fast.rpm, per_day: TIERS.fast.daily }, smart: { per_minute: TIERS.smart.rpm, per_day: TIERS.smart.daily } }, models: { fast: "jev (TypeSafe)", smart: `jev + ${TIERS.smart.chain[0].model}` } }
          : base,
        200,
        { "cache-control": "no-store" },
      );
    }
    // .md twins for the machine-readable files, so appending .md to any URL works.
    if (path === "openapi.json.md") {
      const ops = Object.entries(OPENAPI.paths as Record<string, Record<string, { operationId?: string; summary?: string }>>).flatMap(([route, methods]) =>
        Object.entries(methods).map(([m, op]) => `- \`${m.toUpperCase()} ${route}\` — ${op.summary ?? op.operationId ?? ""}`),
      );
      return markdown(`# classifier.dev OpenAPI\n\nThe full specification is JSON at ${origin}/openapi.json (OpenAPI 3.1). Operations:\n\n${ops.join("\n")}\n\nAuthentication: none. Errors: \`{error, code}\`. Rate limits in \`RateLimit-*\` headers. Guide: ${origin}/developers\n`, 200, CACHE_HOUR);
    }
    if (path === "llms.txt.md") return markdown(LLMS_TXT, 200, CACHE_HOUR);
    if (path === "skill.md.md") return markdown(SKILL_MD, 200, CACHE_HOUR);
    if (path === "auth.md") return markdown(AUTH_MD, 200, CACHE_HOUR);
    if (path === "agents.md" || path === ".well-known/agents.md" || path === "agent-instructions.md") return markdown(AGENTS_MD, 200, CACHE_HOUR);
    if (path === "pricing.md") {
      return markdown(toMarkdown(PRICING, { title: "classifier.dev pricing", canonical: `${origin}/pricing`, description: PAGE_DOCS.pricing.desc }), 200, CACHE_HOUR);
    }
    if (req.method === "GET" && (path === "api" || path === "api/" || path === "agent.json")) return json(agentView(origin), 200, CACHE_HOUR);
    // The documentation as a paged list of sections: an agent that wants one
    // section at a time can walk it with a cursor instead of reading 30k chars.
    if (req.method === "GET" && path === "v1/docs") {
      const all = docSections();
      const limit = Math.min(Math.max(Math.trunc(Number(url.searchParams.get("limit")) || 10), 1), 50);
      const cursor = url.searchParams.get("cursor") ?? "";
      const q = (url.searchParams.get("q") ?? "").toLowerCase().trim();
      const pool = q ? all.filter((s) => `${s.doc} ${s.heading} ${s.text}`.toLowerCase().includes(q)) : all;
      const from = cursor ? pool.findIndex((s) => s.id === cursor) : 0;
      if (from < 0) return json({ error: "cursor does not belong to this documentation filter; omit it to start again", code: "bad_cursor" }, 400);
      const page = pool.slice(from, from + limit);
      const next = pool[from + limit]?.id ?? null;
      return json(
        {
          items: page,
          page_info: { limit, count: page.length, total: pool.length, has_more: next !== null, next_cursor: next },
          next: next ? `${origin}/v1/docs?limit=${limit}&cursor=${encodeURIComponent(next)}${q ? `&q=${encodeURIComponent(q)}` : ""}` : null,
        },
        200,
        CACHE_HOUR,
      );
    }
    // A sandbox for tooling that insists on one: identical to production, which
    // stores nothing and costs nothing, so there is no data to protect.
    if (path === "v1/sandbox/classify" || path === "sandbox/classify") {
      const r = await worker.fetch(new Request(`${origin}/${API_VERSION}/classify`, req), env, ctx, execution);
      const h = new Headers(r.headers);
      h.set("x-sandbox", "true; identical to production, nothing is stored");
      return new Response(r.body, { status: r.status, headers: h });
    }

    // ---- the pages: text for curl, HTML for browsers, Markdown when asked ----
    const pageBase = path.replace(/\.md$/, "");
    const pageKey = pageBase === "docs" ? "developers" : pageBase;
    // A page is a page: anything that is not a shell tool, an HTTP library or an
    // agent gets the HTML even with Accept: */*. curl and friends keep the text.
    const uaLower = (req.headers.get("user-agent") ?? "").toLowerCase();
    const shellish = /curl|wget|httpie|python|node|undici|axios|go-http|java|okhttp|bun\/|deno|mcp\/|classify-cli/i.test(uaLower);
    const pageWantsHtml = wantsHtml || (req.method === "GET" && !wantsMarkdown && !shellish && url.searchParams.get("format") !== "text");
    if (req.method === "GET" && Object.hasOwn(PAGE_DOCS, pageKey)) {
      const pg = PAGE_DOCS[pageKey];
      const md = () => toMarkdown(pg.doc, { title: `classifier.dev ${pg.title}`, canonical: `${origin}/${pageKey}`, description: pg.desc });
      if (path.endsWith(".md") || wantsMarkdown) return markdown(md(), 200, CACHE_HOUR);
      if (pageWantsHtml)
        return html(
          pageKey === "pricing"
            ? pricingHtml()
            : docHtml({
                title: pg.title,
                desc: pg.desc,
                doc: pg.doc,
                path: `/${pageKey}`,
                here: pageKey,
              }),
        );
      return text(pg.doc, 200, { vary: "accept, user-agent", ...CACHE_HOUR });
    }

    // ---- the skills directory ---------------------------------------------
    // /skills is the page, /skills/{name} one skill and /skills/{name}.md its
    // raw text; /v1/skills is the JSON, and where a skill is submitted.
    if (path === skills.SKILLS_PATH || path === `${skills.SKILLS_PATH}.md`) {
      if (req.method !== "GET") return json({ error: `submit at POST /${skills.API_PATH}`, code: "not_found" }, 405, { allow: "GET" });
      const items = await skills.list(env);
      const dynamic = { "cache-control": "public, max-age=60", vary: "accept, user-agent" };
      if (path.endsWith(".md") || wantsMarkdown) return markdown(skills.skillsMarkdown(items, origin), 200, dynamic);
      if (pageWantsHtml) return html(skills.skillsHtml(items), 200, dynamic);
      return text(skills.skillsDoc(items), 200, dynamic);
    }
    const skillPage = req.method === "GET" && path.match(/^skills\/([a-z0-9-]{1,64})(\.md)?$/);
    if (skillPage) {
      const r = await skills.get(env, skillPage[1]);
      if (!r) return notFound(req, origin);
      const dynamic = { "cache-control": "public, max-age=300", vary: "accept, user-agent" };
      if (skillPage[2] || wantsMarkdown) {
        return new Response(r.content, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": 'inline; filename="SKILL.md"', ...dynamic, ...CORS, ...SECURITY } });
      }
      if (pageWantsHtml) return html(skills.skillHtml(r), 200, dynamic);
      return text(skills.skillDoc(r), 200, dynamic);
    }
    if (path === skills.API_PATH || path.startsWith(`${skills.API_PATH}/`)) {
      const slug = path.slice(skills.API_PATH.length + 1);
      if (req.method === "GET" && !slug) {
        const items = await skills.list(env);
        return json({ count: items.length, skills: items.map((s) => ({ ...s, url: `${origin}/${skills.SKILLS_PATH}/${s.slug}`, raw: `${origin}/${skills.SKILLS_PATH}/${s.slug}.md` })), submit: `POST ${origin}/${skills.API_PATH}`, page: `${origin}/${skills.SKILLS_PATH}` }, 200, { "cache-control": "public, max-age=60" });
      }
      if (req.method === "GET") {
        const r = await skills.get(env, slug);
        return r ? json(skills.skillJson(r, origin), 200, { "cache-control": "public, max-age=300" }) : json({ error: "no such skill", code: "not_found", list: `${origin}/${skills.API_PATH}` }, 404);
      }
      if (req.method === "DELETE" && slug) {
        // The operator's takedown, on the same key as the report preview. 404
        // without it, so the endpoint says nothing about itself.
        const given = (req.headers.get("authorization") ?? "").replace(/^[Bb]earer\s+/, "");
        if (!env.REPORT_KEY || !given || !(await secretEquals(given, env.REPORT_KEY))) return text("not found\n", 404);
        return (await skills.remove(env, slug)) ? json({ ok: true, removed: slug }) : json({ error: "no such skill", code: "not_found" }, 404);
      }
      if (req.method === "POST" && !slug) {
        let body: Record<string, unknown>;
        try {
          body = await readJsonObject(req);
        } catch {
          return json({ error: 'Body must be a JSON object such as {"skill": "<SKILL.md text>"}', code: "bad_json" }, 400);
        }
        const started = Date.now();
        try {
          const outcome = await skills.submit(env, ctx, body, ip, origin, meter, enterprise);
          const ms = Date.now() - started;
          if (outcome.accepted) {
            return json({ accepted: true, url: outcome.url, raw: `${outcome.url}.md`, skill: skills.skillJson(outcome.skill, origin), ms }, 201, { location: outcome.url, "cache-control": "no-store" });
          }
          return json({ ...outcome, ms, next: "Fix what the reasons name and submit again; nothing was stored." }, 200, { "cache-control": "no-store" });
        } catch (e) {
          if (e instanceof skills.Invalid) return json({ error: e.message, code: "skill_invalid" }, 400);
          if (e instanceof skills.Duplicate) return json({ error: e.message, code: "duplicate_skill", url: `${origin}/${skills.SKILLS_PATH}/${e.slug}` }, 409);
          if (e instanceof skills.OverBudget) return json({ error: e.message, code: e.scope === "hour" ? "rate_limit_hour" : "rate_limit_day" }, 429, { "retry-after": String(e.resetIn) });
          if (e instanceof skills.Unavailable) {
            console.warn(`skill review unavailable: ${e.message}`);
            return json({ error: "the review models are unavailable; nothing was stored, retry in a few minutes", code: "review_unavailable" }, 503, { "retry-after": "300" });
          }
          console.error(`skill review failed: ${(e as Error).message}`);
          return json({ error: "the review failed; nothing was stored", code: "internal" }, 500);
        }
      }
      return json({ error: "GET /v1/skills lists, POST /v1/skills submits, GET /v1/skills/{name} reads one", code: "not_found" }, slug && req.method === "POST" ? 404 : 405, { allow: "GET, POST" });
    }

    // ---- agent feedback, to the feedback.now protocol ----------------------
    // These sit above the classify fallback on purpose: GET /{labels}/{text}
    // would otherwise read /api/v1/policy as the label set "api".
    if (path === ".well-known/agent-feedback.json") return json(feedback.discovery(), 200, CACHE_HOUR);
    if (path === "api/v1/policy") return json(feedback.POLICY);

    if (path.startsWith("api/v1/")) {
      const readBody = async () => {
        try {
          return await readJsonObject(req);
        } catch {
          throw new feedback.Invalid("body must be a JSON object");
        }
      };
      try {
        if (path === "api/v1/feedback" && req.method === "POST") {
          const accepted = await feedback.submitFeedback(env, ctx, await readBody(), ip);
          const rid = (accepted as { receipt?: { id?: string } }).receipt?.id;
          return json(accepted, 202, rid ? { location: `${origin}/api/v1/receipts/${rid}` } : {});
        }
        if (path === "api/v1/observations" && req.method === "POST") {
          const accepted = await feedback.submitObservation(env, ctx, await readBody(), ip);
          const rid = (accepted as { receipt?: { id?: string } }).receipt?.id;
          return json(accepted, 202, rid ? { location: `${origin}/api/v1/receipts/${rid}` } : {});
        }
        const attach = path.match(/^api\/v1\/feedback\/([A-Za-z0-9_]+)\/attachments$/);
        if (attach && req.method === "POST") {
          return json(await feedback.addAttachments(env, attach[1], await readBody(), ip), 200);
        }
        const receipt = path.match(/^api\/v1\/receipts\/([A-Za-z0-9_]+)$/);
        if (receipt && req.method === "GET") {
          const found = await feedback.getReceipt(env, receipt[1]);
          return found ? json(found) : json({ error: "no such receipt", code: "not_found" }, 404);
        }
      } catch (e) {
        if (e instanceof feedback.Invalid) return json({ error: e.message, code: "invalid_submission" }, 400);
        console.error(`feedback failed: ${(e as Error).message}`);
        return json({ error: "could not record that submission", code: "internal" }, 500);
      }
      return json({ error: "no such endpoint", code: "not_found", discovery: "/.well-known/agent-feedback.json" }, 404);
    }
    if (path === newsletter.CONFIRM_PATH) {
      const privateHeaders = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" };
      const form = (req.headers.get("content-type") ?? "").includes("form-");
      if (req.method !== "GET" && req.method !== "POST") return json({ error: "Use GET to preview or POST to confirm" }, 405, { ...privateHeaders, allow: "GET, POST" });
      const body = req.method === "GET" ? { token: url.searchParams.get("token") }
        : form ? await req.formData().then(data => Object.fromEntries(data)).catch(() => ({}))
        : await readJsonObject(req).catch(() => ({}));
      const token = (body as Record<string, unknown>).token;
      try {
        const claim = await newsletter.verifyToken(env, token);
        if (!claim) return req.method === "GET" || form
          ? html(newsletter.resultPage(false, "This confirmation link is invalid or expired. Subscribe again for a new link."), 400, privateHeaders)
          : json({ error: "invalid or expired confirmation token; subscribe again" }, 400, privateHeaders);
        if (req.method === "GET") return html(newsletter.confirmationPage(token as string, claim.wants, claim.desiredLatencyMs), 200, privateHeaders);
        const { email, wants, desiredLatencyMs } = claim;
        const added = await newsletter.subscribe(env, email, form ? "form" : "api", wants, desiredLatencyMs);
        if (added) ctx.waitUntil(newsletter.notify(env, email, form ? "form" : "api", wants, desiredLatencyMs).catch(() => console.error("subscription notification failed")));
        return form ? html(newsletter.resultPage(true, "Email confirmed. Your request has been recorded."), 200, privateHeaders)
          : json({ ok: true, status: "confirmed", wants, ...(desiredLatencyMs !== null ? { desired_latency_ms: desiredLatencyMs } : {}) }, 200, privateHeaders);
      } catch {
        return req.method === "GET" || form
          ? html(newsletter.resultPage(false, "Could not confirm just now. Try this link again shortly."), 503, privateHeaders)
          : json({ error: "could not confirm; retry shortly" }, 503, privateHeaders);
      }
    }
    if (path === newsletter.SUBSCRIBE_PATH) {
      if (req.method !== "POST") {
        return json(
          { error: "POST an email address to subscribe", example: { email: "you@example.com" } },
          405,
          { allow: "POST" },
        );
      }

      // A form post means a browser with no JavaScript, and it wants a page back.
      // A checkbox form repeats the `wants` field once per tick, which is why
      // it is read with getAll and not folded into an object.
      const form = (req.headers.get("content-type") ?? "").includes("form-");
      const body: Record<string, unknown> = form
        ? await req.formData().then((data) => ({
            email: data.get("email"),
            wants: data.getAll("wants"),
            desired_latency_ms: data.get("desired_latency_ms"),
          })).catch(() => ({}))
        : await readJsonObject(req).catch(() => ({}));
      const email = newsletter.normalise(body.email);
      const wants = newsletter.wanted(body.wants);
      const desiredLatencyMs = wants.includes(newsletter.FASTER_INFERENCE_KEY)
        ? newsletter.desiredLatency(body.desired_latency_ms)
        : null;

      if (!email) {
        return form
          ? html(newsletter.resultPage(false, "That does not look like an email address."), 400)
          : json({ error: "that does not look like an email address" }, 400);
      }
      if (wants.includes(newsletter.FASTER_INFERENCE_KEY) && desiredLatencyMs === null) {
        const message = `choose a desired latency from ${newsletter.MIN_DESIRED_LATENCY_MS} to ${newsletter.MAX_DESIRED_LATENCY_MS} ms`;
        return form ? html(newsletter.resultPage(false, message), 400) : json({ error: message }, 400);
      }

      // Enough to stop a script filling the table, loose enough that a shared
      // office address never notices. The IP gates the request and is not stored.
      const slow = await (async () => {
        try {
          const id = env.LIMITER.idFromName(`subscribe:${ip}`);
          const res = await env.LIMITER.get(id).fetch("https://limiter/?limit=5&daily=50&cost=1");
          return ((await res.json()) as { limited?: boolean }).limited === true;
        } catch {
          return false; // A limiter wobble must not eat a signup.
        }
      })();
      if (slow) {
        return form
          ? html(newsletter.resultPage(false, "That was a lot of signups. Try again in a minute."), 429)
          : json({ error: "too many signups from this address; try again in a minute" }, 429, {
              "retry-after": "60",
            });
      }

      try {
        await newsletter.requestConfirmation(env, email, wants, desiredLatencyMs);
      } catch (e) {
        console.error(e instanceof newsletter.Unavailable ? e.message : "confirmation email failed");
        return form
          ? html(newsletter.resultPage(false, "Could not send confirmation just now. Try again shortly."), 503)
          : json({ error: "could not send confirmation; try again shortly" }, 503);
      }

      return form
        ? html(newsletter.resultPage(true, "Check your inbox to confirm your subscription."), 202, { "cache-control": "no-store" })
        : json({ ok: true, status: "pending_confirmation", wants, ...(desiredLatencyMs !== null ? { desired_latency_ms: desiredLatencyMs } : {}) }, 202, { "cache-control": "no-store" });
    }

    if (req.method === "GET" && !classifyByQuery && (path === "" || path === "index.html" || path === "index.md")) {
      const link = { link: LINKS(origin) };
      const wantsJson = /\bapplication\/json\b/.test(accept) && !wantsHtml;
      if (url.searchParams.get("mode") === "agent" || url.searchParams.get("format") === "json" || wantsJson) return json(agentView(origin), 200, link);
      // Crawlers that exist to read get the Markdown even when they say text/html.
      const ua = req.headers.get("user-agent") ?? "";
      const readerBot = /GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|Applebot-Extended|DeepSeekBot|meta-externalagent/i.test(ua);
      if (path === "index.md" || wantsMarkdown || (readerBot && url.searchParams.get("format") !== "html")) {
        return markdown(toMarkdown(DOCS, { title: "classifier.dev", canonical: `${origin}/`, description: "Zero-shot text classification over plain HTTP. No API key, no account." }), 200, link);
      }
      if (UNFURLERS.test(req.headers.get("user-agent") ?? "")) {
        return html(unfurlHtml(), 200, { "cache-control": "public, max-age=3600", ...link });
      }
      if (wantsHtml) return html(homeHtml(), 200, link);
      return text(DOCS, 200, { vary: "accept, user-agent", ...link });
    }
    // The front page with the sidebar already open. curl gets told where the chat is.
    if (req.method === "GET" && path === "chat") {
      if (wantsHtml) return html(homeHtml({ chat: true }), 200, { link: LINKS(origin) });
      return text(`The chat is a page: open ${origin}/chat in a browser.\nAgents get the same tools at ${origin}/mcp; the chat itself is POST ${origin}/${API_VERSION}/chat with {"messages": [{"role": "user", "content": "..."}]} and answers as an event stream.\n`);
    }
    if (req.method === "GET" && (path === "benchmark" || path === "benchmark.md")) {
      if (url.searchParams.get("format") === "json" || (/\bapplication\/json\b/.test(accept) && !wantsHtml)) {
        return json(VS_JEV, 200, { vary: "accept", ...CACHE_HOUR });
      }
      if (path === "benchmark.md" || wantsMarkdown) {
        return markdown(toMarkdown(BENCHMARK, { title: "classifier.dev benchmark", canonical: `${origin}/benchmark`, description: "Measured accuracy, calibration, cost and latency." }));
      }
      if (wantsHtml) return html(benchmarkHtml());
      return text(BENCHMARK, 200, { vary: "accept" });
    }
    if (path === "robots.txt") return text(robotsTxt(origin), 200, CACHE_HOUR);
    // Machine-readable surfaces. /openapi.json is the conventional location;
    // /.well-known/ and /llms.txt are where agents increasingly look first.
    // Agent Skills discovery (RFC 8615). Lets `npx skills add https://classifier.dev`
    // install the skill straight from here, with no repository in the middle.
    // The legacy path is served too because the CLI falls back to it.
    if (
      path === ".well-known/agent-skills/index.json" ||
      path === ".well-known/skills/index.json"
    ) {
      // The index carries the digest of skill.md, so the two share one TTL.
      return json(await skillIndex(new URL(req.url).origin), 200, CACHE_HOUR);
    }
    if (path === "skill.md" || path === "SKILL.md") {
      return new Response(SKILL_MD, {
        headers: { "content-type": "text/markdown; charset=utf-8", ...CORS, ...SECURITY, ...CACHE_HOUR },
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
      const given = (req.headers.get("authorization") ?? "").replace(/^[Bb]earer\s+/, "");
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
      // The key goes in the header and nowhere else. A query string is copied
      // into access logs, into browser history and into the Referer header of
      // whatever the page links to next, so ?key= is not a way in any more.
      const given = (req.headers.get("authorization") ?? "").replace(/^[Bb]earer\s+/, "");
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

    // Namespaces this service owns. Every route inside one is handled above,
    // so anything still here is a typo, and a typo deserves a 404 rather than
    // being read as a classification: GET /v1/classifyy is a misspelled
    // endpoint, not the label "v1" against the text "classifyy". RFC 8615
    // reserves /.well-known/ outright, which is why a scanner asking for
    // security.txt used to get "Provide at least 2 labels". A real label list
    // keeps its commas, so GET /v1,v2/some+text still classifies.
    // The one route inside /v1/ that is not handled above is the classify
    // endpoint itself: POST /v1/classify and its batch alias are the handler
    // below, reached by falling through, so the guard has to know them by
    // name or it 404s the documented endpoint and everything that self-fetches
    // it (the MCP tools, the sandbox alias).
    const CLASSIFY_ALIASES = new Set(["v1/classify", "v1/classify/batch"]);
    const classifyPath = CLASSIFY_ALIASES.has(path) ? "" : path;
    const RESERVED = new Set(["v1", "api", "mcp", "admin", ".well-known", skills.SKILLS_PATH]);
    if (classifyPath.includes("/") && RESERVED.has(classifyPath.slice(0, classifyPath.indexOf("/")))) {
      return notFound(req, origin);
    }

    // Paid credentials are resolved only on classification paths. The shared
    // MCP handler forwards Authorization here too. Never put billing identity
    // into classification analytics; only the quota bucket uses the account.
    let pro: { customerId: string; active: boolean } | null = null;
    if (!enterprise && !account) {
      try { pro = await authenticatePro(req, env); }
      catch (error) {
        if (error instanceof BillingError) return json({ error: error.message, code: error.code }, error.status, { "cache-control": "no-store", "x-api-version": API_VERSION });
        return json({ error: "Unable to verify Pro access. Try again shortly.", code: "billing_unavailable" }, 503, { "cache-control": "no-store", "x-api-version": API_VERSION });
      }
    }
    const multiplier = account?.multiplier ?? (pro ? 10 : 1);
    const quotaOwner = account ? `account:${account.id}` : pro ? `pro:${pro.customerId}` : ip;
    const quotaScope = account ? "per account" : pro ? "per Pro account" : "per IP";
    const paid = pro !== null || !!account && multiplier > 1;

    // ---- gather params from either shape -----------------------------------
    let inputs: string[] = [];
    let labels: string[] = [];
    let tier: Tier = "fast";
    let selectedModel: "jev" | "laya" = "jev";
    let processing: Processing = "fast";
    let layaPlan: LayaPlan | undefined;
    let layaRemaining = -1;
    let layaTiming: LayaRequestTiming | undefined;
    let regularQuotaMs = 0, layaQuotaMs = 0;
    let instructions: string | undefined;
    let multi: MultiOpts | undefined;
    let dimensions: Dimension[] | undefined;
    let dimensionBatches: DimensionBatch[] = [];
    let mode: "single" | "multi" | "dimensions" = "single";
    // JSON for every POST, and for a GET that asked with ?verbose=1 or Accept: application/json.
    let wantJson = req.method === "POST" || /\bapplication\/json\b/.test(accept);
    // Set for GET so a failed request can be answered with a URL that would have worked.
    let getReq: GetRequest | undefined;

    // Every API answer, success or not, says which version answered, how much
    // room is left (IETF RateLimit header fields), and echoes an idempotency
    // key if the caller sent one — classification has no side effects, so the
    // echo is all a retrying client needs.
    const apiHeaders = (remaining = -1): Record<string, string> => {
      const isLaya = selectedModel === "laya";
      const limit = isLaya ? Math.min(LAYA_LIMITS[processing].rpm, TIERS[tier].rpm * multiplier) : TIERS[tier].rpm * multiplier;
      const daily = isLaya ? Math.min(LAYA_LIMITS[processing].daily, TIERS[tier].daily * multiplier) : TIERS[tier].daily * multiplier;
      const h: Record<string, string> = {
        "x-api-version": API_VERSION,
        "ratelimit-limit": enterprise && !isLaya ? "unlimited" : String(limit),
        "ratelimit-policy": enterprise && !isLaya ? "unlimited" : `${limit};w=60, ${daily};w=86400`,
        "x-ratelimit-limit": enterprise && !isLaya ? "unlimited" : `${limit}/min`,
      };
      if (isLaya) h["x-classifier-processing"] = processing;
      if (layaRemaining >= 0) remaining = remaining < 0 ? layaRemaining : Math.min(remaining, layaRemaining);
      if (remaining >= 0) {
        h["ratelimit-remaining"] = String(remaining);
        h["x-ratelimit-remaining"] = String(remaining);
      }
      const idem = req.headers.get("idempotency-key");
      if (idem) h["idempotency-key"] = idem.slice(0, 255);
      return h;
    };
    const fail = (msg: string, status: number, reason: ErrorCode, extra: Record<string, string> = {}, ms = 0, remaining = -1, more: Record<string, string> = {}) => {
      record(env, ctx, { tier, n: 0, ms, labels, ip, country, status, client, model: selectedModel === "laya" ? layaModel(processing) : "",
        usd: meter.usd, reason, agent, attempted: inputs.length, escalationFailed: 0, mode, dimensions: dimensions?.length ?? 0 });
      const headers = { ...apiHeaders(remaining), ...extra };
      // A GET that was malformed gets back a URL that would have worked, in the spelling it used.
      const hint = status === 400 && getReq ? { usage: USAGE, try: suggest(origin, getReq) } : undefined;
      if (wantJson) return json({ error: msg, code: reason, ...hint, ...more }, status, headers);
      return text(`error: ${msg}\n` + (hint ? `usage: ${hint.usage}\ntry:   ${hint.try}\n` : "") + Object.entries(more).map(([k, v]) => `${k}: ${v}\n`).join(""), status, headers);
    };
    // How the labels read back in an error: enough to recognise, never the whole
    // text. Anything can be in the list at this point, so it is stringified first.
    const shown = (ls: unknown[]) =>
      ls.slice(0, 5).map((v) => { const l = typeof v === "string" ? v : JSON.stringify(v) ?? ""; return `"${l.length > 40 ? l.slice(0, 37) + "..." : l}"`; }).join(", ") + (ls.length > 5 ? ", ..." : "");
    /** true, "true", 1 and "1" all mean yes; a boolean field should not fail silently on a string. */
    const truthy = (v: unknown) => v === true || v === 1 || (typeof v === "string" && /^(1|true|yes|on)$/i.test(v.trim()));

    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return fail("Body must be JSON. See https://classifier.dev", 400, "bad_json");
      }
      // JSON that is not an object (null, an array, a string) has no fields to
      // read; saying so beats the 500 that reading `.inputs` off null used to be.
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return fail('Body must be a JSON object such as {"input":"...","labels":["a","b"]}. See https://classifier.dev', 400, "bad_json");
      }
      const b = body as Record<string, unknown>;
      if (b.model !== undefined && b.model !== "jev" && b.model !== "laya") return fail('model must be "jev" or "laya"', 400, "bad_model");
      selectedModel = b.model === "laya" ? "laya" : "jev";
      if (b.processing !== undefined && (selectedModel !== "laya" || (b.processing !== "fast" && b.processing !== "bulk")))
        return fail('processing must be "fast" or "bulk" and requires model: "laya"', 400, "bad_processing");
      processing = b.processing === "bulk" ? "bulk" : "fast";
      if (Object.hasOwn(b, "dimensions")) mode = "dimensions";
      if (mode === "dimensions" && ["items", "inputs", "input"].filter((k) => Object.hasOwn(b, k)).length > 1) return fail("Use only one of items, inputs or input", 400, "bad_dimensions");
      if (mode === "dimensions" && Object.hasOwn(b, "items")) {
        if (!Array.isArray(b.items)) return fail("items must be an array of strings", 400, "bad_dimensions");
        b.inputs = b.items;
      }
      inputs = Array.isArray(b.inputs)
        ? (b.inputs as string[])
        : typeof b.inputs === "string"
          ? [b.inputs]
          : typeof b.input === "string"
            ? [b.input]
            : [];
      labels = Array.isArray(b.labels) ? (b.labels as string[]) : [];
      if (mode === "dimensions") {
        if (["labels", "multi", "max_labels"].some((k) => Object.hasOwn(b, k))) return fail("dimensions cannot be combined with labels, multi or max_labels", 400, "bad_dimensions");
        if (b.instructions !== undefined && (typeof b.instructions !== "string" || b.instructions.length > 4000)) return fail("instructions must be a string of at most 4,000 characters", 400, "bad_dimensions");
        try { dimensions = readDimensions(b.dimensions); }
        catch (e) { return fail((e as Error).message, 400, "bad_dimensions"); }
        // Fingerprint the whole configuration, including field names and rubrics, never store it.
        labels = [JSON.stringify(dimensions)];
      }
      const named = readTier(b.tier);
      if (named === null) return fail(`tier must be "fast" or "smart"; got ${JSON.stringify(b.tier).slice(0, 40)}`, 400, "bad_tier");
      tier = named;
      if (typeof b.instructions === "string") instructions = b.instructions;
      // A numeric string counts: "2" is a cap, not a request to be ignored.
      const maxRaw = typeof b.max_labels === "string" && b.max_labels.trim() ? Number(b.max_labels) : b.max_labels;
      if (truthy(b.multi) || typeof maxRaw === "number") {
        const max = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? Math.floor(maxRaw) : undefined;
        multi = { max: max && max > 0 ? max : undefined };
      }
    } else {
      if (url.searchParams.has("model") || url.searchParams.has("processing")) return fail("Model and processing selection require POST /v1/classify", 400, "bad_model");
      // GET /{labels}/{text}, GET /?labels=a,b&text=..., or a mix of the two.
      // The path goes in undecoded so a %2C, %2F or %2B inside a label survives.
      getReq = readGet(CLASSIFY_ALIASES.has(path) ? "" : rawPath, url);
      if (getReq.nothing) return notFound(req, origin);
      labels = getReq.labels;
      inputs = [getReq.text];
      tier = getReq.tier;
      instructions = getReq.instructions;
      multi = getReq.multi;
      wantJson = getReq.verbose || wantJson;
      if (getReq.badTier !== undefined) return fail(`tier must be "fast" or "smart"; got ${JSON.stringify(getReq.badTier).slice(0, 40)}`, 400, "bad_tier");
    }

    if (!inputs.length || !inputs[0]) {
      return fail(
        getReq && labels.length
          ? `No text to classify. Got ${labels.length} label${labels.length === 1 ? "" : "s"} (${shown(labels)}) and no text.`
          : "Provide text to classify. See https://classifier.dev",
        400,
        "no_input",
      );
    }
    if (inputs.length > MAX_INPUTS) return fail(`Maximum ${MAX_INPUTS} inputs per request`, 400, "too_many_inputs");
    if (!dimensions && labels.length < 2) {
      return fail(
        labels.length
          ? `Provide at least 2 labels; got ${labels.length} (${shown(labels)}).` + (getReq ? " Separate labels with commas." : "")
          : "Provide at least 2 labels; none given." + (getReq ? " Put them in ?labels=a,b or as the first path segment." : ""),
        400,
        "too_few_labels",
      );
    }
    if (labels.length > MAX_LABELS) return fail(`Maximum ${MAX_LABELS} labels`, 400, "too_many_labels");
    if (labels.some((l) => typeof l !== "string" || !l.trim())) return fail("Labels must be non-empty strings", 400, "empty_label");
    if (new Set(labels).size !== labels.length) return fail("Labels must be distinct", 400, "duplicate_labels");
    if (inputs.some((i) => typeof i !== "string" || !i.trim())) return fail("Inputs must be non-empty strings", 400, "empty_input");
    if (inputs.some((i) => i.length > MAX_CHARS)) return fail(`Each input must be at most ${MAX_CHARS.toLocaleString("en-US")} characters`, 400, "input_too_long");

    if (dimensions) {
      if (inputs.length * dimensions.length > MAX_DECISIONS) return fail(`Maximum ${MAX_DECISIONS} decisions (items × dimensions) per request`, 400, "too_many_decisions");
      try { if (selectedModel !== "laya") dimensionBatches = packDimensions(inputs, dimensions, instructions); }
      catch (e) { return fail((e as Error).message, 400, "dimension_context_too_large"); }
    } else mode = multi ? "multi" : "single";
    const decisions = inputs.length * (dimensions?.length ?? 1);
    if (selectedModel === "laya") {
      if (!account && !req.headers.has("authorization")) layaTiming = {};
      if (env.LAYA_ENABLED !== "true") return fail("Laya trial is currently unavailable", 503, "laya_unavailable");
      try {
        layaPlan = planLaya(dimensions
          ? inputs.flatMap(input => dimensions!.map(d => ({ input, labels: d.labels, instructions: dimensionInstructions(d, instructions) })))
          : inputs.map(input => ({ input, labels, instructions, multi: !!multi })), processing);
      } catch (error) {
        if (error instanceof LayaError) return fail(error.message, error.status,
          error.status === 400 ? "laya_input" : error.scope === "day" ? "rate_limit_day" : error.status === 429 ? "laya_rate_limit" : "laya_unavailable",
          error.status === 400 ? {} : { "retry-after": String(error.retryAfter) });
        throw error;
      }
    }
    const rpm = TIERS[tier].rpm * multiplier;
    // Waiting cannot make a batch larger than the entire window fit.
    if (!enterprise && decisions > rpm) return fail(`Maximum ${rpm} ${dimensions ? "decisions" : "inputs"} per ${account ? "account" : pro ? "Pro" : "public"} ${tier} request; split the batch to fit the per-minute quota`, 400, dimensions ? "too_many_decisions" : "too_many_inputs");
    const regularQuotaStarted = performance.now();
    const gate = enterprise
      ? { limited: false, remaining: -1 }
      : await limited(env, tier, quotaOwner, decisions, multiplier);
    regularQuotaMs = performance.now() - regularQuotaStarted;
    if (gate.limited) {
      const perDay = gate.scope === "day";
      // The moment someone runs out of room is the moment to say where more is.
      // A free caller is told the plan that lifts this exact limit and gets its
      // URL as a field an agent can act on; a Pro caller is already on it and
      // is pointed at the arrangement above it instead.
      const way = paid
        ? "For more, email contact@classifier.dev or see https://classifier.dev/pricing"
        : `See plans that lift this limit: https://classifier.dev/pricing`;
      return fail(
        perDay
          ? `Daily limit reached: ${TIERS[tier].daily * multiplier} ${tier} classifications ${quotaScope} per day. ${way}`
          : `Rate limit: ${rpm} ${tier} classifications/minute ${quotaScope}. ${way}`,
        429,
        perDay ? "rate_limit_day" : "rate_limit_minute",
        {
          "retry-after": String(gate.resetIn ?? 60),
          "x-ratelimit-limit": perDay ? `${TIERS[tier].daily * multiplier}/day` : `${rpm}/min`,
        },
        0,
        0,
        paid ? {} : { upgrade: "https://classifier.dev/pricing" },
      );
    }

    // Validate both request shapes and pass the normal tier gate before spending
    // the separate, deliberately small Laya allowance.
    if (layaPlan) {
      const layaQuotaStarted = performance.now();
      try { layaRemaining = await limitLaya(env, processing, quotaOwner, layaPlan.cost); }
      catch (error) {
        if (error instanceof LayaError) return fail(error.message, error.status,
          error.scope === "day" ? "rate_limit_day" : error.status === 429 ? "laya_rate_limit" : "laya_unavailable",
          { "retry-after": String(error.retryAfter) });
        throw error;
      }
      layaQuotaMs = performance.now() - layaQuotaStarted;
    }

    const started = Date.now();
    let results: Result[];
    let matrix: Result[][] | undefined;
    let fallbackDecisions = 0;
    let escalationFailed = 0;
    try {
      if (dimensions) {
        const r = await classifyMatrix(env, inputs, dimensions, dimensionBatches, tier, instructions, meter, layaPlan, layaTiming);
        matrix = r.results;
        results = matrix.flat();
        escalationFailed = r.escalationFailed;
        fallbackDecisions = r.fallbackDecisions;
      } else ({ results, escalationFailed } = await classifyMany(env, inputs, labels, tier, instructions, multi, meter, layaPlan, layaTiming));
    } catch (e) {
      if (e instanceof LayaError) return fail(e.message, e.status,
        e.status === 400 ? "laya_input" : e.status === 429 ? "laya_rate_limit" : "laya_unavailable",
        e.status === 400 ? {} : { "retry-after": String(e.retryAfter) }, Date.now() - started);
      const msg = (e as Error).message;
      return fail(`upstream: ${msg}`, 502, upstreamReason(msg), {}, Date.now() - started);
    }
    const ms = Date.now() - started;
    const modelSummary = summarizeModels(results);
    record(env, ctx, {
      tier, n: results.length, ms, labels, ip, country, status: 200, client,
      model: modelSummary.modelsUsed.join(","), usd: meter.usd,
      reason: "", agent, attempted: inputs.length, escalationFailed, mode,
      dimensions: dimensions?.length ?? 1,
      uncertain: results.filter((r) => r.confidence === null || r.confidence < ESCALATE_BELOW).length,
      fallbackDecisions,
    });

    // The native limiter reports only pass/fail, so we publish the ceiling, not a
    // fabricated remaining count. The limit is also documented at GET /.
    const headers = apiHeaders(gate.remaining);
    if (layaTiming) {
      // Durations only: no request contents or identity. worker_total starts at
      // this handler, excluding outer dispatch and final response serialization.
      const durations: Record<string, number | undefined> = {
        worker_total: performance.now() - workerStarted,
        quota_regular: regularQuotaMs, quota_laya: layaQuotaMs,
        laya_run: layaTiming.runMs, modal_fetch: layaTiming.fetchMs,
        modal_headers: layaTiming.headersMs, backend: layaTiming.backendMs,
      };
      headers["server-timing"] = Object.entries(durations)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] >= 0)
        .map(([name, duration]) => `${name};dur=${duration.toFixed(2)}`).join(", ");
    }

    if (dimensions && matrix) {
      return json({
        tier, ...modelSummary,
        results: matrix.map((row) => ({ dimensions: Object.fromEntries(dimensions.map((d, i) => [d.name, row[i]])) })),
        usage: { items: inputs.length, dimensions: dimensions.length, classifications: results.length,
          escalated: results.filter((r) => r.escalated).length,
          ...(escalationFailed ? { escalation_failed: escalationFailed } : {}),
          fallback: fallbackDecisions, ms },
      }, 200, headers);
    }
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

export default worker;
