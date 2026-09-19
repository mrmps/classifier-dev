/**
 * The pages that are not the API reference: who runs this, how to reach them,
 * what is logged, what it costs, where developers and agents start, and how to
 * plug the MCP server into Claude, ChatGPT, Codex and Cursor.
 *
 * Same convention as DOCS: plain text with UPPERCASE headings, rendered to HTML
 * for browsers and to Markdown for Accept: text/markdown, so `curl` sees the
 * canonical document and nothing can drift between the three.
 */

import { SITE, SITE_UPDATED } from "./wellknown";

export const MCP_SETUP = `classifier.dev MCP

Use classifier.dev as a tool inside Claude, ChatGPT, Codex, Cursor or any other
MCP client. Two servers, both Streamable HTTP, both keyless and stateless:

  https://classifier.dev/mcp         tools: classify_texts, classify_multi_label,
                                     count_labels, review_uncertain
  https://classifier.dev/mcp/docs    tools: list_docs, read_doc, search_docs

Server card: https://classifier.dev/.well-known/mcp/server-card.json
  Registry: listed in the official MCP registry as dev.classifier/classifier —
  https://registry.modelcontextprotocol.io/v0/servers?search=dev.classifier


CLAUDE APP AND CLAUDE DESKTOP

  Pro and Max: Customize > Connectors > "+" > Add custom connector. Paste
  https://classifier.dev/mcp as the remote MCP server URL, leave the OAuth
  fields empty, click Add. Then in any chat open the "+" menu > Connectors and
  switch classifier.dev on.

  Team and Enterprise: an Owner adds it first under Organization settings >
  Connectors > Add > Custom > Web, same URL; members then find it under
  Customize > Connectors and click Connect.

  The docs server works the same way with https://classifier.dev/mcp/docs.


CLAUDE CODE

    claude mcp add --transport http classifier https://classifier.dev/mcp
    claude mcp add --transport http classifier-docs https://classifier.dev/mcp/docs

  Or in .mcp.json at the root of a project, so the whole team gets it:

    {"mcpServers": {"classifier": {"type": "http", "url": "https://classifier.dev/mcp"}}}


CHATGPT

  Turn on developer mode: Settings > Security and login > Developer mode.
  Then Settings > Apps & Connectors (or the "+" in the composer) > Create,
  name it classifier, URL https://classifier.dev/mcp, authentication
  "No Authentication", and create. It appears under Drafts; toggle its tools
  on. In a chat pick Developer mode from the "+" menu and select the app.

  Every tool here carries readOnlyHint, so ChatGPT will not ask you to confirm
  each call. Deep research connectors need search and fetch tools; this is a
  tool server for chat and developer mode, not a deep-research source.


CODEX

    codex mcp add classifier --url https://classifier.dev/mcp

  Or in ~/.codex/config.toml:

    [mcp_servers.classifier]
    url = "https://classifier.dev/mcp"


CURSOR, VS CODE, WINDSURF, GOOSE, ANYTHING ELSE

  Any client that takes a remote MCP URL takes this one. The usual JSON:

    {"mcpServers": {"classifier": {"url": "https://classifier.dev/mcp"}}}

  Cursor: Settings > MCP > Add new global MCP server, or .cursor/mcp.json.
  VS Code: .vscode/mcp.json with {"servers": {"classifier": {"type": "http", "url": "https://classifier.dev/mcp"}}}.


TRY IT BY HAND

    curl https://classifier.dev/mcp -H 'content-type: application/json' \\
      -H 'accept: application/json, text/event-stream' \\
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

    curl https://classifier.dev/mcp -H 'content-type: application/json' \\
      -H 'accept: application/json, text/event-stream' \\
      -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"classify_texts",
           "arguments":{"inputs":["Win a free iPhone","Lunch at 1?"],"labels":["spam","not spam"]}}}'

  Or with the official inspector: npx @modelcontextprotocol/inspector --cli https://classifier.dev/mcp --method tools/list


WHAT THE TOOLS DO

  classify_texts        one label per text, with a calibrated confidence; up to 1,000 texts
  classify_multi_label  every label that applies per text, a score per label
  count_labels          just the histogram — how many texts landed on each label
  review_uncertain      only the texts the model was unsure about, with the runner-up label

  All four are read-only and idempotent (readOnlyHint, idempotentHint) and
  return both text and structuredContent. Errors from the API come back as a
  tool result with isError, so the model can read the message and try again;
  malformed arguments are JSON-RPC -32602 with the problem spelled out.


PROTOCOL NOTES

  Streamable HTTP per the 2025-11-25 specification, negotiating down to
  2025-03-26. Stateless: no Mcp-Session-Id, every POST stands alone, GET
  answers 405 because there is no server-initiated stream. Batched JSON-RPC
  arrays are accepted. Same per-IP limits as the REST API; a 429 carries
  Retry-After. Source: https://github.com/mrmps/classifier-dev/blob/main/src/mcp.ts
`;

