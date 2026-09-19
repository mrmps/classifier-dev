// Run with: npm test
//
// The MCP endpoint is hand-rolled, so the transport rules it has to keep are
// spelled out here: 202 for notifications, 405 for GET, JSON-RPC errors with
// the standard codes, and tool failures reported as results the model can read.
import { describe, it, expect } from "bun:test";
import { handleMcp, productServer, docsServer, PROTOCOL_VERSIONS, type ClassifyFn } from "../src/mcp";

const fakeClassify: ClassifyFn = async (body) => {
  const inputs = body.inputs as string[];
  const labels = body.labels as string[];
  if (labels.includes("boom")) return { status: 502, body: { error: "upstream: typesafe 500", code: "typesafe_500" } };
  const results = inputs.map((t) =>
    body.multi
      ? { labels: labels.filter((l) => t.includes(l)), scores: Object.fromEntries(labels.map((l) => [l, t.includes(l) ? 0.9 : 0.1])) }
      : {
          label: labels.find((l) => t.includes(l)) ?? labels[0],
          confidence: t.includes("?") ? 0.4 : 0.95,
          scores: Object.fromEntries(labels.map((l, i) => [l, i === 0 ? 0.6 : 0.4 / (labels.length - 1)])),
        },
  );
  return { status: 200, body: { tier: "fast", model: "fake", results, usage: { classifications: inputs.length, escalated: 0, ms: 1 } } };
};

const server = productServer(fakeClassify);
const post = (body: unknown, headers: Record<string, string> = {}) =>
  handleMcp(
    new Request("https://classifier.dev/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(body),
    }),
    server,
  );
const rpc = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: "2.0", id, method, params });

describe("mcp transport", () => {
  it("initialize negotiates a supported protocol version and introduces itself", async () => {
    const res = await post(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const j = await res.json();
    expect(j.result.protocolVersion).toBe("2025-06-18");
    expect(j.result.serverInfo.name).toBe("classifier.dev");
    expect(j.result.instructions.length).toBeGreaterThan(100);
    expect(j.result.capabilities.tools).toBeDefined();
    // An unknown version gets our latest, not an error.
    const j2 = await (await post(rpc("initialize", { protocolVersion: "1999-01-01" }))).json();
    expect(j2.result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });

  it("MCP-Protocol-Version is honoured when it names a version we speak and a 400 when it does not", async () => {
    for (const v of PROTOCOL_VERSIONS) {
      expect((await post(rpc("ping"), { "mcp-protocol-version": v })).status).toBe(200);
    }
    // No header: the spec has the server assume 2025-03-26, which we speak.
    expect((await post(rpc("ping"))).status).toBe(200);
    const bad = await post(rpc("ping"), { "mcp-protocol-version": "1999-01-01" });
    expect(bad.status).toBe(400);
    const j = await bad.json();
    expect(j.error.code).toBe(-32600);
    expect(j.error.message).toContain("1999-01-01");
    expect(j.error.message).toContain(PROTOCOL_VERSIONS[0]);
  });

  it("notifications are accepted with 202 and no body", async () => {
    const res = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("");
  });

  it("GET and DELETE are 405 with a JSON-RPC error; OPTIONS preflights", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await handleMcp(new Request("https://classifier.dev/mcp", { method }), server);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toContain("POST");
      expect((await res.json()).error.code).toBe(-32000);
    }
    const opt = await handleMcp(new Request("https://classifier.dev/mcp", { method: "OPTIONS" }), server);
    expect(opt.status).toBe(204);
    expect(opt.headers.get("access-control-allow-headers")).toContain("Mcp-Session-Id");
  });

  it("parse errors, bad requests and unknown methods use the standard codes", async () => {
    const bad = await handleMcp(new Request("https://classifier.dev/mcp", { method: "POST", body: "{nope" }), server);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe(-32700);
    const notRpc = await (await post({ hello: 1 })).json();
    expect(notRpc.error.code).toBe(-32600);
    const missing = await (await post(rpc("prompts/list"))).json();
    expect(missing.error.code).toBe(-32601);
    const unknownTool = await (await post(rpc("tools/call", { name: "nope", arguments: {} }))).json();
    expect(unknownTool.error.code).toBe(-32602);
    expect(unknownTool.error.message).toContain("classify_texts");
  });

  it("batches of requests get a batch of responses, in order", async () => {
    const res = await post([rpc("ping", undefined, "a"), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("tools/list", undefined, "b")]);
    const j = await res.json();
    expect(Array.isArray(j)).toBe(true);
    expect(j.map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
  });
});

describe("mcp tools", () => {
  it("lists five well-formed, read-only tools", async () => {
    const { result } = await (await post(rpc("tools/list"))).json();
    expect(result.tools.map((t: { name: string }) => t.name)).toEqual(["classify_texts", "classify_dimensions", "classify_multi_label", "count_labels", "review_uncertain"]);
    for (const t of result.tools) {
      expect(t.description.length).toBeGreaterThan(100);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.required).toContain(t.name === "classify_dimensions" ? "dimensions" : "labels");
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.annotations.destructiveHint).toBe(false);
    }
  });

  it("classify_texts returns text rows and the structured API answer", async () => {
    const { result } = await (await post(rpc("tools/call", { name: "classify_texts", arguments: { inputs: ["a bug here", "praise?"], labels: ["bug", "praise"] } }))).json();
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe("label\tconfidence\ttext\nbug\t0.95\ta bug here\npraise\t0.40\tpraise?");
    expect(result.structuredContent.results).toHaveLength(2);
  });

  it("invalid arguments are -32602 with a message that names the problem", async () => {
    const one = await (await post(rpc("tools/call", { name: "classify_texts", arguments: { inputs: ["x"], labels: ["only"] } }))).json();
    expect(one.error.code).toBe(-32602);
    expect(one.error.message).toContain("labels needs at least 2");
    const none = await (await post(rpc("tools/call", { name: "classify_texts", arguments: { labels: ["a", "b"] } }))).json();
    expect(none.error.message).toContain("inputs is required");
    const badTier = await (await post(rpc("tools/call", { name: "classify_texts", arguments: { inputs: ["x"], labels: ["a", "b"], tier: "turbo" } }))).json();
    expect(badTier.error.message).toContain('"fast" or "smart"');
    const badMax = await (await post(rpc("tools/call", { name: "classify_multi_label", arguments: { inputs: ["x"], labels: ["a", "b"], max_labels: 1.5 } }))).json();
    expect(badMax.error.message).toContain("whole number");
  });

  it("an API failure is a tool result with isError, not a protocol error", async () => {
    const { result, error } = await (await post(rpc("tools/call", { name: "classify_texts", arguments: { inputs: ["x"], labels: ["boom", "b"] } }))).json();
    expect(error).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("upstream");
    expect(result.structuredContent.code).toBe("typesafe_500");
  });

  it("count_labels tallies every label and the unsure ones", async () => {
    const { result } = await (await post(rpc("tools/call", { name: "count_labels", arguments: { inputs: ["bug", "bug?", "praise"], labels: ["bug", "praise", "other"] } }))).json();
    expect(result.structuredContent).toEqual({ total: 3, counts: { bug: 2, praise: 1, other: 0 }, unsure: 1, unsure_below: 0.7 });
    expect(result.content[0].text).toContain("2\tbug");
  });

  it("review_uncertain returns only the unsure items with a runner-up", async () => {
    const { result } = await (await post(rpc("tools/call", { name: "review_uncertain", arguments: { inputs: ["bug", "praise?"], labels: ["bug", "praise"] } }))).json();
    expect(result.structuredContent.uncertain).toEqual([{ index: 1, text: "praise?", label: "praise", confidence: 0.4, runner_up: "bug" }]);
  });

  it("classify_multi_label sends multi and joins labels", async () => {
    const { result } = await (await post(rpc("tools/call", { name: "classify_multi_label", arguments: { inputs: ["bug and praise"], labels: ["bug", "praise"], max_labels: 2 } }))).json();
    expect(result.content[0].text).toBe("labels\ttext\nbug,praise\tbug and praise");
  });
});

