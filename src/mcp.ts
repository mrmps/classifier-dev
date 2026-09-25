import { DIMENSIONS_SCHEMA } from "./dimensions";

/**
 * The MCP server: classifier.dev as tools for Claude, ChatGPT, Codex, Cursor
 * and anything else that speaks the Model Context Protocol.
 *
 * Streamable HTTP, stateless, JSON responses. Every JSON-RPC message is one
 * POST to the endpoint and gets one JSON object back; there are no sessions,
 * no server-initiated streams and no SSE, which the spec allows a server to
 * decline (GET answers 405). That is the smallest correct server, and it is
 * what a keyless, side-effect-free API should be: a fresh isolate can answer
 * any request with nothing remembered from the last one.
 *
 * Written against the 2025-11-25 transport spec and checked against the
 * official TypeScript SDK's client. Hand-rolled rather than the SDK because
 * the worker has no runtime dependencies and this is ~300 lines of JSON.
 */

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const SERVER_VERSION = "1.0.0";

type JsonRpcId = string | number | null;
type Message = { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };

export type JsonSchema = Record<string, unknown>;

export type ToolResult = { text: string; structured?: unknown; isError?: boolean };

export type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

export type ToolContext = { req: Request };

export type McpServer = {
  name: string;
  title: string;
  description: string;
  version: string;
  instructions: string;
  tools: Tool[];
};

/** Calls the classification API in-process. Returns the HTTP status and parsed body. */
export type ClassifyFn = (body: Record<string, unknown>, req: Request) => Promise<{ status: number; body: Record<string, unknown> }>;

// ---------------------------------------------------------------- argument checking

class InvalidParams extends Error {}

const str = (v: unknown, name: string, opts: { max?: number; optional?: boolean } = {}) => {
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw new InvalidParams(`${name} is required`);
  }
  if (typeof v !== "string") throw new InvalidParams(`${name} must be a string`);
  if (opts.max && v.length > opts.max) throw new InvalidParams(`${name} must be under ${opts.max} characters`);
  return v;
};

const strings = (v: unknown, name: string, min: number, max: number): string[] => {
  if (v === undefined || v === null) throw new InvalidParams(`${name} is required: an array of ${min}-${max} strings`);
  if (!Array.isArray(v)) throw new InvalidParams(`${name} must be an array of strings`);
  if (v.length < min) throw new InvalidParams(`${name} needs at least ${min} item${min === 1 ? "" : "s"}`);
  if (v.length > max) throw new InvalidParams(`${name} takes at most ${max} items`);
  if (!v.every((s) => typeof s === "string" && s.trim())) throw new InvalidParams(`every ${name} item must be a non-empty string`);
  return v;
};

const number = (v: unknown, name: string, lo: number, hi: number) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || Number.isNaN(v) || v < lo || v > hi) throw new InvalidParams(`${name} must be a number between ${lo} and ${hi}`);
  return v;
};

const tier = (v: unknown) => {
  if (v === undefined || v === null) return undefined;
  if (v !== "fast" && v !== "smart") throw new InvalidParams(`tier must be "fast" or "smart"`);
  return v;
};

// ---------------------------------------------------------------- the product tools

const LABELS_SCHEMA = {
  type: "array",
  items: { type: "string" },
  minItems: 2,
  maxItems: 100,
  description: "2 to 100 category names. Descriptive names classify better: \"urgent bug\" beats \"p0\". Add a label like \"none of these\" when none-of-the-above is a real outcome.",
};
const INPUTS_SCHEMA = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  maxItems: 1000,
  description: "1 to 1,000 texts to classify. Results come back in the same order.",
};
const INSTRUCTIONS_SCHEMA = {
  type: "string",
  description: "Optional extra criteria, e.g. \"judge only the service, ignore the food\".",
};
const TIER_SCHEMA = {
  type: "string",
  enum: ["fast", "smart"],
  description: "fast (default) or smart, which re-asks answers under 0.7 confidence of a reasoning model (slower, single-label only). Independent of the Laya processing lane.",
};

const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\s+/g, " ");

function classifyOrError(status: number, body: Record<string, unknown>): ToolResult | null {
  if (status === 200) return null;
  const msg = typeof body.error === "string" ? body.error : `HTTP ${status}`;
  return { text: `error: ${msg}`, structured: { error: msg, code: body.code ?? `http_${status}` }, isError: true };
}

type Row = { label?: string; labels?: string[]; confidence?: number | null; scores?: Record<string, number> | null };