export const DEVELOPERS = `classifier.dev developers

Everything a developer or an agent needs to go from reading this to a first
classification, with no account, key, or sign-up in between. The API is free
within per-IP limits; production is the sandbox.


QUICKSTART

    curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone
    spam

    curl https://classifier.dev -d '{"inputs":["the checkout button does nothing","love the dark mode"],"labels":["bug","praise","feature"]}'

  One request, up to 1,000 texts, back in about a second, each with a label,
  a calibrated confidence and a score per label. Full reference: https://classifier.dev
  (the same document as \`curl classifier.dev\`).


COMING SOON

  Two things are being built on the same call shape, and both are worth a
  conversation before they ship:

    Image classification   Labels in, one calibrated answer out, for images
                           instead of text.
    Private inference      Zero-knowledge, end-to-end encrypted classification:
                           the input is unreadable in transit and unreadable to
                           the service that classifies it.

  If either is on your roadmap, say so now and it gets built against your
  case.

    Book a call   ${SITE.author.cal}
    Email         ${SITE.email}


SURFACES

  REST API        POST https://classifier.dev  or  GET https://classifier.dev/{labels}/{text}
                  Query form: GET https://classifier.dev/?labels={a,b}&text={text}
                  Versioned alias: POST https://classifier.dev/v1/classify (same body, same answer)
  OpenAPI 3.1     https://classifier.dev/openapi.json
  MCP             https://classifier.dev/mcp (tools) and https://classifier.dev/mcp/docs (documentation)
                  Setup for Claude, ChatGPT, Codex, Cursor: https://classifier.dev/mcp-setup
  CLI             npm i -g classifier-dev  ->  classify bug,feature,praise < feedback.txt
  Python SDK      pip install classifier-dev  ->  from classifier_dev import classify   https://pypi.org/project/classifier-dev/
  Go SDK          go get github.com/mrmps/classifier-dev/sdk/go   https://pkg.go.dev/github.com/mrmps/classifier-dev/sdk/go
  JavaScript      fetch() is the SDK; see EXAMPLES. Source for both SDKs: https://github.com/mrmps/classifier-dev/tree/main/sdk
  Agent skill     npx skills add https://classifier.dev
  llms.txt        https://classifier.dev/llms.txt
  Discovery       /.well-known/ard.json, /.well-known/mcp/server-card.json,
                  /.well-known/agent-card.json, /.well-known/api-catalog, /sitemap.xml


ENDPOINTS

  Method  Path                      Purpose
  -------------------------------------------------------------------------
  POST    /v1/classify              Classify 1-1,000 texts. Body: {inputs, labels, tier?, instructions?, multi?, max_labels?}
  POST    /                         Alias of /v1/classify, tracks the current major
  POST    /v1/classify/batch        Alias, for callers that look for a batch endpoint by name
  GET     /{labels}/{text}          One text in the URL: /spam,not+spam/Win+a+free+iPhone -> "spam"
  GET     /?labels=&text=           The same as query parameters: /?labels=spam,not+spam&text=Win+a+free+iPhone
  GET     /v1/health                {ok, version, time}
  GET     /api                      Machine-readable index of everything here (also GET /?mode=agent)
  GET     /openapi.json             The OpenAPI 3.1 specification
  POST    /mcp                      MCP, Streamable HTTP (tools); POST /mcp/docs for the docs server

  Response for POST: {"tier", "model", "results": [{"label", "confidence", "scores"}...], "usage"}
  in input order. Multi-label results carry "labels" (every label >= 0.7) and
  independent "scores". Full field reference: https://classifier.dev (PARAMETERS).


AUTHENTICATION

  None. Do not send a key; there is nothing to send. Every endpoint above
  answers anonymous requests, which is also what /.well-known/oauth-protected-resource
  and https://classifier.dev/auth.md say. Partners hold a bearer key that only
  lifts the per-IP limits: Authorization: Bearer <key>.


EXAMPLES

  curl:

    curl https://classifier.dev/v1/classify -H 'content-type: application/json' \\
      -d '{"inputs":["the checkout button does nothing","love the dark mode"],"labels":["bug","praise","feature"]}'

  JavaScript (Node 18+, Bun, browsers — CORS is open):

    const res = await fetch("https://classifier.dev/v1/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs, labels: ["bug", "praise", "feature"] }),
    });
    const { results } = await res.json();   // results[i] = { label, confidence, scores }

  Python (pip install classifier-dev, standard library only):

    from classifier_dev import classify
    for r in classify(texts, ["bug", "praise", "feature"]):
        print(r.label, r.confidence)

  Go (go get github.com/mrmps/classifier-dev/sdk/go):

    results, err := classifier.Classify(ctx, texts, []string{"bug", "praise", "feature"})
    // results[i].Label, *results[i].Confidence

  Multi-label, capped at two tags per text:

    curl https://classifier.dev/v1/classify -d '{"inputs":["postgres index tuning for ML"],"labels":["databases","ml","frontend"],"multi":true,"max_labels":2}'


KEYS AND LIMITS

  No key is needed and none is issued for normal use. Limits are per IP and
  counted in classifications, not requests: 3,000 a minute and 20,000 a day on
  the fast tier, 200 a minute and 2,000 a day on smart. Every response carries
  RateLimit-Limit, RateLimit-Remaining and RateLimit-Policy; a 429 adds
  Retry-After. Need more? A partner key lifts the limits — https://cal.com/michaelsf/coffee.
  How authentication works (it does not): https://classifier.dev/auth.md


SANDBOX

  There is no separate test environment because there is nothing to protect:
  the API stores no inputs and has no per-account state, so calling production
  is the sandbox. Use the fast tier and a handful of inputs while you build;
  the examples on this page are safe to run as many times as you like.


ERRORS

  Every error is JSON with a message and a stable code:

    {"error": "Provide at least 2 labels", "code": "too_few_labels"}

  400 codes: no_input, too_many_inputs, too_few_labels, too_many_labels,
  empty_label, duplicate_labels, empty_input, input_too_long, bad_json.
  429: rate_limit_minute, rate_limit_day (with Retry-After).
  502: typesafe_<status>, openrouter_<status>, upstream — the model provider
  failed after retries; retry with backoff. There are no 401s.


VERSIONING

  The response shape is stable and additive: fields are added, never renamed
  or removed, within a major version. The current major is v1, addressed as
  POST /v1/classify; the bare POST / is an alias that always tracks the current
  major. Every response carries an x-api-version header. A breaking change
  would ship as /v2 alongside /v1, and /v1 would then carry Deprecation and
  Sunset headers for at least six months before removal. Classification is
  idempotent by nature; an Idempotency-Key header is accepted and echoed so
  retry logic that expects one keeps working.


SOURCE AND SUPPORT

  The whole service — worker, CLI, eval harness — is open source at
  https://github.com/mrmps/classifier-dev. Issues there; conversations at
  https://cal.com/michaelsf/coffee; the person behind it at https://x.com/michael_chomsky.
  Measured accuracy, calibration and cost: https://classifier.dev/benchmark
`;

