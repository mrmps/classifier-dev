/**
 * The discovery files agents look for before they read a page: what this
 * service is, where its API, MCP servers and skill live, and how (not) to
 * authenticate. Every document here is generated from the same constants the
 * rest of the worker uses, so they cannot drift from what is actually served.
 */

import { describeTool, PROTOCOL_VERSIONS, type McpServer } from "./mcp";
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
  tagline: "Zero-shot text classification over plain HTTP. Free without a key; Pro for 10x limits.",
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
  { path: "/skills", priority: 0.8, changefreq: "daily" },
  { path: "/pricing", priority: 0.7, changefreq: "monthly" },
  { path: "/about", priority: 0.5, changefreq: "monthly" },
  { path: "/contact", priority: 0.5, changefreq: "monthly" },
  { path: "/privacy", priority: 0.5, changefreq: "monthly" },
  { path: "/terms", priority: 0.5, changefreq: "monthly" },
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

/**
 * The Server Card extension (SEP-2127, modelcontextprotocol/ext-server-card)
 * requires exactly this `$schema` value: the schema is versioned by its `v1`
 * segment and the pattern in the extension's own JSON Schema admits no other
 * URL. It is not yet published at that address while the extension is in
 * draft; the value is still the one a conforming card must carry.
 */
export const SERVER_CARD_SCHEMA = "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
/** The media type the extension gives a card, and the one for the catalog that points at it. */
export const SERVER_CARD_TYPE = "application/mcp-server-card+json";
export const AI_CATALOG_TYPE = "application/ai-catalog+json";

/**
 * The extension's shape: identity (`name`, `version`, `description`, `title`,
 * `icons`, `repository`, `websiteUrl`) and `remotes`, each naming its transport,
 * URL and the protocol versions it speaks. Objects are open by design, so the
 * fields agents already read here (`instructions`, `tools`, `authentication`,
 * `documentation`) stay alongside. Served at `<streamable-http-url>/server-card`,
 * the location the extension reserves, and at the .well-known path this site
 * has always used.
 */
function cardCore(origin: string, endpoint: string, server: McpServer) {
  return {
    $schema: SERVER_CARD_SCHEMA,
    name: server.name,
    title: server.title,
    version: server.version,
    description: server.description,
    websiteUrl: `${origin}/mcp-setup`,
    repository: { url: SITE.repo, source: "github" },
    icons: [{ src: `${origin}/favicon.svg`, mimeType: "image/svg+xml" }],
    remotes: [{ type: "streamable-http", url: endpoint, supportedProtocolVersions: [...PROTOCOL_VERSIONS] }],
    // Kept for readers of the earlier shape of this card.
    icon: `${origin}/favicon.svg`,
    url: endpoint,
    serverUrl: endpoint,
    transport: "streamable-http",
    instructions: server.instructions,
    capabilities: { tools: true, resources: false, prompts: false },
    tools: server.tools.map(describeTool),
    documentation: `${origin}/mcp-setup`,
  };
}

/** /mcp/server-card and /.well-known/mcp/server-card.json — what an agent can know before connecting. */
export function serverCard(origin: string, product: McpServer, docs: McpServer) {
  return {
    ...cardCore(origin, `${origin}/mcp`, product),
    kind: "product",
    authentication: { type: "none", description: "Free classification needs no key. Optional Pro bearer keys give 10x rate limits per billing account; partner keys remain supported. RateLimit headers and 429s with Retry-After describe quotas." },
    openapi: `${origin}/openapi.json`,
    relatedServers: [
      {
        name: docs.name,
        kind: "docs",
        description: docs.description,
        url: `${origin}/mcp/docs`,
        serverUrl: `${origin}/mcp/docs`,
        card: `${origin}/mcp/docs/server-card`,
        transport: "streamable-http",
        authentication: { type: "none" },
        tools: docs.tools.map((t) => t.name),
      },
    ],
  };
}

