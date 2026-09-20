// Run with: npm test
//
// The discovery files are generated from the same constants as everything
// else, so the tests here are about the contracts those constants cannot
// keep on their own: every URL a file names answers, every file that names a
// tool names the live ones, and each file carries the media type, validator
// and cache headers its spec asks for.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import worker from "../src/index";
import type { Env } from "../src/index";
import { PROTOCOL_VERSIONS, SERVER_VERSION } from "../src/mcp";
import { SERVER_CARD_SCHEMA, SERVER_CARD_TYPE, AI_CATALOG_TYPE, API_CATALOG_TYPE } from "../src/wellknown";
import { isAppRequest } from "../src/http/dispatch";

const env = {} as Env;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const ORIGIN = "https://classifier.dev";

const get = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, { headers: { "user-agent": "curl/8.0", ...headers } }), env, ctx);
const getJson = async (path: string) => (await get(path)).json() as Promise<Record<string, any>>;
const rpc = (path: string, method: string, params?: unknown, headers: Record<string, string> = {}) =>
  worker.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    env,
    ctx,
  );

const liveTools = async (path: string) => ((await (await rpc(path, "tools/list")).json()) as { result: { tools: { name: string }[] } }).result.tools;

/** Every document an agent might read before it reads a page. */
const JSON_DOCS = [
  "/.well-known/mcp/server-card.json",
  "/.well-known/mcp/docs-server-card.json",
  "/mcp/server-card",
  "/mcp/docs/server-card",
  "/.well-known/ard.json",
  "/.well-known/ai-catalog.json",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/.well-known/api-catalog",
  "/.well-known/oauth-protected-resource",
  "/.well-known/agent-feedback.json",
  "/.well-known/agent-skills/index.json",
  "/.well-known/skills/index.json",
  "/openapi.json",
  "/api",
  "/agent.json",
];
const TEXT_DOCS = ["/llms.txt", "/agents.md", "/auth.md", "/robots.txt", "/sitemap.xml", "/.well-known/security.txt", "/.well-known/mcp-registry-auth", "/skill.md"];

