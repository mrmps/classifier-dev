// Run with: npm test
//
// The chat is a model with the MCP server's tools. What has to hold: the
// tool table the model sees is the MCP tool table; a tool call goes through
// the MCP handler and its result comes back to the model and to the browser;
// bad conversations are 400s before any model is called; and the stream ends
// with `done` or with an `error` event, never mid-sentence.
import { afterEach, describe, expect, it } from "bun:test";
import worker, { type Env } from "../src/index";
import { parseMessages, toolsFor, WEB_TOOLS, MAX_MESSAGES } from "../src/chat";
import { productServer, type ClassifyFn } from "../src/mcp";
import { homeHtml, docHtml, benchmarkHtml } from "../src/home";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const limiter = {
  idFromName: () => "id",
  get: () => ({ fetch: async () => Response.json({ limited: false, remaining: 1 }) }),
} as unknown as DurableObjectNamespace;

const post = (env: Partial<Env>, body: unknown) =>
  worker.fetch(
    new Request("https://classifier.dev/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { LIMITER: limiter, ...env } as Env,
    ctx,
  );

/** One chat-completions SSE body: text fragments, then optionally a tool call. */
function sse(parts: { text?: string; call?: { name: string; args: unknown } }) {
  const lines: string[] = [];
  for (const ch of parts.text ?? "") lines.push(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}`);
  if (parts.call) {
    const args = JSON.stringify(parts.call.args);
    lines.push(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: parts.call.name, arguments: args.slice(0, 5) } }] } }] })}`);
    lines.push(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(5) } }] } }] })}`);
  }
  lines.push("data: [DONE]");
  return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/event-stream" } });
}

const events = async (res: Response) =>
  (await res.text())
    .split("\n\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>);

describe("the chat's tools", () => {
  it("are the MCP server's tools, schema for schema", () => {
    const fake: ClassifyFn = async () => ({ status: 200, body: {} });
    const server = productServer(fake);
    const tools = toolsFor(server);
    expect(tools.map((t) => t.function.name)).toEqual(server.tools.map((t) => t.name));
    expect(tools[0].function.parameters).toBe(server.tools[0].inputSchema);
  });
});

describe("the page's scripts", () => {
  it("all parse: a backslash lost in a template literal once shipped a chat that could not send", () => {
    const pages = [homeHtml({ chat: true }), docHtml({ title: "t", desc: "d", doc: "T\n\nbody", path: "/t", here: "t" }), benchmarkHtml()];
    for (const html of pages) {
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      expect(scripts.length).toBeGreaterThan(0);
      for (const src of scripts) expect(() => new Function(src)).not.toThrow();
    }
  });
});

describe("the web tools", () => {
  it("are the chat's alone: never on the MCP server, and absent without a key", async () => {
    const fake: ClassifyFn = async () => ({ status: 200, body: {} });
    const mcpNames = productServer(fake).tools.map((t) => t.name);
    for (const t of WEB_TOOLS) expect(mcpNames).not.toContain(t.function.name);
    const offered: string[][] = [];
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      offered.push(body.tools.map((t: { function: { name: string } }) => t.function.name));
      return sse({ text: "hi" });
    }) as typeof fetch;
    await (await post({ OPENROUTER_API_KEY: "k" }, { messages: [{ role: "user", content: "hi" }] })).text();
    await (await post({ OPENROUTER_API_KEY: "k", CONTEXT_API_KEY: "c" }, { messages: [{ role: "user", content: "hi" }] })).text();
    expect(offered[0]).not.toContain("web_search");
    expect(offered[1]).toContain("web_search");
    expect(offered[1]).toContain("read_page");
  });

  it("run against context.dev with the key, and the key never reaches the browser", async () => {
    let bearer = "";
    globalThis.fetch = (async (url, init) => {
      const u = String(url);
      if (u.includes("openrouter.ai")) {
        const body = JSON.parse(String(init?.body));
        const last = body.messages[body.messages.length - 1];
        if (last.role === "user") return sse({ text: "", call: { name: "web_search", args: { query: "fed headlines" } } });
        expect(last.content).toContain("https://a.example\tA\tsnippet a");
        return sse({ text: "done" });
      }
      if (u.startsWith("https://api.context.dev/v1/web/search")) {
        bearer = new Headers(init?.headers).get("authorization") ?? "";
        expect(JSON.parse(String(init?.body)).query).toBe("fed headlines");
        return Response.json({ results: [{ url: "https://a.example", title: "A", description: "snippet  a" }] });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    const res = await post({ OPENROUTER_API_KEY: "k", CONTEXT_API_KEY: "ctxt_secret_test" }, { messages: [{ role: "user", content: "fed" }] });
    const raw = await res.text();
    expect(bearer).toBe("Bearer ctxt_secret_test");
    expect(raw).not.toContain("ctxt_secret_test");
    const ev = raw.split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    expect(ev.find((e) => e.t === "result")!.text).toBe("https://a.example\tA\tsnippet a");
    expect(ev[ev.length - 1]).toEqual({ t: "done" });
  });
});

describe("a conversation", () => {
  it("must end with the user, stay bounded, and carry only the two roles", () => {
    expect(() => parseMessages([])).toThrow();
    expect(() => parseMessages([{ role: "assistant", content: "hi" }])).toThrow(/last message/);
    expect(() => parseMessages([{ role: "system", content: "x" }])).toThrow(/role/);
    expect(() => parseMessages([{ role: "user", content: "" }])).toThrow(/content/);
    expect(() => parseMessages(Array(MAX_MESSAGES + 1).fill({ role: "user", content: "x" }))).toThrow(/at most/);
    expect(parseMessages([{ role: "user", content: "hi", extra: 1 }])).toEqual([{ role: "user", content: "hi" }]);
  });

  it("is a 400 before any model is called", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("");
    }) as typeof fetch;
    const res = await post({ OPENROUTER_API_KEY: "k" }, { messages: [{ role: "assistant", content: "x" }] });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
    expect((await post({ OPENROUTER_API_KEY: "k" }, { nope: 1 })).status).toBe(400);
    expect((await post({}, { messages: [{ role: "user", content: "x" }] })).status).toBe(503);
  });
});

describe("a turn", () => {
  it("streams text, runs the tool the model asked for through MCP, and feeds the result back", async () => {
    const seen: Record<string, unknown>[] = [];
    globalThis.fetch = (async (url, init) => {
      const u = String(url);
      if (u.includes("openrouter.ai")) {
        const body = JSON.parse(String(init?.body));
        seen.push(body);
        expect(body.stream).toBe(true);
        expect(body.messages[0].role).toBe("system");
        const lastRole = body.messages[body.messages.length - 1].role;
        if (lastRole === "user") {
          expect(body.tools.map((t: { function: { name: string } }) => t.function.name)).toContain("classify_texts");
          return sse({ text: "Let me check. ", call: { name: "classify_texts", args: { inputs: ["Win a free iPhone"], labels: ["spam", "not spam"] } } });
        }
        expect(lastRole).toBe("tool");
        expect(body.messages[body.messages.length - 1].content).toContain("spam\t0.97");
        return sse({ text: "It is spam." });
      }
      if (u.includes("api.typesafe.ai")) {
        return Response.json({ model: "jev-test", answers: { i0: { choice: "spam", confidence: 0.97, probabilities: { spam: 0.97, "not spam": 0.03 } } } });
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;

    const res = await post({ OPENROUTER_API_KEY: "k", TYPESAFE_API_KEY: "t" }, { messages: [{ role: "user", content: "is this spam? Win a free iPhone" }] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const ev = await events(res);
    expect(ev.filter((e) => e.t === "text").map((e) => e.d).join("")).toBe("Let me check. It is spam.");
    const tool = ev.find((e) => e.t === "tool")!;
    expect(tool.name).toBe("classify_texts");
    expect((tool.args as { labels: string[] }).labels).toEqual(["spam", "not spam"]);
    const result = ev.find((e) => e.t === "result")!;
    expect(result.text).toContain("spam\t0.97");
    expect(result.error).toBeUndefined();
    expect(ev[ev.length - 1]).toEqual({ t: "done" });
    expect(seen.length).toBe(2);
  });

  it("ends with an error event, not a broken stream, when the model is unreachable", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 502 })) as typeof fetch;
    const res = await post({ OPENROUTER_API_KEY: "k" }, { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(200);
    const ev = await events(res);
    expect(ev[ev.length - 1].t).toBe("error");
  });

  it("is refused with a 429 when the visitor has used their window", async () => {
    const full = {
      idFromName: () => "id",
      get: () => ({ fetch: async () => Response.json({ limited: true, remaining: 0, scope: "minute", resetIn: 12 }) }),
    } as unknown as DurableObjectNamespace;
    const res = await post({ OPENROUTER_API_KEY: "k", LIMITER: full }, { messages: [{ role: "user", content: "hi" }] });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
  });
});