export function productServer(classify: ClassifyFn, market?: ClassifyFn): McpServer {
  const urlProperties = {
    url: { type: "string", pattern: "^https?://", maxLength: 8192, description: "Scrape one public URL instead of inputs/items. Requires funded workspace access. Context.dev costs $0.0022 per billed attempt plus classification; long articles need Fast. Errors disclose retained charges. No automatic scrape retries." },
    include: { type: "array", items: { type: "string", enum: ["markdown", "html"] }, description: "With url: return article.markdown and/or article.html at no extra scrape cost. Omit for compact output." },
  };
  async function urlResult(args: Record<string, unknown>, ctx: ToolContext, multi = false): Promise<ToolResult | null> {
    if (!Object.hasOwn(args, "url")) return null;
    const result = await classify({ ...args, ...(multi ? { multi: true } : {}) }, ctx.req);
    return { text: JSON.stringify(result.body), structured: result.body, ...(result.status !== 200 ? { isError: true } : {}) };
  }
  const tools: Tool[] = [
    {
      name: "classify_texts",
      title: "Classify texts into one label each",
      description:
        "Sort up to 1,000 texts into exactly one of your own labels each, with confidence per answer. " +
        "Use this when you have many items to triage, route, filter or bucket and do not want to read them all: " +
        "search results before opening them, tickets, log lines, changed files, feedback. " +
        "Do not use it for fewer than about five items you can already see — just decide. " +
        "For default Jev, confidence is calibrated (answers >= 0.9 are right ~82-92% of the time; < 0.5 about 30-60%); these measurements do not apply to experimental Laya. " +
        "so act on the sure ones and look at the rest yourself, or pass tier \"smart\" to have the unsure ones re-asked of a reasoning model.",
      inputSchema: {
        type: "object",
        properties: { ...urlProperties, inputs: INPUTS_SCHEMA, labels: LABELS_SCHEMA, instructions: INSTRUCTIONS_SCHEMA, tier: TIER_SCHEMA,
          model: { type: "string", enum: ["jev", "laya", "kev", "chunklaya"], description: "Jev is default. Default/explicit jev inputs over 32,000 characters use paid Fast-only long context: up to 250,000 original cl100k_base context tokens total, 20 documents, 32 decisions and a 1 MB body. Requires paid workspace balance or active paid subscription, not signup credit. $0.084/M original context tokens counted once across inputs, independent of dimensions. Final Jev uses selected evidence; eligible chunks may be omitted, disclosed in usage.long_context. No evidence returns 422 long_context_no_evidence without charge. Explicit 'chunklaya' retains legacy opt-in (4,000,000 characters/input, 20 inputs, subject to body limit). 'laya' (512-token context) and 'kev' (8K context) remain experimental alternatives." },
          processing: { type: "string", enum: ["fast", "bulk"], description: "Optional. Implies Laya if model is omitted; has no effect with explicit Jev. With Laya, omit to select fast for one decision or bulk for batches automatically. Explicit fast accepts one decision. Shared capacity limits can return 429." } },
        required: ["labels"],
        oneOf: [{ required: ["inputs"], not: { required: ["url"] } }, { required: ["url"], not: { required: ["inputs"] } }],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          tier: { type: "string" },
          model: { type: "string" },
          results: {
            type: "array",
            description: "One per input, in input order.",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                confidence: { type: ["number", "null"], description: "0-1; calibration measurements cover Jev, not experimental Laya. Null when the provider returns no score or the smart tier replaces the scored answer." },
                scores: { type: ["object", "null"], additionalProperties: { type: "number" }, description: "Model preference per supplied label; sums to 1. Does not validate the input or guarantee correctness." },
                escalated: { type: "boolean", description: "Smart tier only: this answer was re-asked of the reasoning model." },
              },
              required: ["label"],
            },
          },
          usage: { type: "object", properties: { classifications: { type: "integer" }, escalated: { type: "integer" }, ms: { type: "integer" } } },
        },
        required: ["results"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      async run(a, ctx) {
        const scraped = await urlResult(a, ctx);
        if (scraped) return scraped;
        const body = {
          inputs: strings(a.inputs, "inputs", 1, 1000),
          labels: strings(a.labels, "labels", 2, 100),
          instructions: str(a.instructions, "instructions", { optional: true, max: 2000 }),
          tier: tier(a.tier),
          ...(a.model !== undefined ? { model: a.model } : {}),
          ...(a.processing !== undefined ? { processing: a.processing } : {}),
        };
        const r = await classify(body, ctx.req);
        const err = classifyOrError(r.status, r.body);
        if (err) return err;
        const rows = r.body.results as Row[];
        const lines = rows.map((x, i) => `${x.label}\t${x.confidence == null ? "-" : Number(x.confidence).toFixed(2)}\t${clip(body.inputs[i])}`);
        return { text: `label\tconfidence\ttext\n${lines.join("\n")}`, structured: r.body };
      },
    },
    {
      name: "classify_dimensions",
      title: "Classify several dimensions per text",
      description: "Classify each text by several named dimensions, such as team, urgency and kind, in one request. Returns a label, confidence, scores and model for each field. At most 1,000 item × dimension decisions; every field counts toward the quota. Use per-dimension instructions to define ambiguous categories.",
      inputSchema: {
        type: "object", required: ["dimensions"], oneOf: [{ required: ["items"], not: { required: ["url"] } }, { required: ["url"], not: { required: ["items"] } }], additionalProperties: false,
        properties: { ...urlProperties, items: INPUTS_SCHEMA, dimensions: DIMENSIONS_SCHEMA, instructions: { ...INSTRUCTIONS_SCHEMA, maxLength: 4000 }, tier: TIER_SCHEMA,
          model: { type: "string", enum: ["jev", "laya", "kev", "chunklaya"] }, processing: { type: "string", enum: ["fast", "bulk"], description: "Optional. Implies Laya if model is omitted; has no effect with explicit Jev. Omit for automatic fast/bulk selection based on item × dimension decisions." } },
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      async run(a, ctx) {
        const scraped = await urlResult(a, ctx);
        if (scraped) return scraped;
        const r = await classify({ items: strings(a.items, "items", 1, 1000), dimensions: a.dimensions ?? null,
          instructions: str(a.instructions, "instructions", { optional: true, max: 4000 }), tier: tier(a.tier),
          ...(a.model !== undefined ? { model: a.model } : {}), ...(a.processing !== undefined ? { processing: a.processing } : {}) }, ctx.req);
        return classifyOrError(r.status, r.body) ?? { text: JSON.stringify(r.body), structured: r.body };
      },
    },
    {
      name: "classify_multi_label",
      title: "Tag texts with every label that applies",
      description:
        "Like classify_texts, but each text gets every label that applies (possibly none), with an independent 0-1 score per label. " +
        "Use this for tagging — topics of an article, components touched by a ticket — where one answer is not enough. " +
        "Set max_labels to cap how many come back per text. Labels scoring >= 0.7 are kept.",
      inputSchema: {
        type: "object",
        properties: {
          ...urlProperties,
          inputs: INPUTS_SCHEMA,
          labels: LABELS_SCHEMA,
          instructions: INSTRUCTIONS_SCHEMA,
          max_labels: { type: "integer", minimum: 1, maximum: 100, description: "At most this many labels per text, most likely first." },
          model: { type: "string", enum: ["jev", "laya", "kev", "chunklaya"] },
          processing: { type: "string", enum: ["fast", "bulk"], description: "Optional. Implies Laya if model is omitted; has no effect with explicit Jev. Omit to select fast for up to four labels on one text, or bulk for larger work automatically." },
        },
        required: ["labels"],
        oneOf: [{ required: ["inputs"], not: { required: ["url"] } }, { required: ["url"], not: { required: ["inputs"] } }],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                labels: { type: "array", items: { type: "string" }, description: "Every label scoring >= 0.7, most likely first. May be empty." },
                scores: { type: ["object", "null"], additionalProperties: { type: "number" }, description: "Independent model preference per supplied label. Does not validate the input or guarantee correctness." },
              },
              required: ["labels"],
            },
          },
          usage: { type: "object", properties: { classifications: { type: "integer" }, ms: { type: "integer" } } },
        },
        required: ["results"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      async run(a, ctx) {
        const scraped = await urlResult(a, ctx, true);
        if (scraped) return scraped;
        const max = number(a.max_labels, "max_labels", 1, 100);
        if (max !== undefined && !Number.isInteger(max)) throw new InvalidParams("max_labels must be a whole number");
        const body: Record<string, unknown> = {
          inputs: strings(a.inputs, "inputs", 1, 1000),
          labels: strings(a.labels, "labels", 2, 100),
          instructions: str(a.instructions, "instructions", { optional: true, max: 2000 }),
          multi: true,
          ...(a.model !== undefined ? { model: a.model } : {}),
          ...(a.processing !== undefined ? { processing: a.processing } : {}),
        };
        if (max !== undefined) body.max_labels = max;
        const r = await classify(body, ctx.req);
        const err = classifyOrError(r.status, r.body);
        if (err) return err;
        const rows = r.body.results as Row[];
        const inputs = body.inputs as string[];
        const lines = rows.map((x, i) => `${(x.labels ?? []).join(",") || "-"}\t${clip(inputs[i])}`);
        return { text: `labels\ttext\n${lines.join("\n")}`, structured: r.body };
      },
    },
    {
      name: "count_labels",
      title: "Count how many texts fall under each label",
      description:
        "Classify up to 1,000 texts and return only a histogram: how many landed on each label, and how many the model was unsure about. " +
        "Use this when you want the shape of a corpus — what share of feedback is bugs vs praise, how many search results are relevant — " +
        "without pulling a thousand individual answers into context. Use classify_texts when you need the answer per item.",
      inputSchema: {
        type: "object",
        properties: {
          inputs: INPUTS_SCHEMA,
          labels: LABELS_SCHEMA,
          instructions: INSTRUCTIONS_SCHEMA,
          unsure_below: { type: "number", minimum: 0, maximum: 1, default: 0.7, description: "Answers with confidence under this count as unsure." },
        },
        required: ["inputs", "labels"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          total: { type: "integer" },
          counts: { type: "object", additionalProperties: { type: "integer" }, description: "Label -> how many texts, every label present." },
          unsure: { type: "integer", description: "How many answers fell under unsure_below." },
          unsure_below: { type: "number" },
        },
        required: ["total", "counts", "unsure"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async run(a, ctx) {
        const threshold = number(a.unsure_below, "unsure_below", 0, 1) ?? 0.7;
        const body = {
          inputs: strings(a.inputs, "inputs", 1, 1000),
          labels: strings(a.labels, "labels", 2, 100),
          instructions: str(a.instructions, "instructions", { optional: true, max: 2000 }),
        };
        const r = await classify(body, ctx.req);
        const err = classifyOrError(r.status, r.body);
        if (err) return err;
        const rows = r.body.results as Row[];
        const counts: Record<string, number> = Object.fromEntries(body.labels.map((l) => [l, 0]));
        let unsure = 0;
        for (const x of rows) {
          if (x.label) counts[x.label] = (counts[x.label] ?? 0) + 1;
          if (x.confidence == null || x.confidence < threshold) unsure++;
        }
        const sorted = Object.entries(counts).sort((p, q) => q[1] - p[1]);
        const text = sorted.map(([l, n]) => `${n}\t${l}`).join("\n") + `\n\n${unsure} of ${rows.length} under ${threshold} confidence`;
        return { text, structured: { total: rows.length, counts: Object.fromEntries(sorted), unsure, unsure_below: threshold } };
      },
    },
    {
      name: "review_uncertain",
      title: "Find the texts the classifier was unsure about",
      description:
        "Classify up to 1,000 texts and return only the ones whose confidence fell under a threshold (default 0.7), each with its two most likely labels. " +
        "Use this after a bulk classification to decide which items deserve your own attention: the confident answers can be trusted, " +
        "these are the ones to read. Returns the index of each item so you can map back to your list.",
      inputSchema: {
        type: "object",
        properties: {
          inputs: INPUTS_SCHEMA,
          labels: LABELS_SCHEMA,
          instructions: INSTRUCTIONS_SCHEMA,
          below: { type: "number", minimum: 0, maximum: 1, default: 0.7, description: "Return items with confidence under this." },
        },
        required: ["inputs", "labels"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          total: { type: "integer" },
          below: { type: "number" },
          uncertain: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "integer", description: "Position in the inputs you sent." },
                text: { type: "string" },
                label: { type: "string", description: "The model's best guess." },
                confidence: { type: ["number", "null"] },
                runner_up: { type: ["string", "null"], description: "The second most likely label." },
              },
              required: ["index", "text", "label"],
            },
          },
        },
        required: ["total", "uncertain"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async run(a, ctx) {
        const below = number(a.below, "below", 0, 1) ?? 0.7;
        const body = {
          inputs: strings(a.inputs, "inputs", 1, 1000),
          labels: strings(a.labels, "labels", 2, 100),
          instructions: str(a.instructions, "instructions", { optional: true, max: 2000 }),
        };
        const r = await classify(body, ctx.req);
        const err = classifyOrError(r.status, r.body);
        if (err) return err;
        const rows = r.body.results as Row[];
        const uncertain = rows.flatMap((x, i) => {
          if (!(x.confidence == null || x.confidence < below)) return [];
          const ranked = Object.entries(x.scores ?? {}).sort((p, q) => q[1] - p[1]);
          const runner = ranked.find(([l]) => l !== x.label)?.[0] ?? null;
          return [{ index: i, text: body.inputs[i], label: x.label ?? "", confidence: x.confidence ?? null, runner_up: runner }];
        });
        const text = uncertain.length
          ? `index\tlabel\tconfidence\trunner-up\ttext\n` +
            uncertain.map((u) => `${u.index}\t${u.label}\t${u.confidence == null ? "-" : u.confidence.toFixed(2)}\t${u.runner_up ?? "-"}\t${clip(u.text)}`).join("\n")
          : `all ${rows.length} answers were at or above ${below} confidence`;
        return { text, structured: { total: rows.length, below, uncertain } };
      },
    },
  ];
  if (market) tools.push({
    name: "compare_market_preference",
    title: "Ask a simulated audience which option it prefers",
    description:
      "Poll a panel of simulated US people (drawn from a 285k-persona census-grounded corpus) on which of 2-4 short options they prefer: " +
      "taglines, headlines, product descriptions, pricing framings, feature choices, email subjects. " +
      "Describe the audience in plain English; the same audience string always polls the same panel, so repeated calls are comparable A/B/n tests. " +
      "Returns weighted preference shares with confidence intervals, per-segment splits (age, sex, education, region, marital), " +
      "a position_bias diagnostic (how much option order moved answers; treat close results with high bias as ties), and mean_certainty " +
      "(how torn individual panelists were). This estimates relative preference between options, not absolute conversion or purchase rates. " +
      "A new audience costs ~$0.015 and ~15s to resolve; a cached audience answers in ~1s for ~$0.001-0.01 depending on population.",
    inputSchema: {
      type: "object",
      properties: {
        audience: { type: "string", maxLength: 400, description: "Who should judge, in plain English: \"US public school teachers\", \"software developers who buy their own tools\", \"parents of young children in the suburbs\"." },
        options: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", properties: { id: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,32}$" }, content: { type: "string", maxLength: 2000 } }, required: ["content"], additionalProperties: false }, description: "The alternatives to compare, each at most 2,000 characters." },
        decision: { type: "string", maxLength: 500, description: "The question each panelist answers. Defaults to which option they find more appealing." },
        population: { type: "integer", minimum: 50, maximum: 2000, default: 500, description: "Panel size. 150-500 suits iteration; use more for final calls." },
      },
      required: ["audience", "options"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        preference: { type: "object", additionalProperties: { type: "number" }, description: "Weighted share per option id; sums to 1." },
        interval: { type: "object", additionalProperties: { type: "array", items: { type: "number" } }, description: "95% interval per option under the Kish effective sample size." },
        position_bias: { type: ["number", "null"], description: "Share moved by option order. A gap smaller than this is a tie." },
        mean_certainty: { type: "number", description: "0.5 = individual panelists torn, 1 = individually certain." },
        segments: { type: "array", items: { type: "object", properties: { attribute: { type: "string" }, value: { type: "string" }, n: { type: "integer" }, preference: { type: "object", additionalProperties: { type: "number" } } } }, description: "Largest demographic splits, at least 25 panelists each." },
        answered: { type: "integer" },
        candidates: { type: "integer", description: "Corpus personas that resembled the audience before membership scoring." },
        pricing: { type: "object" },
      },
      required: ["preference"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(a, ctx) {
      const r = await market(a, ctx.req);
      if (r.status !== 200) return { text: JSON.stringify(r.body), structured: r.body, isError: true };
      const d = r.body as { preference?: Record<string, number>; position_bias?: number | null; mean_certainty?: number; segments?: { attribute: string; value: string; n: number; preference: Record<string, number> }[] };
      const shares = Object.entries(d.preference ?? {}).sort((p, q) => q[1] - p[1]);
      const lines = shares.map(([id, share]) => `${(share * 100).toFixed(1)}%\t${id}`);
      lines.push(`position bias ${d.position_bias == null ? "n/a" : (d.position_bias * 100).toFixed(1) + "%"}, mean certainty ${((d.mean_certainty ?? 0) * 100).toFixed(0)}%`);
      for (const seg of (d.segments ?? []).slice(0, 4)) {
        const top = Object.entries(seg.preference).sort((p, q) => q[1] - p[1])[0];
        lines.push(`${seg.attribute}=${seg.value} (n=${seg.n}): ${top[0]} ${(top[1] * 100).toFixed(0)}%`);
      }
      return { text: lines.join("\n"), structured: r.body };
    },
  });

  return {
    name: "classifier.dev",
    title: "classifier.dev",
    description: "Zero-shot text classification: sort up to 1,000 texts into your own labels in one call, with a calibrated confidence per answer. No API key.",
    version: SERVER_VERSION,
    instructions:
      "classifier.dev sorts text into labels you name, many texts per call, with a calibrated confidence on every answer. " +
      "Use classify_texts for one label per text, classify_multi_label when several can apply, count_labels for a histogram over a corpus, " +
      "and review_uncertain to pull out only the answers worth a human (or your own) look. " +
      "Reach for it when reading the inputs is the expensive part: forty search results, a thousand log lines, a backlog of tickets. " +
      "Under about five items you can already see, just decide yourself. Labels are free text; descriptive names classify better. " +
      "No key is needed. Limits per IP: 3,000 classifications/min on fast, 200/min on smart. Public smart batches must contain at most 200 texts; a 429 says how long to wait. " +
      "Docs: https://classifier.dev — the docs are also an MCP server at https://classifier.dev/mcp/docs.",
    tools,
  };
}