export const PRICING = `classifier.dev pricing

Free. No API key, no account, no card. The whole API, both tiers, the MCP
servers, the CLI and the skill, within per-IP limits.


FREE TIER

  Price                    $0
  Fast tier                3,000 classifications a minute, 20,000 a day, per IP
  Smart tier               200 a minute, 2,000 a day, per IP
  Inputs per request       up to 1,000
  Labels per request       2 to 100
  Sign-up                  none
  Support                  GitHub issues, https://github.com/mrmps/classifier-dev/issues

  A classification is one text against one label set; 1,000 texts in one
  request are 1,000 classifications. Multi-label counts once per text, not per
  label.


PARTNER

  Price                    by arrangement
  Limits                   lifted, on a bearer key
  For                      teams past 20,000 classifications a day, or who need a contract
  How                      https://cal.com/michaelsf/coffee

  There is no self-serve paid tier yet because the free one is not metered per
  account. If you need more than a single IP's allowance, book a call; keys are
  issued the same day.


WHAT COUNTS

  Request                  Classifications
  -------------------------------------------------------------------------
  1 text, 2 labels                       1
  1 text, 100 labels                     1
  1,000 texts, 5 labels              1,000
  1,000 texts, multi-label, 30 labels 1,000   (multi-label counts per text)
  smart tier, 1,000 texts, 120 unsure  1,000 smart classifications; the 120
                                       re-asks are included, not extra

  Both tiers, the MCP servers (https://classifier.dev/mcp) and the CLI draw
  on the same per-IP allowance. Limits reset each minute and each day;
  every response carries RateLimit-Remaining and a 429 says how long to wait.


COMPARED WITH DOING IT YOURSELF

  Calling the underlying model directly costs about $0.005 per thousand
  classifications and needs a TypeSafe key; a general LLM prompted to
  classify costs $0.002 to $0.04 per thousand and 0.7 to 3.4 seconds per
  item, with no calibrated confidence. Numbers and method on
  https://classifier.dev/benchmark.


WHAT IT COSTS TO RUN

  The model behind the fast tier costs about $0.005 per thousand
  classifications; the smart tier adds about $0.70 per thousand escalated
  answers. Those are the numbers on https://classifier.dev/benchmark, from the
  providers' own usage accounting, so you can see what the free tier is worth.
`;