describe("every discovery document", () => {
  test.each(JSON_DOCS)("%s is JSON with the headers a cached public document needs", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/json/);
    expect(res.headers.get("cache-control")).toContain("max-age");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    await res.json();
  });

  test.each(TEXT_DOCS)("%s answers as text with cache and sniffing headers", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^(text\/|application\/xml)/);
    expect(res.headers.get("cache-control")).toContain("max-age");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  /**
   * A discovery file that points at a path this worker does not serve is
   * worse than none. Public URLs are fetched through the legacy worker.
   * Protected application URLs must instead be claimed by the application
   * dispatcher and exist in the generated router; they are not public 200s.
   * The two MCP endpoints answer GET with 405 by design, and the classify
   * endpoint is POST-only, so those are proved the way they are used.
   */
  test("every on-origin URL answers publicly or belongs to a registered application route", async () => {
    const seen = new Map<string, Set<string>>();
    for (const path of [...JSON_DOCS, ...TEXT_DOCS]) {
      const body = await (await get(path)).text();
      for (const m of body.matchAll(/https:\/\/classifier\.dev(\/[^\s"'<>)\]`\\]*)?/g)) {
        // Trailing prose punctuation is not part of the URL; a comma that
        // survives is a label list, which with query strings and templates
        // marks the inline classify examples rather than documents.
        const p = (m[1] ?? "/").replace(/[.,;:]+$/, "");
        if (p.includes("?") || p.includes(",") || p.includes("{")) continue;
        if (!seen.has(p)) seen.set(p, new Set());
        seen.get(p)!.add(path);
      }
    }
    expect(seen.size).toBeGreaterThan(20);
    const routeTree = readFileSync(new URL("../src/routeTree.gen.ts", import.meta.url), "utf8");
    const fullPathRegistry = routeTree.match(/export interface FileRoutesByFullPath \{([\s\S]*?)\n\}/)?.[1];
    expect(fullPathRegistry).toBeDefined();
    const registeredAppPaths = new Set(
      [...fullPathRegistry!.matchAll(/'([^']+)': typeof /g)].map((match) => match[1]),
    );
    const failures: string[] = [];
    for (const [p, from] of seen) {
      if (p === "/app" || p.startsWith("/app/")) {
        expect(isAppRequest(new Request(`${ORIGIN}${p}`))).toBe(true);
        expect(registeredAppPaths.has(p)).toBe(true);
        continue;
      }
      let status: number;
      if (p === "/v1/classify" || p === "/subscribe" || p === "/subscribe/confirm") {
        const res = await worker.fetch(
          new Request(`${ORIGIN}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: ["x"], labels: ["only"] }) }),
          env,
          ctx,
        );
        status = res.status === 400 ? 200 : res.status;
      } else if (p === "/api/v1/feedback" || p === "/api/v1/observations") {
        const body = p.endsWith("/feedback")
          ? { signal: { category: "bug" }, content: { title: "Discovery link check" } }
          : { category: "bug", summary: "Discovery link check" };
        const res = await worker.fetch(
          new Request(`${ORIGIN}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
          env,
          ctx,
        );
        status = res.status === 202 ? 200 : res.status;
      } else {
        const res = await get(p);
        status = res.status;
        if (status === 405 && (p === "/mcp" || p === "/mcp/docs")) status = 200;
      }
      if (status !== 200) failures.push(`${status} ${p} (named by ${[...from].join(", ")})`);
    }
    expect(failures).toEqual([]);
  });

  test("authentication docs describe workspace credits and Pro quotas", async () => {
    const auth = await (await get("/auth.md")).text();
    expect(auth).toContain("service_auth (workspace key)");
    expect(auth).not.toContain("classifier_pro_");
    expect(auth).toContain("Pro workspaces get 10x limits");
    expect(auth).toContain("Authorization: Bearer classifier_agent_");
    expect(auth).not.toContain("Pro is $20/month for");
    const docs = await (await get("/")).text();
    expect(docs).toContain("Pro workspaces allow 30,000/minute and 200,000/day");
    expect(docs).toContain("Workspace keys use the workspace credit balance");
  });
});

describe("the MCP server cards", () => {
  test("carry the extension's identity and remotes, and the schema URL it mandates", async () => {
    for (const [path, endpoint] of [["/mcp/server-card", "/mcp"], ["/mcp/docs/server-card", "/mcp/docs"]] as const) {
      const card = await getJson(path);
      expect(card.$schema).toBe(SERVER_CARD_SCHEMA);
      expect(card.$schema).toMatch(/^https:\/\/static\.modelcontextprotocol\.io\/schemas\/v1\/server-card\.schema\.json$/);
      for (const k of ["name", "version", "description", "title", "websiteUrl", "repository", "icons", "remotes"]) expect(card[k]).toBeDefined();
      expect(card.version).toBe(SERVER_VERSION);
      expect(card.repository).toEqual({ url: "https://github.com/mrmps/classifier-dev", source: "github" });
      expect(card.icons[0].src).toBe(`${ORIGIN}/favicon.svg`);
      expect(card.remotes).toEqual([{ type: "streamable-http", url: `${ORIGIN}${endpoint}`, supportedProtocolVersions: [...PROTOCOL_VERSIONS] }]);
      expect(card.url).toBe(`${ORIGIN}${endpoint}`);
    }
  });

  test("are the same document at the extension's path and the .well-known one", async () => {
    expect(await getJson("/mcp/server-card")).toEqual(await getJson("/.well-known/mcp/server-card.json"));
    expect(await getJson("/mcp/docs/server-card")).toEqual(await getJson("/.well-known/mcp/docs-server-card.json"));
  });

  test("describe exactly the tools the live servers list", async () => {
    const card = await getJson("/mcp/server-card");
    expect(card.tools).toEqual(await liveTools("/mcp"));
    const docsCard = await getJson("/mcp/docs/server-card");
    const docsLive = await liveTools("/mcp/docs");
    expect(docsCard.tools).toEqual(docsLive);
    expect(card.relatedServers[0].tools).toEqual(docsLive.map((t) => t.name));
    expect(card.relatedServers[0].url).toBe(`${ORIGIN}/mcp/docs`);
  });

  test("negotiate their own media type and answer If-None-Match with 304", async () => {
    const plain = await get("/mcp/server-card");
    expect(plain.headers.get("content-type")).toContain("application/json");
    expect(plain.headers.get("vary")).toContain("accept");
    const typed = await get("/mcp/server-card", { accept: SERVER_CARD_TYPE });
    expect(typed.headers.get("content-type")).toBe(SERVER_CARD_TYPE);
    const etag = typed.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(await typed.json()).toEqual(await plain.json());
    const cached = await get("/mcp/server-card", { "if-none-match": etag! });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    expect(cached.headers.get("etag")).toBe(etag);
    const stale = await get("/mcp/server-card", { "if-none-match": '"nope"' });
    expect(stale.status).toBe(200);
  });
});

describe("the catalogs", () => {
  test("ard.json and ai-catalog.json are one catalog under two media types", async () => {
    const ard = await get("/.well-known/ard.json");
    const ai = await get("/.well-known/ai-catalog.json");
    expect(ard.headers.get("content-type")).toContain("application/json");
    expect(ai.headers.get("content-type")).toBe(AI_CATALOG_TYPE);
    const a = await ard.json() as { specVersion: string; entries: { identifier: string; type: string; url: string; capabilities?: string[] }[] };
    expect(await ai.json()).toEqual(a);
    expect(a.specVersion).toBe("1.0");
    for (const e of a.entries) {
      expect(e.identifier).toMatch(/^urn:air:classifier\.dev:[a-z]+:[a-z-]+$/);
      expect(e.type).toMatch(/^[a-z]+\/[a-z0-9.+-]+(;.*)?$/);
      expect(e.url.startsWith(ORIGIN)).toBe(true);
    }
    const cards = a.entries.filter((e) => e.type === SERVER_CARD_TYPE);
    expect(cards.map((e) => e.url)).toEqual([`${ORIGIN}/.well-known/mcp/server-card.json`, `${ORIGIN}/.well-known/mcp/docs-server-card.json`]);
    expect(cards[0].capabilities).toEqual((await liveTools("/mcp")).map((t) => t.name));
    expect(cards[1].capabilities).toEqual((await liveTools("/mcp/docs")).map((t) => t.name));
    const feedback = a.entries.find((e) => e.url === `${ORIGIN}/.well-known/agent-feedback.json`);
    expect(feedback?.capabilities).toEqual(["submit_feedback", "submit_observation", "add_attachments", "get_receipt"]);
  });

  test("the general API index keeps agent feedback discoverable", async () => {
    const index = await getJson("/api");
    expect(index.api.feedback).toEqual({
      discovery: `${ORIGIN}/.well-known/agent-feedback.json`,
      policy: `${ORIGIN}/api/v1/policy`,
      submit: {
        method: "POST",
        url: `${ORIGIN}/api/v1/feedback`,
        description: "Submit structured agent feedback with optional evidence. No authentication required.",
      },
      observe: {
        method: "POST",
        url: `${ORIGIN}/api/v1/observations`,
        body: { category: "bug", summary: "What happened", surface: "/v1/classify" },
        description: "Send one lightweight observation when a full report is unnecessary.",
      },
      receipt: `${ORIGIN}/api/v1/receipts/{id}`,
    });
    expect(index.discovery).toContain(`${ORIGIN}/.well-known/agent-feedback.json`);
  });

  test("the A2A card has every field the 0.3.0 AgentCard requires and one skill per live tool", async () => {
    const card = await getJson("/.well-known/agent-card.json");
    for (const k of ["protocolVersion", "name", "description", "url", "version", "capabilities", "defaultInputModes", "defaultOutputModes", "skills"]) {
      expect(card[k]).toBeDefined();
    }
    for (const i of card.additionalInterfaces) expect(["JSONRPC", "GRPC", "HTTP+JSON"]).toContain(i.transport);
    for (const s of card.skills) for (const k of ["id", "name", "description", "tags"]) expect(s[k]).toBeDefined();
    expect(card.skills.map((s: { id: string }) => s.id)).toEqual((await liveTools("/mcp")).map((t) => t.name));
    expect(await getJson("/.well-known/agent.json")).toEqual(card);
  });

  test("the RFC 9727 api-catalog is a linkset with the profiled media type", async () => {
    const res = await get("/.well-known/api-catalog");
    expect(res.headers.get("content-type")).toBe(API_CATALOG_TYPE);
    const { linkset } = await res.json() as { linkset: Record<string, unknown>[] };
    expect(linkset[0].anchor).toBe(`${ORIGIN}/`);
    expect(linkset[0]["service-desc"]).toBeDefined();
    expect(linkset[1].anchor).toBe(`${ORIGIN}/mcp`);
  });

  test("the Link header on the front page names the catalog with a well-formed media type", async () => {
    const link = (await get("/")).headers.get("link") ?? "";
    const catalog = link.split(", ").find((l) => l.includes('rel="api-catalog"'));
    expect(catalog).toBeDefined();
    // The whole type is one quoted-string; the profile's own quotes are quoted-pairs inside it.
    expect(catalog).toContain('type="application/linkset+json;profile=\\"https://www.rfc-editor.org/info/rfc9727\\""');
  });
});

describe("what names the tools", () => {
  test("llms.txt, agents.md and the MCP setup page list every live tool by name", async () => {
    const product = (await liveTools("/mcp")).map((t) => t.name);
    const docs = (await liveTools("/mcp/docs")).map((t) => t.name);
    const llms = await (await get("/llms.txt")).text();
    const setup = await (await get("/mcp-setup")).text();
    const agents = await (await get("/agents.md")).text();
    for (const name of product) {
      expect(llms).toContain(name);
      expect(setup).toContain(name);
      expect(agents).toContain(name);
    }
    for (const name of docs) {
      expect(llms).toContain(name);
      expect(setup).toContain(name);
    }
  });

  test("the registry entries at the repo root match the servers they publish", async () => {
    const product = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
    const docs = JSON.parse(readFileSync(new URL("../server.docs.json", import.meta.url), "utf8"));
    expect(product.name).toBe("dev.classifier/classifier");
    expect(docs.name).toBe("dev.classifier/docs");
    expect(product.remotes).toEqual([{ type: "streamable-http", url: `${ORIGIN}/mcp` }]);
    expect(docs.remotes).toEqual([{ type: "streamable-http", url: `${ORIGIN}/mcp/docs` }]);
    for (const entry of [product, docs]) {
      expect(entry.version).toBe(SERVER_VERSION);
      expect(entry.repository).toEqual({ url: "https://github.com/mrmps/classifier-dev", source: "github" });
      expect(entry.$schema).toMatch(/^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/);
    }
    const init = (await (await rpc("/mcp", "initialize", { protocolVersion: PROTOCOL_VERSIONS[0], capabilities: {}, clientInfo: { name: "t", version: "0" } })).json()) as { result: { serverInfo: { version: string } } };
    expect(init.result.serverInfo.version).toBe(product.version);
  });
});

describe("the skill index", () => {
  test("digests the skill.md it points at", async () => {
    const index = await getJson("/.well-known/agent-skills/index.json");
    expect(await getJson("/.well-known/skills/index.json")).toEqual(index);
    const [skill] = index.skills;
    expect(skill.type).toBe("skill-md");
    expect(skill.url).toBe(`${ORIGIN}/skill.md`);
    const md = await (await get("/skill.md")).arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", md))].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(skill.digest).toBe(`sha256:${digest}`);
  });
});

describe("the MCP preflight", () => {
  test("is the transport's own on the MCP paths and the site's elsewhere", async () => {
    for (const path of ["/mcp", "/mcp/docs", "/.well-known/mcp"]) {
      const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { method: "OPTIONS", headers: { origin: "https://example.com", "access-control-request-method": "POST" } }), env, ctx);
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-methods")).toContain("DELETE");
      expect(res.headers.get("access-control-allow-headers")).toContain("Last-Event-ID");
      expect(res.headers.get("access-control-expose-headers")).toContain("MCP-Protocol-Version");
    }
    const site = await worker.fetch(new Request(`${ORIGIN}/v1/classify`, { method: "OPTIONS" }), env, ctx);
    expect(site.status).toBe(204);
    expect(site.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
  });
});