// ---------------------------------------------------------------- the docs tools

export type Doc = { id: string; title: string; text: string; url: string };

/** Split a plain-text doc on its UPPERCASE headings, the convention every doc here follows. */
function sections(doc: Doc): { heading: string; text: string }[] {
  const out: { heading: string; text: string }[] = [];
  let cur = { heading: doc.title, text: "" };
  for (const line of doc.text.split("\n")) {
    const isHeading = /^#{1,3} /.test(line) || (/^[A-Z][A-Z0-9 ,/()'-]{2,}$/.test(line) && line.trim() === line);
    if (isHeading) {
      if (cur.text.trim()) out.push(cur);
      cur = { heading: line.replace(/^#+ /, "").trim(), text: "" };
    } else cur.text += line + "\n";
  }
  if (cur.text.trim()) out.push(cur);
  return out;
}

export function docsServer(docs: Doc[]): McpServer {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const ids = docs.map((d) => d.id);
  const tools: Tool[] = [
    {
      name: "list_docs",
      title: "List the classifier.dev documents",
      description:
        "List every classifier.dev document available over this server — the API reference, the benchmark, the agent skill, the CLI, pricing, privacy, terms and " +
        "the MCP setup guide — with an id, a title, its section headings and its size. Call this first, then read_doc for the one you need.",
      inputSchema: {
        type: "object",
        properties: {
          filter: { type: "string", maxLength: 100, description: "Optional: only documents whose id, title or section headings contain this text (case-insensitive)." },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          docs: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, url: { type: "string" }, sections: { type: "array", items: { type: "string" } }, chars: { type: "integer" } }, required: ["id", "title", "url"] } },
        },
        required: ["docs"],
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async run(a) {
        const f = (str(a.filter, "filter", { optional: true, max: 100 }) ?? "").toLowerCase().trim();
        const list = docs
          .map((d) => ({ id: d.id, title: d.title, url: d.url, sections: sections(d).map((s) => s.heading), chars: d.text.length }))
          .filter((d) => !f || d.id.includes(f) || d.title.toLowerCase().includes(f) || d.sections.some((h) => h.toLowerCase().includes(f)));
        const text = list.map((d) => `${d.id}\t${d.title}\t${d.chars} chars\t${d.sections.join(" · ")}`).join("\n");
        return { text: `id\ttitle\tsize\tsections\n${text}`, structured: { docs: list } };
      },
    },
    {
      name: "read_doc",
      title: "Read a classifier.dev document",
      description:
        `Return one document in full, or just one of its sections. ids: ${ids.join(", ")}. ` +
        "Use section to fetch a single heading (case-insensitive prefix match) when the whole document is more than you need.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", enum: ids, description: "Which document." },
          section: { type: "string", description: "Optional heading to return on its own, e.g. \"limits\" or \"parameters\"." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async run(a) {
        const id = str(a.id, "id")!;
        const doc = byId.get(id);
        if (!doc) throw new InvalidParams(`unknown doc "${id}"; one of ${ids.join(", ")}`);
        const want = str(a.section, "section", { optional: true, max: 200 });
        if (!want) return { text: doc.text, structured: { id, title: doc.title, url: doc.url, text: doc.text } };
        const hit = sections(doc).find((s) => s.heading.toLowerCase().startsWith(want.toLowerCase().trim()));
        if (!hit) {
          const heads = sections(doc).map((s) => s.heading);
          return { text: `no section "${want}" in ${id}; sections: ${heads.join(", ")}`, structured: { error: "no_such_section", sections: heads }, isError: true };
        }
        return { text: `${hit.heading}\n\n${hit.text.trim()}`, structured: { id, title: doc.title, url: doc.url, section: hit.heading, text: hit.text.trim() } };
      },
    },
    {
      name: "search_docs",
      title: "Search the classifier.dev documentation",
      description:
        "Full-text search across every classifier.dev document. Returns the paragraphs that contain all of your query's words, " +
        "with the document and section each came from. Use it for a specific question — rate limits, how confidence is calibrated, " +
        "how to connect from Claude or ChatGPT — instead of reading whole documents.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 2, maxLength: 200, description: "Words to look for; all must appear in a paragraph." },
          limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      async run(a) {
        const q = str(a.query, "query", { max: 200 })!.toLowerCase().split(/\s+/).filter(Boolean);
        if (!q.length) throw new InvalidParams("query must contain at least one word");
        const limit = number(a.limit, "limit", 1, 50) ?? 10;
        const hits: { id: string; url: string; section: string; text: string }[] = [];
        for (const d of docs) {
          for (const s of sections(d)) {
            for (const para of s.text.split(/\n\s*\n/)) {
              const flat = para.replace(/\s+/g, " ").trim();
              if (!flat) continue;
              const low = flat.toLowerCase();
              if (q.every((w) => low.includes(w))) hits.push({ id: d.id, url: d.url, section: s.heading, text: flat });
            }
          }
        }
        const top = hits.slice(0, limit);
        const text = top.length
          ? top.map((h) => `[${h.id} › ${h.section}] ${h.text}`).join("\n\n")
          : `nothing matched "${q.join(" ")}"; try fewer or different words, or list_docs`;
        return { text, structured: { query: q.join(" "), total: hits.length, hits: top } };
      },
    },
  ];
  tools.push({
    name: "get_examples",
    title: "Get a ready-to-run example for a client",
    description:
      "Return a copy-pasteable example of calling classifier.dev from a given client: curl, javascript (fetch), python (requests), " +
      "the classify CLI, or an MCP tools/call payload. Use this when you are about to write integration code and want the exact request shape " +
      "rather than reading the whole reference.",
    inputSchema: {
      type: "object",
      properties: {
        client: { type: "string", enum: ["curl", "javascript", "python", "cli", "mcp"], description: "Which client to show." },
        multi_label: { type: "boolean", default: false, description: "Show the multi-label form (every label that applies) instead of single-label." },
      },
      required: ["client"],
      additionalProperties: false,
    },
    outputSchema: { type: "object", properties: { client: { type: "string" }, code: { type: "string" }, notes: { type: "string" } }, required: ["client", "code"] },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(a) {
      const client = str(a.client, "client")!;
      const multi = a.multi_label === true;
      const body = multi
        ? `{"inputs": ["postgres index tuning", "react hooks for forms"], "labels": ["databases", "frontend", "ml"], "multi": true}`
        : `{"inputs": ["the checkout button does nothing", "love the dark mode"], "labels": ["bug", "praise", "feature"]}`;
      const examples: Record<string, { code: string; notes: string }> = {
        curl: { code: `curl https://classifier.dev/v1/classify \\\n  -H 'content-type: application/json' \\\n  -d '${body}'`, notes: "No key. Up to 1,000 inputs. Add \"tier\": \"smart\" to re-ask uncertain answers; \"instructions\" for extra criteria." },
        javascript: {
          code: `const res = await fetch("https://classifier.dev/v1/classify", {\n  method: "POST",\n  headers: { "content-type": "application/json" },\n  body: JSON.stringify(${body}),\n});\nconst { results } = await res.json();\n// results[i] = ${multi ? "{ labels: [...], scores: {...} }" : "{ label, confidence, scores }"}, in input order`,
          notes: "Works in Node 18+, Bun, Deno, Workers and browsers (CORS is open).",
        },
        python: {
          code: `import json\nimport requests\n\nr = requests.post("https://classifier.dev/v1/classify", json=json.loads(${JSON.stringify(body)}))\nr.raise_for_status()\nfor item in r.json()["results"]:\n    print(item${multi ? '["labels"]' : '["label"], item["confidence"]'})`,
          notes: "requests, httpx or urllib all work; there is no SDK to install.",
        },
        cli: {
          code: multi
            ? `npm i -g classifier-dev\nclassify databases,frontend,ml --multi --max 2 < titles.txt`
            : `npm i -g classifier-dev\nclassify bug,praise,feature < feedback.txt          # label<TAB>confidence<TAB>text\nclassify bug,praise,feature --review 0.7 < feedback.txt   # only the unsure ones`,
          notes: "Streams rows in input order; --json for NDJSON, --count for a histogram.",
        },
        mcp: {
          code: `POST https://classifier.dev/mcp\n{"jsonrpc": "2.0", "id": 1, "method": "tools/call",\n "params": {"name": "${multi ? "classify_multi_label" : "classify_texts"}", "arguments": ${body.replace(', "multi": true', "")}}}`,
          notes: "Streamable HTTP, stateless, no auth. Connect it in Claude, ChatGPT or Codex: https://classifier.dev/mcp-setup",
        },
      };
      const ex = Object.hasOwn(examples, client) ? examples[client] : undefined;
      if (!ex) throw new InvalidParams(`client must be one of ${Object.keys(examples).join(", ")}`);
      return { text: `${ex.code}\n\n${ex.notes}`, structured: { client, code: ex.code, notes: ex.notes } };
    },
  });

  return {
    name: "classifier.dev docs",
    title: "classifier.dev documentation",
    description: "The classifier.dev documentation as tools: list, read and search the API reference, benchmark, agent skill, CLI, pricing, privacy, terms and MCP setup guide.",
    version: SERVER_VERSION,
    instructions:
      "This server answers questions about classifier.dev, the keyless text-classification API; it does not classify anything itself — " +
      "for that connect https://classifier.dev/mcp. Start with search_docs for a specific question, list_docs to see what exists, " +
      "and read_doc (optionally with a section) for the full text.",
    tools,
  };
}

