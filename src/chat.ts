/**
 * The chat: a model with the MCP server as its hands.
 *
 * The browser posts the conversation and reads back one stream of events:
 * text as it is generated, each tool call as it is made, each result as it
 * lands. The tools are exactly the ones `/mcp` serves — same names, same
 * schemas, same code path through the API — so what the assistant does in the
 * sidebar is what any connected agent would do, and nothing here can drift
 * from the MCP server.
 *
 * Nothing the visitor types is written down. The conversation lives in the
 * browser tab and in this request, and the only thing counted is that a turn
 * happened.
 */

import { describeTool, handleMcp, type McpServer } from "./mcp";
import { chatStats, type ChatStats, type ChatOutcome } from "./chat-analytics";

/** A cheap model that calls tools well; the classification is Jev's job, not its. */
export const CHAT_MODEL = "openai/gpt-5.6-luna";
/** Tool rounds per turn: a search, a page or two, a classification and the answer. */
const MAX_STEPS = 6;
const MAX_TOKENS = 2048;
export const MAX_MESSAGES = 40;
export const MAX_MESSAGE_CHARS = 8000;
/** A tool result the model reads in full; the browser gets the head of it. */
const RESULT_PREVIEW = 1200;
/**
 * Texts per classify call from the chat. The chat's calls carry the service's
 * own key, so this and the per-turn gate in index.ts are what bound a visitor's
 * spend, not the public per-IP quota.
 */
export const CHAT_MAX_INPUTS = 300;

export type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * The web, for the assistant only. Search and scrape come from context.dev
 * on this service's key, so they are tools the chat holds, not endpoints the
 * site serves: they are never added to the MCP server or the API.
 */
const CONTEXT_API = "https://api.context.dev/v1";
const SEARCH_MAX = 50;
/** Characters of a page the model gets to read. Enough for an article, not a site. */
const PAGE_CHARS = 8_000;

export const WEB_TOOLS = [
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web. Returns results as url, title and snippet, one per line. " +
        "The titles and snippets are already texts to classify: for headlines, posts or reviews, send them straight to classify_texts " +
        "without reading the pages. Read a page only when you need what is on it.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language or Google-style operators (site:, quotes, OR)." },
          count: { type: "integer", minimum: 10, maximum: SEARCH_MAX, description: "How many results, 10 to 50. Ask for what you will classify." },
          freshness: { type: "string", enum: ["last_24_hours", "last_week", "last_month", "last_year"], description: "Only content published within this window." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_page",
      description:
        "Fetch one URL and return its main content as Markdown, truncated to about 8,000 characters. " +
        "Use it to pull real texts off a page (comments, reviews, changelog entries, headlines) and then classify them. At most two pages per answer.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "Full http(s) URL." } },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
] as const;

/**
 * The clock, for the assistant only. The model has none, and a clock read off
 * a search result or a scraped page is whatever that page was cached at, so
 * the time comes from the worker and is converted here rather than in prose.
 */
export const TIME_TOOL = {
  type: "function",
  function: {
    name: "current_time",
    description:
      "The current date and time. Pass an IANA timezone to get the local time there (America/Chicago for Dallas, " +
      "Europe/London, Asia/Tokyo); without one you get UTC. Call this for any clock question, including one about a " +
      "place: it knows the offset and whether daylight saving is on. Never read a time off a search result or a page.",
    parameters: {
      type: "object",
      properties: { timezone: { type: "string", description: "IANA timezone name, e.g. America/Chicago." } },
      additionalProperties: false,
    },
  },
} as const;

/** The clock tool, run. The zone comes from the visitor's question, so a bad one is an error the model can read. */
export function runTimeTool(args: Record<string, unknown>, now = new Date()): { text: string; error?: boolean } {
  const zone = typeof args.timezone === "string" && args.timezone.trim() ? args.timezone.trim() : "UTC";
  let local: string;
  try {
    local = new Intl.DateTimeFormat("en-US", { timeZone: zone, dateStyle: "full", timeStyle: "long" }).format(now);
  } catch {
    return { text: `error: ${zone} is not an IANA timezone name; use one like America/Chicago`, error: true };
  }
  return { text: `${local}\nin ${zone}, and ${now.toISOString()} in UTC` };
}