export const ABOUT = `About classifier.dev

classifier.dev is a zero-shot text classification service: you send texts and
a list of labels over plain HTTP, and get back the label that fits each text
and how sure the model is. There is no API key and no account, so the first
call works the moment you read the example.


WHY IT EXISTS

  Language models can classify anything they can see, but seeing is the
  expensive part. An agent with forty search results, a thousand log lines or a
  backlog of tickets has to pull all of it into context to judge it. This
  service classifies ten thousand things without reading them: one request, a
  second later, labels and confidences for all of them, and only the survivors
  get read.

  The confidence is calibrated, so an agent can act on the sure answers and
  hand the rest to a person or a stronger model. Without that split you would
  have to trust every answer equally.


WHAT IT RUNS ON

  The model is Jev, TypeSafe's decision model. It returns a calibrated
  probability per label instead of generating text. The smart tier re-asks the
  answers Jev was unsure about of a reasoning model. Both are measured on
  public test sets at https://classifier.dev/benchmark, including how the
  service compares with calling Jev directly.

  It runs as a single Cloudflare Worker with no runtime dependencies. The
  worker, the CLI, the eval harness and these pages are open source at
  https://github.com/mrmps/classifier-dev.


WHO

  Built and run by ${SITE.author.name} (https://x.com/${SITE.author.handle}), an
  independent developer in San Francisco. It started as a tool for agents that
  needed to filter search results before reading them, and got a public API
  once other people wanted the same thing.


CONTACT AND POLICIES

  https://classifier.dev/contact for how to reach a person,
  https://classifier.dev/privacy for what is and is not logged,
  https://classifier.dev/pricing for what it costs (nothing) and the limits.
`;

export const CONTACT = `Contact classifier.dev

A person answers all of these. Pick the one that fits.


BUGS AND FEATURE REQUESTS

  Open an issue at https://github.com/mrmps/classifier-dev/issues. The whole
  service is in that repository, so a report can point at the line.


HIGHER LIMITS, PARTNERSHIPS, ANYTHING COMMERCIAL

  Book a call: https://cal.com/michaelsf/coffee. Partner keys that lift the
  per-IP limits are issued the same day.


EVERYTHING ELSE

  Email ${SITE.email}, or find ${SITE.author.name} on X at
  https://x.com/${SITE.author.handle}. Replies within a day or two.


AGENTS

  Agents can leave structured feedback without a human: the feedback.now
  protocol is served at https://classifier.dev/.well-known/agent-feedback.json,
  and the MCP servers at https://classifier.dev/mcp and
  https://classifier.dev/mcp/docs are the programmatic front door.


SECURITY

  Found something sensitive? Email ${SITE.email} with "security" in the subject
  instead of opening a public issue. There is no bug bounty, but there is a
  quick fix and a thank-you in the changelog.
`;