describe("docs server", () => {
  const docs = docsServer([
    { id: "api", title: "classifier.dev", url: "https://classifier.dev/", text: "classifier.dev\n\nIntro paragraph.\n\nLIMITS\n\n  3,000 a minute on fast.\n\n  200 a minute on smart.\n\nPRIVACY\n\n  Inputs are not stored.\n" },
    { id: "bench", title: "benchmark", url: "https://classifier.dev/benchmark", text: "# benchmark\n\nJev alone 87.5%.\n" },
  ]);
  const ask = (method: string, params?: unknown) =>
    handleMcp(new Request("https://classifier.dev/mcp/docs", { method: "POST", body: JSON.stringify(rpc(method, params)) }), docs);

  it("lists, reads by section, and searches", async () => {
    const list = (await (await ask("tools/list")).json()).result.tools.map((t: { name: string }) => t.name);
    expect(list).toEqual(["list_docs", "read_doc", "search_docs", "get_examples"]);
    const ex = (await (await ask("tools/call", { name: "get_examples", arguments: { client: "python" } })).json()).result;
    expect(ex.content[0].text).toContain("requests.post");
    const bad = (await (await ask("tools/call", { name: "get_examples", arguments: { client: "cobol" } })).json()).error;
    expect(bad.code).toBe(-32602);
    const ld = (await (await ask("tools/call", { name: "list_docs", arguments: {} })).json()).result.structuredContent.docs;
    expect(ld[0].sections).toEqual(["classifier.dev", "LIMITS", "PRIVACY"]);
    const sec = (await (await ask("tools/call", { name: "read_doc", arguments: { id: "api", section: "lim" } })).json()).result;
    expect(sec.content[0].text).toContain("3,000 a minute");
    expect(sec.content[0].text).not.toContain("Inputs are not stored");
    const miss = (await (await ask("tools/call", { name: "read_doc", arguments: { id: "api", section: "nope" } })).json()).result;
    expect(miss.isError).toBe(true);
    const search = (await (await ask("tools/call", { name: "search_docs", arguments: { query: "minute smart" } })).json()).result.structuredContent;
    expect(search.total).toBe(1);
    expect(search.hits[0].section).toBe("LIMITS");
    const unknown = (await (await ask("tools/call", { name: "read_doc", arguments: { id: "zzz" } })).json()).error;
    expect(unknown.code).toBe(-32602);
  });
});