// ---------------------------------------------------------------- the transport

const MCP_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
  "access-control-expose-headers": "Mcp-Session-Id, MCP-Protocol-Version",
};

const rpcError = (id: JsonRpcId, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0" as const,
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });

const respond = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...MCP_CORS, ...extra },
  });

/** The public tool description, as tools/list returns it and as the server card copies it. */
export function describeTool(t: Tool) {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
    annotations: { title: t.title, ...t.annotations },
    // Every tool is callable anonymously; ChatGPT and other clients that read
    // per-tool security schemes then know not to ask the user to sign in.
    securitySchemes: [{ type: "noauth" }],
  };
}

async function handleOne(server: McpServer, m: Message, req: Request): Promise<Record<string, unknown> | null> {
  const id: JsonRpcId = m.id ?? null;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    // A response or malformed message. Responses we never asked for are ignored per spec.
    if (m.result !== undefined || m.error !== undefined) return null;
    return rpcError(id, -32600, "Invalid Request: expected a JSON-RPC 2.0 request with a method");
  }
  const isNotification = m.id === undefined;
  if (isNotification) return null; // notifications/initialized, notifications/cancelled: nothing to do

  const params = (m.params ?? {}) as Record<string, unknown>;
  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const version = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, title: server.title, version: server.version },
        instructions: server.instructions,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: server.tools.map(describeTool) });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = server.tools.find((t) => t.name === name);
      if (!tool) return rpcError(id, -32602, `Unknown tool "${name}". Available: ${server.tools.map((t) => t.name).join(", ")}`);
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      try {
        const r = await tool.run(args, { req });
        return rpcResult(id, {
          content: [{ type: "text", text: r.text }],
          ...(r.structured !== undefined ? { structuredContent: r.structured } : {}),
          ...(r.isError ? { isError: true } : {}),
        });
      } catch (e) {
        if (e instanceof InvalidParams) return rpcError(id, -32602, `Invalid arguments for ${name}: ${e.message}`);
        // Anything else is a tool failure the model can read and react to, not a protocol error.
        return rpcResult(id, { content: [{ type: "text", text: `error: ${(e as Error).message}` }], isError: true });
      }
    }
    case "resources/list":
    case "resources/templates/list":
    case "prompts/list":
      return rpcError(id, -32601, `Method not found: this server offers tools only (${m.method} is not supported)`);
    case "logging/setLevel":
    case "completion/complete":
    default:
      return rpcError(id, -32601, `Method not found: ${m.method}`);
  }
}