export const PRIVACY = `classifier.dev privacy

The short version: the texts you classify are not stored, and there are no
accounts to attach anything to.


WHAT IS SENT WHERE

  The texts and labels you send are forwarded to the model provider that
  answers the request — TypeSafe for the decision model, and for the smart
  tier's re-asked items, the reasoning model's provider via OpenRouter. They
  are processed to produce the answer and are not written to disk by this
  service. Which provider handled a request is in the response (model,
  modelsUsed) so you always know.


WHAT IS LOGGED

  Per request, for rate limiting and operations: the label names, which tier
  ran, which model answered, the latency, the response status, a coarse
  request-country, a client family derived from the User-Agent (curl, python,
  browser, MCP, ...) and a hashed client IP for the per-IP limits. Not the
  input text. These records power the usage counts and the alerting that
  keeps the service up, and are kept for 90 days in Cloudflare Analytics
  Engine.


IF YOU ASK FOR UPDATES

  The form at the foot of the home page keeps two things: the address you
  typed and the date it arrived. They live in a separate database with no
  other table in it, and the row holds no IP, no user agent and no request id.
  There is nothing an address could be joined on, here or later. Your IP gates
  that form the way it gates the API, and is not stored beside the address.

  The address is used to send occasional news about this service and for
  nothing else. It is never sold, never shared, and never passed to an
  advertiser. Unsubscribing is a reply to any mail that arrives; ask at
  ${SITE.email} and the row is deleted, not flagged.


WHAT IS NOT COLLECTED

  No accounts, no cookies, no third-party analytics or tracking scripts on any
  page, no advertising. The home page loads no external resources apart from
  the fonts.


AGENTS AND THE MCP SERVERS

  The MCP servers are stateless: nothing about a session is remembered between
  calls. Tool inputs are handled exactly like API inputs above.


PARTNER KEYS

  If you hold a partner key, requests made with it are attributed to that key
  for the purpose of applying its limits, and to nothing else.


CHANGES AND CONTACT

  This page is updated when the practice changes, with the date below. Questions
  to ${SITE.email}. Last updated ${SITE_UPDATED}.
`;

// ---------------------------------------------------------------- markdown

const isHeading = (l: string) => /^[A-Z][A-Z0-9 ,/()'-]{2,}$/.test(l) && l.trim() === l;

/**
 * The plain-text convention, as Markdown: the title line becomes an H1,
 * UPPERCASE headings become H2s in sentence case, indented blocks with aligned
 * columns or commands become fenced code, and prose is left alone.
 */
export function toMarkdown(doc: string, meta: { title: string; canonical: string; description: string }): string {
  const lines = doc.replace(/\s+$/, "").split("\n");
  const out: string[] = [];
  const front = ["---", `title: ${meta.title}`, `description: ${meta.description}`, `canonical: ${meta.canonical}`, `last-updated: ${SITE_UPDATED}`, "---", ""];
  out.push(...front, `# ${lines[0].trim()}`, "");
  let i = 1;
  let block: string[] = [];
  const flush = () => {
    if (!block.length) return;
    const pre = block.some((l) => /\S {2,}\S/.test(l) || /^\s*(curl|npm|npx|classify|claude|codex|GET|POST|\{|\[|\/)/.test(l) || /^\s{4,}\S/.test(l));
    const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
    const body = block.map((l) => l.slice(indent));
    if (pre) out.push("```", ...body, "```", "");
    else out.push(body.map((l) => l.trim()).join(" "), "");
    block = [];
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (isHeading(line)) {
      flush();
      const title = (line.charAt(0) + line.slice(1).toLowerCase())
        .replace(/\b(cli|api|mcp|json|ndjson|url|http|rfc|vs|chatgpt|a2a|ard)\b/gi, (m) => (m.toLowerCase() === "chatgpt" ? "ChatGPT" : m.toUpperCase()))
        .replace(/\bClaude code\b/, "Claude Code");
      out.push(`## ${title}`, "");
      continue;
    }
    if (!line.trim()) flush();
    else block.push(line);
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
