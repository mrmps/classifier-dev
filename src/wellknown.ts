/**
 * The discovery files agents look for before they read a page: what this
 * service is, where its API, MCP servers and skill live, and how (not) to
 * authenticate. Every document here is generated from the same constants the
 * rest of the worker uses, so they cannot drift from what is actually served.
 */

import { describeTool, type McpServer } from "./mcp";
import { SKILL_DESCRIPTION, SKILL_NAME } from "./skill";

/**
 * Domain ownership for the official MCP registry (registry.modelcontextprotocol.io):
 * the registry fetches /.well-known/mcp-registry-auth and checks that the
 * publisher signed with the matching private key, which lives only in the
 * ignored .secrets.env as MCP_REGISTRY_KEY.
 */
export const MCP_REGISTRY_AUTH = "v=MCPv1; k=ed25519; p=aWvcKpRNSyAPr+bh7ba+HiiyYf4JnWz4ueIx1ej+pzc=";
export const MCP_REGISTRY_ENTRY = "https://registry.modelcontextprotocol.io/v0/servers?search=dev.classifier";

/** Bumped when any public page changes materially; feeds sitemap lastmod. */
export const SITE_UPDATED = "2026-09-19";

export const SITE = {
  name: "classifier.dev",
  tagline: "Zero-shot text classification over plain HTTP. No API key, no account.",
  author: { name: "Michael Ryaboy", handle: "michael_chomsky", x: "https://x.com/michael_chomsky", cal: "https://cal.com/michaelsf/coffee" },
  repo: "https://github.com/mrmps/classifier-dev",
  email: "contact@classifier.dev",
};

/** Every public page, for the sitemap and the trust anchors. */
export const PAGES: { path: string; priority: number; changefreq: string }[] = [
  { path: "/", priority: 1, changefreq: "weekly" },
  { path: "/benchmark", priority: 0.8, changefreq: "weekly" },
  { path: "/developers", priority: 0.9, changefreq: "weekly" },
  { path: "/mcp-setup", priority: 0.8, changefreq: "monthly" },
  { path: "/pricing", priority: 0.7, changefreq: "monthly" },
  { path: "/about", priority: 0.5, changefreq: "monthly" },
  { path: "/contact", priority: 0.5, changefreq: "monthly" },
  { path: "/privacy", priority: 0.5, changefreq: "monthly" },
  { path: "/auth.md", priority: 0.5, changefreq: "monthly" },
  { path: "/agents.md", priority: 0.7, changefreq: "monthly" },
  { path: "/llms.txt", priority: 0.6, changefreq: "weekly" },
  { path: "/skill.md", priority: 0.6, changefreq: "weekly" },
  { path: "/openapi.json", priority: 0.6, changefreq: "weekly" },
];