async function contextFetch(key: string, path: string, init: RequestInit) {
  const res = await fetch(`${CONTEXT_API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers ?? {}) },
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(40_000)]) : AbortSignal.timeout(40_000),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof j.message === "string" ? j.message : `HTTP ${res.status}`);
  return j;
}

/** One of the web tools, run. Text for the model; an error is text too, so it can react. */
export async function runWebTool(key: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; error?: boolean }> {
  try {
    if (name === "web_search") {
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : "";
      if (!query) return { text: "error: query is required", error: true };
      const n = Number(args.count);
      const body: Record<string, unknown> = { query, numResults: Number.isFinite(n) ? Math.min(SEARCH_MAX, Math.max(10, Math.round(n))) : 10 };
      if (typeof args.freshness === "string") body.freshness = args.freshness;
      const j = await contextFetch(key, "/web/search", { method: "POST", signal, body: JSON.stringify(body) });
      const rows = (j.results as { url: string; title: string; description: string }[] | undefined) ?? [];
      if (!rows.length) return { text: "no results" };
      return { text: rows.map((r) => `${r.url}\t${r.title}\t${(r.description ?? "").replace(/\s+/g, " ")}`).join("\n") };
    }
    if (name === "read_page") {
      let url: URL;
      try {
        url = new URL(String(args.url ?? ""));
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      } catch {
        return { text: "error: url must be a full http(s) URL", error: true };
      }
      const q = new URLSearchParams({ url: url.href, useMainContentOnly: "true", includeLinks: "false" });
      const j = await contextFetch(key, `/web/scrape/markdown?${q}`, { method: "GET", signal });
      const md = typeof j.markdown === "string" ? j.markdown.trim() : "";
      if (!md) return { text: "the page had no readable text" };
      return { text: md.length > PAGE_CHARS ? `${md.slice(0, PAGE_CHARS)}\n\n[truncated: ${md.length - PAGE_CHARS} more characters]` : md };
    }
    return { text: `error: unknown tool ${name}`, error: true };
  } catch (e) {
    return { text: `error: ${(e as Error).message}`, error: true };
  }
}

/** One event on the stream. `text` is a fragment; the rest are whole. */
export type ChatEvent =
  | { t: "text"; d: string }
  | { t: "tool"; name: string; args: Record<string, unknown> }
  | { t: "result"; name: string; text: string; error?: boolean }
  | { t: "done" }
  | { t: "error"; message: string };

export function systemPrompt(server: McpServer, now = new Date()) {
  return (
    `Now is ${now.toISOString()} (UTC). ` +
    "You are the assistant on classifier.dev, a zero-shot text classification API. " +
    "You are talking to a visitor in a chat sidebar on the site. Show them what the API does by using it: " +
    "when they paste texts, ask for a demo, or describe a sorting problem, call a tool with real labels and real inputs " +
    "rather than describing what would happen. Act, do not ask: when a request names a page or a topic, fetch it with " +
    "read_page or web_search; when it asks you to invent or sample a batch, invent one (ten to twenty realistic short texts) " +
    "and say that you did; never ask the visitor for material you can fetch or make up yourself.\n\n" +
    "Answer in plain text: short sentences, no markdown headings, no bold, no tables. A tab-separated list is fine. " +
    "Keep answers under about 120 words unless the visitor asks for more. " +
    "Never invent results; every label and confidence you quote comes from a tool result. If a classify tool fails, " +
    "say what it said (a rate limit, an error) and stop there: do not label anything yourself, not even provisionally. " +
    "The API needs no key: curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone returns `spam`, " +
    "and POST https://classifier.dev/v1/classify takes {inputs, labels}. " +
    "Docs are at https://classifier.dev/docs and the MCP server at https://classifier.dev/mcp.\n\n" +
    "Ask current_time for the time or the date anywhere: it is the only clock you have, and a time printed in a search " +
    "result or on a fetched page is whatever that page was cached at, so it is wrong. Do not work an offset out in your head.\n\n" +
    "You can also search the web and read pages. Use them to get real text to classify, then classify it all in one call: " +
    "search results are texts (classify the titles or snippets directly); a page is a list of items (pull them out and classify them). " +
    "Read at most two pages per answer, and never classify one item at a time — send the whole batch to classify_texts or " +
    "classify_multi_label at once. Then report what came back: counts per label and a few concrete examples with their confidence.\n\n" +
    "About the classify tools: " +
    "Omit model and processing unless the visitor requests a particular model or lane. " +
    "The default handles batches. For Laya, omit processing to choose fast or bulk automatically from the workload. " +
    "Jev already supports batches and does not need a processing hint. " +
    server.instructions
  );
}

/** The MCP tool table in the shape the chat completions API wants. */
export function toolsFor(server: McpServer) {
  return server.tools.map((t) => {
    const d = describeTool(t);
    return { type: "function", function: { name: d.name, description: d.description, parameters: d.inputSchema } };
  });
}

/** The conversation as the browser sends it, checked and bounded. Throws with a message fit for a 400. */
export function parseMessages(v: unknown): ChatMessage[] {
  if (!Array.isArray(v) || !v.length) throw new Error("messages must be a non-empty array");
  if (v.length > MAX_MESSAGES) throw new Error(`at most ${MAX_MESSAGES} messages per conversation; start a new one`);
  const out = v.map((m, i) => {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if (role !== "user" && role !== "assistant") throw new Error(`messages[${i}].role must be "user" or "assistant"`);
    if (typeof content !== "string" || !content.trim()) throw new Error(`messages[${i}].content must be a non-empty string`);
    if (content.length > MAX_MESSAGE_CHARS) throw new Error(`messages[${i}] is longer than ${MAX_MESSAGE_CHARS} characters`);
    return { role, content } as ChatMessage;
  });
  if (out[out.length - 1].role !== "user") throw new Error("the last message must be from the user");
  return out;
}

type ToolCall = { id: string; name: string; args: string };
type Delta = {
  content?: string | null;
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
};

/**
 * One streamed completion. Text fragments go to `onText` as they arrive; the
 * tool calls the model asked for come back assembled once the stream ends.
 */
async function complete(
  key: string,
  body: Record<string, unknown>,
  onText: (s: string) => void,
  stats: ChatStats,
  signal: AbortSignal,
): Promise<{ text: string; calls: ToolCall[] }> {
  stats.modelCalls++;
  stats.unknownTokenCalls++;
  stats.unknownCostCalls++;
  let countedTokens = false, countedCost = false;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "http-referer": "https://classifier.dev",
      "x-title": "classifier.dev",
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`upstream ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  let text = "";
  const calls: ToolCall[] = [];
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk: { choices?: { delta?: Delta }[]; error?: { message?: string }; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new Error(`upstream: ${chunk.error.message ?? "error"}`);
      const usage = chunk.usage;
      if (usage) {
        if (!countedTokens && Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens! >= 0 && Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens! >= 0) {
          stats.inputTokens += usage.prompt_tokens!;
          stats.outputTokens += usage.completion_tokens!;
          stats.unknownTokenCalls--;
          countedTokens = true;
        }
        if (!countedCost && typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0) {
          stats.usd += usage.cost;
          stats.unknownCostCalls--;
          countedCost = true;
        }
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        onText(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const cur = (calls[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
      }
    }
  }
  return { text, calls: calls.filter(Boolean) };
}

/** Runs one tool through the MCP endpoint's own handler, so the two cannot differ. */
async function callTool(server: McpServer, req: Request, name: string, args: Record<string, unknown>) {
  const rpc = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } };
  const r = await handleMcp(
    new Request(new URL("/mcp", req.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": req.headers.get("user-agent") ?? "",
        // The chat's own credentials, when the route gave it any.
        ...(req.headers.get("authorization") ? { authorization: req.headers.get("authorization")! } : {}),
      },
      body: JSON.stringify(rpc),
    }),
    server,
  );
  const j = (await r.json().catch(() => ({}))) as {
    result?: { content?: { type: string; text?: string }[]; isError?: boolean };
    error?: { message?: string };
  };
  if (j.error) return { text: `error: ${j.error.message ?? "tool failed"}`, error: true };
  const text = (j.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  return { text, error: !!j.result?.isError };
}

/**
 * The whole turn as a stream of events: the model speaks, calls tools, reads
 * the results and speaks again, up to MAX_STEPS rounds. Errors after the
 * stream has started are events too, since the status line has already gone.
 */
export function chatStream(o: { key: string; webKey?: string; server: McpServer; req: Request; messages: ChatMessage[]; onFinish?: (outcome: ChatOutcome, stats: ChatStats) => Promise<void>; waitUntil?: (promise: Promise<void>) => void }): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const stats = chatStats();
  stats.starts = Number(o.messages.length === 1);
  const started = performance.now();
  const abort = new AbortController();
  let stopped = false;
  let recorded = false;
  const finish = async (outcome: ChatOutcome) => {
    if (recorded) return;
    recorded = true;
    stats.ms = performance.now() - started;
    await o.onFinish?.(outcome, { ...stats });
  };
  return new ReadableStream({
    start(controller) {
      const run = async () => {
        let outcome: ChatOutcome = "completed";
        const send = (e: ChatEvent) => { if (!stopped) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); };
        const messages: Record<string, unknown>[] = [
          { role: "system", content: systemPrompt(o.server) },
          ...o.messages,
        ];
        const tools = [...toolsFor(o.server), TIME_TOOL, ...(o.webKey ? WEB_TOOLS : [])];
        const isWeb = (name: string) => WEB_TOOLS.some((t) => t.function.name === name);
        try {
          for (let step = 0; ; step++) {
            abort.signal.throwIfAborted();
            const last = step >= MAX_STEPS;
            const { text, calls } = await complete(
              o.key,
              // Reasoning kept low: the thinking is Jev's job, and it is billed as output.
              { model: CHAT_MODEL, messages, max_tokens: MAX_TOKENS, reasoning: { effort: "low" }, ...(last ? {} : { tools }) },
              (d) => send({ t: "text", d }),
              stats, abort.signal,
            );
            if (!calls.length || last) break;
            messages.push({
              role: "assistant",
              content: text || null,
              tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
            });
            for (const c of calls) {
              abort.signal.throwIfAborted();
              stats.toolCalls++;
              if (c.name === "classify_texts" || c.name === "classify_dimensions") stats.classifyCalls++;
              else if (c.name === "web_search") stats.webSearches++;
              else if (c.name === "read_page") stats.pageReads++;
              else if (c.name === TIME_TOOL.function.name) stats.clockCalls++;
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(c.args || "{}");
              } catch {
                /* the tool reports the bad arguments */
              }
              send({ t: "tool", name: c.name, args });
              const r =
                Array.isArray(args.inputs) && args.inputs.length > CHAT_MAX_INPUTS
                  ? { text: `error: the chat classifies at most ${CHAT_MAX_INPUTS} texts per call; send fewer`, error: true }
                  : c.name === TIME_TOOL.function.name
                    ? runTimeTool(args)
                    : isWeb(c.name) && o.webKey
                      ? await runWebTool(o.webKey, c.name, args, abort.signal)
                      : await callTool(o.server, o.req, c.name, args);
              if (r.error) stats.toolErrors++;
              send({ t: "result", name: c.name, text: r.text.slice(0, RESULT_PREVIEW), ...(r.error ? { error: true } : {}) });
              messages.push({ role: "tool", tool_call_id: c.id, content: r.text });
            }
          }
          send({ t: "done" });
        } catch (e) {
          outcome = stopped ? "stopped" : "failed";
          if (!stopped) send({ t: "error", message: "the assistant could not answer; try again" });
        } finally {
          if (!stopped) controller.close();
          await finish(stopped ? "stopped" : outcome);
        }
      };
      const finished = run();
      o.waitUntil?.(finished);
    },
    cancel() { stopped = true; abort.abort(); const recorded = finish("stopped"); o.waitUntil?.(recorded); return recorded; },
  });
}