/**
 * The MCP endpoint. POST carries JSON-RPC; GET is 405 because there is no
 * server-initiated stream to offer; DELETE is 405 because there are no
 * sessions to end. OPTIONS is answered here too so browser clients can preflight.
 */
export async function handleMcp(req: Request, server: McpServer): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: MCP_CORS });
  if (req.method === "GET" || req.method === "DELETE") {
    return respond(
      rpcError(null, -32000, req.method === "GET"
        ? "Method Not Allowed: this server does not open server-initiated streams. POST a JSON-RPC 2.0 message to this URL (Streamable HTTP, stateless)."
        : "Method Not Allowed: this server is stateless and has no sessions to terminate."),
      405,
      { allow: "POST, OPTIONS", link: `<https://classifier.dev/mcp-setup>; rel="help"; type="text/plain"` },
    );
  }
  if (req.method !== "POST") return respond(rpcError(null, -32000, "Method Not Allowed"), 405, { allow: "POST, OPTIONS" });

  // After initialize a client names the negotiated version on every request.
  // The transport spec says an invalid or unsupported one is a 400, not a
  // silently different protocol. No header at all is fine: the spec has the
  // server assume 2025-03-26, which is in the list.
  const asked = req.headers.get("mcp-protocol-version");
  if (asked !== null && !(PROTOCOL_VERSIONS as readonly string[]).includes(asked.trim())) {
    return respond(
      rpcError(null, -32600, `Unsupported MCP-Protocol-Version "${asked}". This server speaks ${PROTOCOL_VERSIONS.join(", ")}.`),
      400,
    );
  }

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return respond(rpcError(null, -32700, "Parse error: body must be a JSON-RPC 2.0 message (or an array of them)"), 400);
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  if (!messages.length || !messages.every((m) => m && typeof m === "object")) {
    return respond(rpcError(null, -32600, "Invalid Request: expected a JSON-RPC object or a non-empty array of them"), 400);
  }
  const replies: Record<string, unknown>[] = [];
  for (const m of messages as Message[]) {
    const r = await handleOne(server, m, req);
    if (r) replies.push(r);
  }
  // Only notifications or responses: accepted, nothing to say back.
  if (!replies.length) return new Response(null, { status: 202, headers: MCP_CORS });
  return respond(Array.isArray(parsed) ? replies : replies[0]);
}