export function sitemapXml(origin: string) {
  const urls = PAGES.map(
    (p) => `  <url>\n    <loc>${origin}${p.path}</loc>\n    <lastmod>${SITE_UPDATED}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

/**
 * Everything is public and meant to be read by machines, so every crawler and
 * every user-triggered agent is welcome, by name so the intent is unambiguous.
 *
 * Nothing is listed as disallowed. A Disallow line is a public index of the
 * paths worth trying, and the one non-public page here is already noindex by
 * header and asks for a password either way.
 */
export function robotsTxt(origin: string) {
  const agents = [
    "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai",
    "Google-Extended", "Googlebot", "Bingbot", "PerplexityBot", "Perplexity-User", "Applebot-Extended", "DeepSeekBot",
    "meta-externalagent", "Amazonbot", "ora-agent",
  ];
  return [
    ...agents.flatMap((a) => [`User-agent: ${a}`, "Allow: /", ""]),
    "User-agent: *",
    "Content-Signal: search=yes, ai-input=yes, ai-train=yes",
    "Allow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    `Agentmap: ${origin}/.well-known/ard.json`,
    "",
  ].join("\n");
}

/**
 * RFC 9116. Researchers and scanners look here before they look at a contact
 * page, so the address the contact page gives for security has to be readable
 * from the one path the standard reserves for it.
 *
 * Expires is required by the RFC and must be in the future; six months from
 * the request keeps it valid without anyone remembering to edit a date.
 */
export function securityTxt(origin: string, now = new Date()) {
  const expires = new Date(now.getTime() + 183 * 24 * 60 * 60 * 1000);
  return [
    `Contact: mailto:${SITE.email}`,
    `Contact: ${origin}/contact`,
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    "Preferred-Languages: en",
    `Canonical: ${origin}/.well-known/security.txt`,
    "",
    "# There is no bug bounty. Reports are read by a person and answered,",
    "# and a fix ships the same way everything else here does.",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- MCP server card

/** /.well-known/mcp/server-card.json — what an agent can know before connecting. */
export function serverCard(origin: string, product: McpServer, docs: McpServer) {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/server-card/2025-11-25/schema.json",
    name: product.name,
    title: product.title,
    version: product.version,
    kind: "product",
    description: product.description,
    icon: `${origin}/favicon.svg`,
    url: `${origin}/mcp`,
    serverUrl: `${origin}/mcp`,
    transport: "streamable-http",
    authentication: { type: "none", description: "No key, no account. Limits are per IP and returned as RateLimit headers and 429s with Retry-After." },
    instructions: product.instructions,
    capabilities: { tools: true, resources: false, prompts: false },
    tools: product.tools.map(describeTool),
    documentation: `${origin}/mcp-setup`,
    openapi: `${origin}/openapi.json`,
    relatedServers: [
      {
        name: docs.name,
        kind: "docs",
        description: docs.description,
        url: `${origin}/mcp/docs`,
        serverUrl: `${origin}/mcp/docs`,
        transport: "streamable-http",
        authentication: { type: "none" },
        tools: docs.tools.map((t) => t.name),
      },
    ],
  };
}

export function docsServerCard(origin: string, docs: McpServer) {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/server-card/2025-11-25/schema.json",
    name: docs.name,
    title: docs.title,
    version: docs.version,
    kind: "docs",
    description: docs.description,
    icon: `${origin}/favicon.svg`,
    url: `${origin}/mcp/docs`,
    serverUrl: `${origin}/mcp/docs`,
    transport: "streamable-http",
    authentication: { type: "none" },
    instructions: docs.instructions,
    capabilities: { tools: true, resources: false, prompts: false },
    tools: docs.tools.map(describeTool),
    documentation: `${origin}/mcp-setup`,
  };
}

// ---------------------------------------------------------------- ARD catalog

/** /.well-known/ard.json and its legacy alias: one list of everything agentic here. */
export function ardCatalog(origin: string, product: McpServer, docs: McpServer) {
  const host = new URL(origin).host;
  const trust = { identity: `did:web:${host}`, identityType: "did" };
  const entry = (kind: string, name: string, displayName: string, type: string, url: string, description: string, extra: Record<string, unknown> = {}) => ({
    identifier: `urn:air:${host}:${kind}:${name}`,
    displayName,
    type,
    url,
    description,
    trustManifest: trust,
    ...extra,
  });
  return {
    specVersion: "1.0",
    host: { displayName: SITE.name, identifier: `did:web:${host}`, documentationUrl: `${origin}/developers` },
    entries: [
      entry("mcp", "classifier", `${SITE.name} MCP server`, "application/mcp-server-card+json", `${origin}/.well-known/mcp/server-card.json`,
        product.description, {
          tags: ["classification", "text", "zero-shot", "triage", "labels", "mcp"],
          capabilities: product.tools.map((t) => t.name),
          representativeQueries: [
            "sort these 500 support tickets into bug, billing, feature request",
            "which of these search results are about GPU pricing",
            "tag each abstract with every topic that applies",
            "how many of these reviews are negative",
          ],
        }),
      entry("mcp", "docs", `${SITE.name} docs MCP server`, "application/mcp-server-card+json", `${origin}/.well-known/mcp/docs-server-card.json`,
        docs.description, { tags: ["documentation", "mcp"], capabilities: docs.tools.map((t) => t.name) }),
      entry("api", "classify", `${SITE.name} API`, "application/vnd.oai.openapi+json;version=3.1", `${origin}/openapi.json`,
        "POST texts and labels, get labels and calibrated confidences back. Up to 1,000 per request, no key.", {
          tags: ["classification", "rest", "openapi"],
        }),
      entry("skill", SKILL_NAME, `${SITE.name} agent skill`, "application/ai-skill+md", `${origin}/skill.md`, SKILL_DESCRIPTION, {
        tags: ["skill", "classification"],
        representativeQueries: ["classify many things without reading them", "filter search results before opening them"],
      }),
      entry("agent", "classifier", `${SITE.name} agent card`, "application/a2a-agent-card+json", `${origin}/.well-known/agent-card.json`,
        "Discovery card for the classification service; the live interface is MCP.", { tags: ["a2a", "discovery"] }),
      entry("doc", "llms", "llms.txt", "text/plain", `${origin}/llms.txt`, "The short index agents read first.", { tags: ["llms.txt"] }),
    ],
  };
}

// ---------------------------------------------------------------- A2A card

/**
 * /.well-known/agent-card.json. classifier.dev speaks MCP, not the A2A
 * message protocol; the card is published so A2A-first discovery finds the
 * service and is told, in its own format, where the real interface is.
 */
export function agentCard(origin: string, product: McpServer) {
  return {
    protocolVersion: "0.3.0",
    name: SITE.name,
    description:
      `${SITE.tagline} Sort up to 1,000 texts into your own labels in one call with a calibrated confidence per answer. ` +
      "This service's live agent interface is MCP (Streamable HTTP) at the URL below; A2A message/send is not implemented.",
    url: `${origin}/mcp`,
    preferredTransport: "JSONRPC",
    additionalInterfaces: [{ url: `${origin}/mcp`, transport: "JSONRPC", protocol: "mcp" }, { url: `${origin}/`, transport: "HTTP+JSON", protocol: "rest" }],
    version: "1.0.0",
    provider: { organization: SITE.author.name, url: origin },
    documentationUrl: `${origin}/developers`,
    iconUrl: `${origin}/favicon.svg`,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    securitySchemes: {},
    security: [],
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: product.tools.map((t) => ({
      id: t.name,
      name: t.title,
      description: t.description,
      tags: ["classification"],
      inputModes: ["application/json"],
      outputModes: ["application/json", "text/plain"],
    })),
  };
}

// ---------------------------------------------------------------- RFC 9727 API catalog

export const API_CATALOG_TYPE = 'application/linkset+json;profile="https://www.rfc-editor.org/info/rfc9727"';

export function apiCatalog(origin: string) {
  return {
    linkset: [
      {
        anchor: `${origin}/`,
        "service-desc": [{ href: `${origin}/openapi.json`, type: "application/openapi+json" }],
        "service-doc": [
          { href: `${origin}/developers`, type: "text/html" },
          { href: `${origin}/llms.txt`, type: "text/plain" },
        ],
        item: [
          { href: `${origin}/openapi.json`, type: "application/openapi+json", title: "classifier.dev REST API (OpenAPI 3.1)" },
          { href: `${origin}/.well-known/mcp/server-card.json`, type: "application/json", title: "classifier.dev MCP server" },
          { href: `${origin}/.well-known/mcp/docs-server-card.json`, type: "application/json", title: "classifier.dev docs MCP server" },
        ],
        "service-meta": [
          { href: `${origin}/.well-known/mcp/server-card.json`, type: "application/json", title: "MCP server card" },
          { href: `${origin}/.well-known/ard.json`, type: "application/json", title: "ARD catalog" },
        ],
        status: [{ href: `${origin}/.well-known/agent-feedback.json`, type: "application/json" }],
      },
      {
        anchor: `${origin}/mcp`,
        "service-desc": [{ href: `${origin}/.well-known/mcp/server-card.json`, type: "application/json" }],
        "service-doc": [{ href: `${origin}/mcp-setup`, type: "text/plain" }],
      },
    ],
  };
}

// ---------------------------------------------------------------- auth (there is none)

/**
 * RFC 9728 protected-resource metadata. Truthful: no authorization server,
 * no scopes, anonymous access everywhere; a bearer key exists only to lift
 * rate limits for partners and is issued by hand.
 */
export function oauthProtectedResource(origin: string) {
  return {
    resource: origin,
    resource_name: SITE.name,
    authorization_servers: [],
    bearer_methods_supported: ["header"],
    scopes_supported: [],
    resource_documentation: `${origin}/auth.md`,
    resource_policy_uri: `${origin}/privacy`,
    // Not part of RFC 9728; states in plain words what the empty lists mean.
    anonymous_access: true,
    note: "Every endpoint is public. No token is required or issued. Authorization: Bearer <key> is accepted only to lift per-IP rate limits for partners.",
  };
}

export const AUTH_MD = `# Agent authentication on classifier.dev

Canonical: https://classifier.dev/auth.md · Last updated ${SITE_UPDATED}

There is none to do. Every endpoint on classifier.dev — the REST API, the MCP
servers, the docs — is public and keyless. This file lives at \`/auth.md\`, the
discovery path from the WorkOS auth.md spec (https://github.com/workos/auth.md),
so an agent that looks for it learns in one request that it can start calling.
classifier.dev does not implement that spec's registration machinery; the
sections below say what exists and what deliberately does not.

## Discover

- The API: \`POST https://classifier.dev\` with \`{"inputs": [...], "labels": [...]}\`, or
  \`GET https://classifier.dev/{labels}/{text}\` (or \`GET https://classifier.dev/?labels=a,b&text=...\`). OpenAPI at https://classifier.dev/openapi.json.
- MCP: https://classifier.dev/mcp (tools) and https://classifier.dev/mcp/docs (documentation),
  Streamable HTTP, no auth. Server card at https://classifier.dev/.well-known/mcp/server-card.json.
- Protected-resource metadata (RFC 9728) at https://classifier.dev/.well-known/oauth-protected-resource
  lists no \`authorization_servers\` and no \`scopes_supported\`, because nothing here is protected.
- There is no \`/.well-known/oauth-authorization-server\` and no \`agent_auth\` block: no endpoint
  on classifier.dev issues tokens.

## Pick a method

- **anonymous** — the only identity type in use. Every read and every classification, within the
  per-IP limits: 3,000 classifications a minute and 20,000 a day on the fast tier, 200 and 2,000
  on smart. Start here; it is the whole product.
- **service_auth (partner key)** — a bearer key that lifts the per-IP limits. Keys are issued by
  hand after a conversation (https://cal.com/michaelsf/coffee); there is no self-serve tier
  because the free one is not metered per account.
- There is no \`identity_assertion\` type and no ID-JAG exchange; nothing here needs to know who
  you are.

## Register

Not applicable. There is no \`identity_endpoint\` and no registration call; an anonymous agent is
already fully registered by having an IP address.

## Claim

Not applicable. There is no \`claim_endpoint\`; a partner key arrives ready to use.

## Exchange

Not applicable. No token exchange, no refresh: the partner key is the credential.

## Use the access_token

Only partners have one. Send it as a bearer credential on any API or MCP request:

    Authorization: Bearer <partner-key>

Keyless requests are valid everywhere. Never send a key you do not have; an unrecognised key
is treated as anonymous, not rejected.

## Errors

- \`429\` with \`Retry-After\` (seconds), \`RateLimit-*\` headers and a JSON body
  \`{"error": "...", "code": "rate_limit_minute" | "rate_limit_day"}\` — wait the stated time.
- \`400\` with \`{"error": "...", "code": "..."}\` — the request itself is wrong (fewer than two
  labels, more than 1,000 inputs, empty text); the message says which.
- \`502\` with \`{"error": "upstream: ...", "code": "typesafe_..."}\` — the model provider failed
  after retries; retry with backoff.
- There is no \`401\`: nothing is behind \`WWW-Authenticate\`.

## Revocation

Not applicable for anonymous access. A partner key is revoked or rotated on request through the
channel that issued it; there is no \`revocation_endpoint\` and no \`events_endpoint\`.
`;