export function docsServerCard(origin: string, docs: McpServer) {
  return {
    ...cardCore(origin, `${origin}/mcp/docs`, docs),
    kind: "docs",
    authentication: { type: "none" },
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

// ---------------------------------------------------------------- authentication

/**
 * RFC 9728 protected-resource metadata. Truthful: no authorization server,
 * no scopes, anonymous classification; optional workspace, legacy Pro and partner keys.
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
    resource_tos_uri: `${origin}/terms`,
    // Not part of RFC 9728; states in plain words what the empty lists mean.
    anonymous_access: true,
    note: "Classification and docs support anonymous access. Workspace bearer keys use the workspace credit balance. Existing legacy Pro keys retain 10x rate limits per billing account. Partner keys remain supported. Billing endpoints require a signed-in session.",
  };
}

export const AUTH_MD = `# Agent authentication on classifier.dev

Canonical: https://classifier.dev/auth.md · Last updated ${SITE_UPDATED}

Classification and documentation work without a key. Workspace API keys use
the workspace credit balance; current plans are at https://classifier.dev/pricing.
Existing legacy Pro keys keep their 10x public rate limits. Send API keys as
bearer credentials on REST or MCP. Billing uses a separate browser sign-in session.
This file follows the discovery path from https://github.com/workos/auth.md;
classifier.dev does not implement that spec's agent registration or token exchange.

## Discover

- REST: POST https://classifier.dev/v1/classify with inputs and labels.
- MCP: https://classifier.dev/mcp; docs: https://classifier.dev/mcp/docs.
- OpenAPI: https://classifier.dev/openapi.json.
- RFC 9728 metadata: https://classifier.dev/.well-known/oauth-protected-resource.
  No OAuth authorization server, scopes, ID-JAG exchange or agent identity assertion.

## Pick a method

- **anonymous** — free, per IP: fast 3,000/minute and 20,000/day;
  smart 200/minute and 2,000/day. No account or card.
- **service_auth (workspace key)** — classifier_agent_ keys charge the workspace
  credit balance. Create and manage keys in /app/keys.
- **service_auth (existing legacy Pro key)** — classifier_pro_ keys retain their
  legacy limits per billing account across IPs and keys:
  fast 30,000/minute and 200,000/day; smart 2,000/minute and 20,000/day.
  Up to 1,000 inputs per request on either tier.
- **service_auth (partner key)** — separately arranged limits;
  contact https://cal.com/michaelsf/coffee.

## Register and claim

Create a workspace at /auth/sign-up and create or rotate workspace keys at
/app/keys. Existing classifier_pro_ keys retain their legacy limits. There is
no agent registration or claim endpoint. Free classification requires no
registration.

## Use the key

    Authorization: Bearer classifier_agent_...

Use the same header on REST and MCP. For the CLI, use --api-key or set
CLASSIFY_API_KEY (CLASSIFIER_API_KEY also works). Keep keys out of URLs.
No token exchange or refresh is needed. Your browser billing session is not
an API credential. Existing classifier_pro_ and partner keys continue to work.

## Errors

- 401 — the key is invalid; create a replacement in your workspace.
- 403 — the subscription does not grant Pro access, including past-due,
  suspended or expired legacy access. Manage billing at https://classifier.dev/app/plans.
- 429 — quota reached; wait the Retry-After seconds. RateLimit headers describe
  the allowance. The code is rate_limit_minute or rate_limit_day.
- 400 — invalid classification parameters; the message says what to change.
- 502 — classification provider failure; retry with backoff.
- 503 — billing verification is unavailable; retry later.

Legacy Pro subscription access is cached for at most 60 seconds. Anonymous
classification remains available within public limits without a credential.

## Revocation and billing

Rotate workspace keys at /app/keys; rotating replaces the
old key. Existing legacy Pro keys remain valid while their subscription is
active. Log in with your billing email at /app/plans to manage the same
subscription. Partner keys are rotated through their issuing contact. There is no
OAuth revocation or token exchange endpoint.
`;
