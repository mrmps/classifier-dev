/**
 * The pages that are not the API reference: who runs this, how to reach them,
 * what is logged, what it costs, where developers and agents start, and how to
 * plug the MCP server into Claude, ChatGPT, Codex and Cursor.
 *
 * Same convention as DOCS: plain text with UPPERCASE headings, rendered to HTML
 * for browsers and to Markdown for Accept: text/markdown, so `curl` sees the
 * canonical document and nothing can drift between the three.
 */

import { SPENDING_LIMITS } from "./docs";
import { SITE, SITE_UPDATED } from "./wellknown";
import { codeLang } from "./ui";
import { BILLING_PLANS, formatCreditsUsd } from "./lib/billing";
import { INPUT_PRICE_PER_MILLION, ESCALATION_PRICE_PER_THOUSAND, LONG_CONTEXT_PRICING } from "./lib/classification-pricing";
import { LONG_CONTEXT_JOB_MAX_TOKENS } from "./long-context";

export const MCP_SETUP = `classifier.dev MCP

Use classifier.dev as a tool inside Claude, ChatGPT, Codex, Cursor or any other
MCP client. Two stateless Streamable HTTP servers are available for public,
keyless use:

  https://classifier.dev/mcp         tools: classify_texts, classify_dimensions, classify_multi_label,
                                     count_labels, review_uncertain
  https://classifier.dev/mcp/docs    tools: list_docs, read_doc, search_docs,
                                     get_examples

  To attribute classification requests to your workspace, use a workspace API
  key in the Authorization: Bearer header on /mcp. The Default key and named
  keys work with both the API and MCP. Manage them at /app/keys; client-specific
  setup is at /app/agents. The keyless examples below use public limits and do
  not appear in your workspace's activity or usage.

  For workspace setup in Claude Code:

    claude mcp add --transport http classifier https://classifier.dev/mcp --header "Authorization: Bearer YOUR_API_KEY"

  For Codex, set CLASSIFIER_API_KEY securely in the environment, then run:

    codex mcp add classifier --url https://classifier.dev/mcp --bearer-token-env-var CLASSIFIER_API_KEY

  For Cursor, set CLASSIFIER_API_KEY in the environment inherited by Cursor:

    {"mcpServers": {"classifier": {"url": "https://classifier.dev/mcp", "headers": {"Authorization": "Bearer \${env:CLASSIFIER_API_KEY}"}}}}

  Hosted OAuth connections to your workspace are not available yet. The
  ChatGPT and Claude app instructions below connect to the public service.

Server card: https://classifier.dev/.well-known/mcp/server-card.json
  (also at https://classifier.dev/mcp/server-card; the docs server's at
  https://classifier.dev/mcp/docs/server-card)
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

  Or as a plugin, which adds both servers and the bulk-classify skill at once:

    claude plugin marketplace add mrmps/classifier-dev
    claude plugin install classifier@classifier-dev


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

  Or as a plugin, with the skill included:

    codex plugin marketplace add https://github.com/mrmps/classifier-dev
    codex plugin add classifier

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
      -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}'

    curl https://classifier.dev/mcp -H 'content-type: application/json' \\
      -H 'accept: application/json, text/event-stream' \\
      -d '{
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": {
          "name": "classify_texts",
          "arguments": {
            "inputs": ["Win a free iPhone", "Lunch at 1?"],
            "labels": ["spam", "not spam"]
          }
        }
      }'

  Or with the official inspector: npx @modelcontextprotocol/inspector --cli https://classifier.dev/mcp --method tools/list


WHAT THE TOOLS DO

  classify_texts        one label per text, with a calibrated confidence; up to 1,000 texts
  classify_dimensions   one decision per named dimension, with per-field confidence
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

From reading this to a first classification, with no account, key or sign-up
in between. The API is free within per-IP limits; production is the sandbox.


QUICKSTART

    curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone
    spam

    curl https://classifier.dev -d '{
      "inputs": ["the checkout button does nothing", "love the dark mode"],
      "labels": ["bug", "praise", "feature"]
    }'

  One request, up to 1,000 texts, back in about a second, each with a label,
  a calibrated confidence and a score per label. Full reference: https://classifier.dev
  (the same document as \`curl classifier.dev\`).

  Existing TypeSafe code can use the same official SDK and call shape. Change
  the API root and use a classifier.dev workspace key, or "unused" for the
  anonymous free tier. Caller credentials are never sent to TypeSafe:

    import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

    const client = new TypeSafeClient({
      apiKey: process.env.CLASSIFIER_API_KEY ?? "unused",
      baseURL: "https://classifier.dev",
    });
    const result = await client.systemOne({
      state: "I was charged twice. Please fix this today.",
      questions: {
        category: choice("Which team?", { billing: null, technical: null }),
      },
    });


COMING SOON

  Two things are being built on the same call shape:

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
  TypeSafe SDK    Base URL https://classifier.dev; POST /v1/systemone and GET /v1/models
                  JavaScript: @typesafe-ai/sdk   Python: typesafe-sdk
  OpenAPI 3.1     https://classifier.dev/openapi.json
  MCP             https://classifier.dev/mcp (tools) and https://classifier.dev/mcp/docs (documentation)
                  Setup for Claude, ChatGPT, Codex, Cursor: https://classifier.dev/mcp-setup
  CLI             npm i -g classifier-dev  ->  classify bug,feature,praise < feedback.txt
  Python SDK      Install the tagged source below; from classifier_dev import classify
                  https://github.com/mrmps/classifier-dev/tree/python-v0.1.0/sdk/python
  Go SDK          go get github.com/mrmps/classifier-dev/sdk/go   https://pkg.go.dev/github.com/mrmps/classifier-dev/sdk/go
  JavaScript      fetch() is the SDK; see EXAMPLES. Source for both SDKs: https://github.com/mrmps/classifier-dev/tree/main/sdk
  Agent skill     npx skills add https://classifier.dev
  Agent feedback  https://classifier.dev/.well-known/agent-feedback.json
  llms.txt        https://classifier.dev/llms.txt
  Discovery       /.well-known/ard.json, /.well-known/mcp/server-card.json,
                  /.well-known/agent-card.json, /.well-known/api-catalog, /sitemap.xml


ENDPOINTS

  Method  Path                      Purpose
  -------------------------------------------------------------------------
  POST    /v1/classify              Classify 1-1,000 texts. Body: {inputs, labels, tier?, instructions?, multi?, max_labels?}
  POST    /                         Alias of /v1/classify, tracks the current major
  POST    /v1/classify/batch        Alias, for callers that look for a batch endpoint by name
  POST    /v1/systemone             TypeSafe System One wire-compatible endpoint
  GET     /v1/models                TypeSafe model aliases in the official SDK response shape
  GET     /{labels}/{text}          One text in the URL: /spam,not+spam/Win+a+free+iPhone -> "spam"
  GET     /?labels=&text=           The same as query parameters: /?labels=spam,not+spam&text=Win+a+free+iPhone
  GET     /v1/health                {ok, version, time}
  GET     /api                      Machine-readable index of everything here (also GET /?mode=agent)
  GET     /openapi.json             The OpenAPI 3.1 specification
  POST    /mcp                      MCP, Streamable HTTP (tools); POST /mcp/docs for the docs server
  POST    /api/v1/feedback          Structured report with optional evidence; returns a receipt
  POST    /api/v1/observations      Lightweight category + summary signal; returns a receipt
  GET     /api/v1/receipts/{id}     Poll whether an agent report landed
  GET     /api/v1/policy            Feedback categories, evidence types and limits

  Single-label response for POST: {"tier", "model", "results": [{"label", "confidence", "scores"}...], "usage"}

  Results preserve input order. Confidence and scores may be null; check for
  null before numeric comparisons. Multi-label results instead have labels
  (an array), independent scores and model, with no singular label or confidence.
  Labels scoring at least 0.7 are returned. Repeated inference can vary; it is
  not an exact deterministic computation. Full field reference:
  https://classifier.dev (PARAMETERS).


LONG CONTEXT

  Default Jev and explicit model: "jev" automatically process inputs over
  32,000 characters through chunking, parallel Jev evidence screening and a
  final Jev call. POST with a workspace key backed by paid balance or an active
  paid subscription; anonymous access and free signup credit do not qualify.
  Fast only. Synchronous limits: 250,000 original cl100k_base context tokens summed across
  inputs, 20 documents, 32 decisions and a 1 MB request body.
  Decisions count documents × dimensions, or documents × labels in multi-label
  mode. Existing dedicated enterprise/operator access remains supported.
  Each continuous whitespace or non-whitespace run is limited to 8,192 UTF-16
  code units; longer runs return 400 long_context_input before tokenization
  or chunking.

  Relevant and uncertain chunks, including opposing evidence and exceptions,
  are eligible for the final call. Whole chunks are packed in source order
  within 20,000 cl100k_base tokens and a conservative provider estimate.
  Eligible evidence may be omitted when full; usage.long_context reports
  selection counts, token usage, calls and timing. No eligible evidence returns
  422 long_context_no_evidence without charge, also when no eligible chunk
  fits for a document. See LONG DOCUMENTS at
  https://classifier.dev for the full field reference and limitations.
  Explicit model: "chunklaya" remains a separate legacy opt-in.

  A funded workspace can upload one whole document of up to
  ${LONG_CONTEXT_JOB_MAX_TOKENS.toLocaleString("en-US")} tokens (100 MB) in one POST /v1/classify request.
  Send JSON with input and labels,
  or text/plain with labels in the query. Large documents return 202 and a
  status_url. For the same flow with smaller inputs, send the header
  Prefer: respond-async.
  Splitting, screening and final judgment happen automatically.
  The original whole-document token count sets the hold and final charge at
  $0.084/M. Failures, cancellation and 24-hour expiry refund unfinished work.
  See TEN-MILLION-TOKEN JOBS in the full docs.

  The repository CLI uploads and waits:

    node cli/classify.js a,b --document document.txt --json


AUTHENTICATION

  Classification works without a key within the public limits. Create a
  workspace at https://classifier.dev/auth/sign-up and manage workspace keys at
  https://classifier.dev/app/keys. Workspace keys use the classifier_agent_ prefix.
  Send Authorization: Bearer <key> on REST or MCP.
  Partner keys remain supported. https://classifier.dev/auth.md

  The official TypeSafe SDK requires a non-empty apiKey when it constructs a
  client. Use "unused" for anonymous free access; classifier.dev ignores that
  value and applies the per-IP public limits. To attach requests to a workspace,
  pass a classifier_agent_ key from /app/keys as the SDK apiKey. The key is
  validated by classifier.dev, uses the workspace quota and credit balance, and
  makes billing headers available on the SDK response. Never put a real TypeSafe
  credential here: caller credentials are not forwarded to TypeSafe.


${SPENDING_LIMITS}

EXAMPLES

  curl:

    curl https://classifier.dev/v1/classify -H 'content-type: application/json' \\
      -d '{
        "inputs": ["the checkout button does nothing", "love the dark mode"],
        "labels": ["bug", "praise", "feature"]
      }'

  JavaScript (Node 18+, Bun, browsers — CORS is open):

    const res = await fetch("https://classifier.dev/v1/classify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs, labels: ["bug", "praise", "feature"] }),
    });
    const { results } = await res.json();   // results[i] = { label, confidence, scores }

  Python SDK (standard library only; requires Git to install):

    pip install "classifier-dev @ git+https://github.com/mrmps/classifier-dev.git@python-v0.1.0#subdirectory=sdk/python"

  Python:

    from classifier_dev import classify
    for r in classify(texts, ["bug", "praise", "feature"]):
        print(r.label, r.confidence)

  Go (go get github.com/mrmps/classifier-dev/sdk/go):

    results, err := classifier.Classify(ctx, texts, []string{"bug", "praise", "feature"})
    // results[i].Label, *results[i].Confidence

  Multi-label, capped at two tags per text:

    curl https://classifier.dev/v1/classify -d '{
      "inputs": ["postgres index tuning for ML"],
      "labels": ["databases", "ml", "frontend"],
      "multi": true, "max_labels": 2
    }'


KEYS AND LIMITS

  No key is needed for free use. Free limits are per IP and
  counted in classifications, not requests: 3,000 a minute and 20,000 a day on
  the fast tier, 200 a minute and 2,000 a day on smart. Every classification
  response carries RateLimit-Limit and RateLimit-Policy, and RateLimit-Remaining
  once the limiter has been consulted (every 200 and 429); a 429 adds
  Retry-After. Workspace keys are metered against the workspace credit balance;
  current plans are at https://classifier.dev/pricing. Pro workspaces have
  10x minute and daily allowances shared across keys and agents, and accept up to
  1,000 inputs per request on both tiers. Use --api-key with the CLI, or set
  CLASSIFY_API_KEY (CLASSIFIER_API_KEY also works). https://classifier.dev/auth.md

  POST /v1/systemone counts named questions rather than HTTP requests. A
  placeholder uses the public fast-tier quota per IP. A classifier_agent_ key
  uses the workspace's shared quota and credit balance; returned TypeSafe token
  usage determines the charge, and Pro gets the same 10x allowance as the REST
  and MCP APIs. GET /v1/models does not spend quota or credits. TypeSafe-native
  validation, rate-limit and service errors retain their status and body;
  x-typesafe-request-id, Retry-After and Retry-After-Ms are preserved. Workspace
  responses also expose x-request-id and x-billing-status (pending, settled, refunded or
  review). Successful workspace responses include x-billed-input-tokens,
  x-smart-escalations and x-usage-cost-usd. The price is $${INPUT_PRICE_PER_MILLION.toFixed(3)} per million
  base input tokens plus $${(ESCALATION_PRICE_PER_THOUSAND / 1000).toFixed(3)} per successful Smart escalation.


SANDBOX

  The sandbox endpoint, POST /v1/sandbox/classify, runs real inference with
  the same authentication, quotas and billing as POST /v1/classify. Workspace
  keys spend workspace credits. Request content is not stored; usage and
  billing metadata are. Start with a handful of inputs. This is not a
  simulated billing environment.


ERRORS

  POST errors are JSON. Classification errors include a stable code:

    {"error": "Provide at least 2 labels; got 1 (\"spam\").", "code": "too_few_labels"}

  The GET forms answer plain text (error:, usage:, try: lines, the last a URL
  that would have worked) unless ?verbose=1 or Accept: application/json asks
  for the JSON object. A 429 on the free limits names the plan that lifts
  them and carries its URL as upgrade, so an agent that runs out of room can
  hand its person the link rather than a wait.

  400 codes: no_input, too_many_inputs, too_few_labels, too_many_labels,
  empty_label, duplicate_labels, empty_input, input_too_long, bad_tier,
  bad_json. 404: not_found. 429: rate_limit_minute, rate_limit_day (with
  Retry-After). 502: typesafe or typesafe_<status> when the decision model
  failed; openrouter_<status>, chain_exhausted or timeout when the fallback
  chain did; upstream_other. A 402 request_spending_limit means the batch
  needs fewer or shorter inputs, or a funded workspace key. Retry 502s with backoff.
  401: invalid_api_key for unsupported credentials. 403: inactive_api_key for
  paused or revoked workspace keys; proxy_requires_payment when a free caller
  uses anonymous proxy infrastructure. 402: insufficient_balance or
  request_spending_limit. Follow action and retryable in spending errors;
  retrying an unchanged over-budget request will not make it fit.
  Long context: 400 long_context_input or long_context_too_large;
  402 long_context_payment_required; 422 long_context_no_evidence (no charge);
  503 long_context_unavailable. Smart long-context requests return 400 bad_tier.
  The list a client can validate against: components.schemas.Error in
  https://classifier.dev/openapi.json


VERSIONING

  The response shape is stable and additive: fields are added, never renamed
  or removed, within a major version. The current major is v1, addressed
  as POST /v1/classify; the bare POST / is an alias that always tracks the
  current major. Every response carries an x-api-version header. A breaking
  change would ship as /v2 alongside /v1, and /v1 would then carry Deprecation
  and Sunset headers for at least six months before removal. Classification is
  side-effect-free, but inference has a cost. Send Idempotency-Key to prevent
  duplicate work: a repeated admitted key returns 409 duplicate_request, not
  a cached result. Keep the original response or request ID; changing the key
  starts a new billable operation.


SOURCE AND SUPPORT

  The whole service — worker, CLI, eval harness — is open source at
  https://github.com/mrmps/classifier-dev. Issues there; conversations at
  https://cal.com/michaelsf/coffee; the person behind it at https://x.com/michael_chomsky.
  Measured accuracy, calibration and cost: https://classifier.dev/benchmark
`;

export const PRICING = `classifier.dev pricing

Try classifier.dev without an API key, account or card. Create a workspace when
you want usage credits, named API keys, shared billing and usage by connection.
Every plan includes fast and smart classification, REST, MCP and the CLI.


FREE

  Price                    $0
  Public access            no account; 3,000 fast/minute and 20,000/day per IP
  Workspace credit         ${formatCreditsUsd(BILLING_PLANS.free.includedCredits)} once at personal signup
  Workspace seats          ${BILLING_PLANS.free.seatLimit}
  Get started              https://classifier.dev/auth/sign-up

  A classification is one text against one label set; 1,000 texts in one
  request are 1,000 classifications. Multi-label counts once per text, not per
  label.

  Free provider spending is capped at $0.01 per request, $0.50 per IP network
  per UTC day and $100 across everyone per UTC day. Up to four free requests
  may run at once per IP; IPv6 addresses share a /64 allowance. Smart requests
  must fit the same allowance. Large inputs or batches need a funded key.
  Free access pauses when the shared pool or verification capacity is spent;
  anonymous proxy networks require a funded key. Signup credit uses these
  same free limits. Synchronous request bodies are limited to 1 MB;
  funded whole-document uploads allow 10M tokens and 100 MB.


PRO

  Price                    $${BILLING_PLANS.pro.priceCents / 100}/month
  Included usage           ${formatCreditsUsd(BILLING_PLANS.pro.includedCredits)} each month
  Workspace seats          ${BILLING_PLANS.pro.seatLimit}
  Rate limits              10x Free, shared across workspace keys and agents
  Billing                  https://classifier.dev/app/plans

  Usage is charged to the workspace balance at the published input-token and escalation prices.
  Smart costs the same as Fast when no escalation is needed. A paid request
  admitted with a positive available balance can finish and leave a negative
  balance. New requests stop at zero or below until funds are added. There are
  no automatic top-ups.

  Funded workspaces skip the shared free pool and proxy checks. Each request
  has a default $10 provider-cost ceiling. Its maximum customer charge is held
  atomically before inference, so concurrent keys cannot repeatedly overdraw.
  Unused reservations are released after inference; missing input-token
  measurements remain held for billing review. If further Smart reviews cannot
  fit the provider ceiling, completed classifications are returned with
  escalation_failed; only successful reviews are billed.


ENTERPRISE

  Price                    by arrangement
  For                      more capacity, private infrastructure or a contract
  How                      email ${SITE.email} or book https://cal.com/michaelsf/coffee

  Dedicated deployment     the service in your own cloud account: AWS, GCP
                           or another
  Private inference        end-to-end encrypted, so the texts are readable
                           only inside your deployment
  Higher accuracy          a model tuned to your labels and your data
  Lower latency            served closer to your traffic, on capacity that
                           is yours

  Ask by email, ${SITE.email}, or book a call at
  https://cal.com/michaelsf/coffee. Say which of the four you need and
  roughly how many classifications a day; the answer comes back with a
  price, and the accuracy or latency you are buying is measured on your
  own data before you commit.


USAGE PRICES

  Input tokens           $${INPUT_PRICE_PER_MILLION.toFixed(3)} per million
  Smart escalations      +$${ESCALATION_PRICE_PER_THOUSAND.toFixed(2)} per 1,000

  Smart starts with Fast and reviews uncertain answers. You pay extra only
  for successful Smart escalations. No escalation means no extra charge.
  1 million input tokens with 50 Smart escalations cost $0.142.

  Output tokens are free. Input usage includes text, labels and instructions
  processed by the base classifier. Retries, fallback routing and Smart model
  tokens add no separate charges. Paid requests already admitted can finish and
  leave a negative balance. New requests require a positive available balance.

  Jev long context costs $${(LONG_CONTEXT_PRICING.inputNanodollars / 1000).toFixed(3)} per million original context tokens, counted
  with cl100k_base once per input across the request: 2 × Jev's $${INPUT_PRICE_PER_MILLION.toFixed(3)} rate.
  Dimensions do not multiply this price; actual screening and final-call
  usage do not change it. A request with 250,000 original context tokens costs
  $${(250000 * LONG_CONTEXT_PRICING.inputNanodollars / 1e9).toFixed(3)}. No eligible evidence returns 422 long_context_no_evidence, no charge.
  Requires paid balance or an active paid subscription; free signup credit
  and anonymous access do not qualify. Fast only, up to 20 documents and 32
  decisions, within the synchronous 250,000-token and 1 MB limits. For one
  whole document, POST /v1/classify accepts up to 10M tokens and 100 MB in one
  upload and returns 202 with a status_url. No client splitting is needed.
  The exact document price is reserved after upload; 10M tokens costs $0.84.
  Failed or canceled jobs are refunded. Final Jev uses
  selected evidence; eligible chunks can be omitted when its budget fills.


INCLUDED ON EVERY PLAN

  Fast and Smart classification with your own labels through REST, MCP or the CLI.
  Public requests use the public limits when no workspace key is sent;
  workspace keys charge the workspace balance. Every response reports its
  applicable rate limit and a 429 says how long to wait.


RATE LIMITS

  Free Fast     3,000/minute; 20,000/day
  Free Smart    200/minute; 2,000/day
  Pro Fast      30,000/minute; 200,000/day
  Pro Smart     2,000/minute; 20,000/day

  Limits count classifications and are shared across workspace keys and
  agents. Public access is limited per IP. Anonymous traffic also shares a
  5,000/minute and 50,000/day allowance with every caller using the same label
  set, so rotating addresses does not create a new budget. Workspace and
  enterprise keys do not use that anonymous label-set allowance. Laya trial
  limits apply to every plan.
`;

export const ABOUT = `About classifier.dev

classifier.dev is a zero-shot text classification service: you send texts and
a list of labels over plain HTTP, and get back the label that fits each text
and how sure the model is. Free use needs no API key or account, so the first
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
  https://classifier.dev/terms for what you agree to by using it,
  https://classifier.dev/pricing for what it costs (nothing) and the limits.
`;

export const CONTACT = `Contact classifier.dev

A person answers all of these. Pick the one that fits.


BUGS AND FEATURE REQUESTS

  Open an issue at https://github.com/mrmps/classifier-dev/issues. The whole
  service is in that repository, so a report can point at the line.


HIGHER LIMITS, PARTNERSHIPS, ANYTHING COMMERCIAL

  Email ${SITE.email} or book a call: https://cal.com/michaelsf/coffee.
  Partner keys that lift the per-IP limits are issued the same day.

  On request, by arrangement: a dedicated deployment in your own cloud
  (AWS, GCP or another), private end-to-end encrypted inference, and higher
  accuracy or lower latency than the public service gives, measured on your
  own data first. Details on https://classifier.dev/pricing.


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

The short version: public, keyless classification does not store your texts.
Successful classifier label names are retained for 90 days as one aggregate
record per label set, without caller identity or source text. Signed-in
workspaces store account details, API keys and usage records so you can manage
access and billing. Optional workspace request-content logging is described
below and is disabled by default.


WHAT IS SENT WHERE

  The texts and labels you send are forwarded to the model provider that
  answers the request — TypeSafe for the decision model, directly or through
  Vercel AI Gateway, and for the smart tier's re-asked items, the reasoning
  model's provider via OpenRouter. Public requests are not stored with their
  content. Workspace content logging, when enabled, is described below. The
  response identifies the model used (model, modelsUsed).


PUBLIC SERVICE LOGS

  Per request, for rate limiting and operations: which tier ran, which model
  answered, the latency, the response status, a coarse request-country and a
  client family derived from the User-Agent (curl, python, browser, MCP, ...).
  Not the text: a keyed fingerprint of the label set counts distinct
  classifiers in per-request analytics. Separately, successful simple and
  multi-label classifier names are retained in an aggregate registry for 90
  days so operators can understand use and enforce one anonymous allowance per
  label set. That registry has no caller fingerprint, request ID or source text.
  Its shared label-set fingerprint can associate label names with pseudonymous
  usage records. Label names may themselves contain information you supply.
  Dimension definitions remain fingerprint-only. TypeSafe choice requests with
  one distinct label set use the same registry. The caller is a keyed hash of
  the IP that changes daily, so a record cannot be
  read back to an address or followed across days. The address itself serves
  the per-IP limits while the request is in flight and is not written down.
  To prevent abuse of free inference, the caller IP is sent to Spur's
  Context API on a cache miss. We store only a daily keyed network
  fingerprint and an allow/deny result, never the raw address. IPv6 /64
  networks share a spending allowance. Funded workspace requests skip Spur.
  Free spending reservations and reputation entries are removed after their
  retention window (up to three UTC days); monthly lookup counts contain
  no caller identity.
  These records feed the usage counts and the alerting, and are kept for 90
  days in Cloudflare Analytics Engine.


WORKSPACES, API KEYS AND ACTIVITY

  WorkOS handles hosted sign-in. Our workspace database, hosted by Neon,
  stores your account ID, email, display name, memberships, invitations,
  workspace settings, key names, usage and billing records. Workspace members
  can see the workspace's keys and activity according to their permissions.
  Account and newsletter data use separate tables in the same database.

  Workspace API keys are stored as a hash for authentication and as an
  encrypted secret so owners and admins can reveal or copy them later.
  Rotating a key invalidates its previous secret. Revoking a key blocks new
  requests, while retaining its name and usage history.

  Requests authenticated with workspace keys are associated with that
  workspace and key. Usage records include request IDs, timestamps, API or MCP
  source, item and token counts when available, model, status, latency and
  cost. The billing ledger is stored in Neon. Workspace analytics are stored
  separately in Cloudflare Analytics Engine for 90 days; they are not the
  anonymous, daily-fingerprinted records described above.

  Optional workspace request-content logging can additionally retain inputs,
  labels, classification instructions and results in the workspace analytics
  dataset. It is disabled by default and requires deployment configuration
  to enable. When enabled, workspace members with activity access can view
  the stored content. Recognized credential fields and token patterns are
  redacted, and content is size-limited; redaction cannot detect every kind
  of sensitive text. Public, keyless requests are not included in this dataset.

  Whole-document jobs temporarily keep uploaded source text in private job
  storage while queued. Source fragments are deleted as they are screened;
  selected evidence is deleted on completion. Cancellation, failure and
  expiry (24 hours after creation) delete remaining source and evidence.
  The result remains until that expiry;
  aggregate usage records follow normal workspace retention rules.

  Ask ${SITE.email} about access to or deletion of your account data.


IF YOU ASK FOR UPDATES

  The updates form keeps the address you typed, the date, the signup source
  and what you ticked, in the subscriber table of our application database.
  Newsletter consent is independent of your account. The subscriber row holds
  no IP, user agent, request id or workspace ID. Your IP gates the form as it
  gates the API and is not stored beside the address.

  The updates bar on the home page keeps one flag in your browser's local
  storage: that you closed it. It never leaves the browser.

  The address gets the updates and nothing else: never sold, shared or passed
  to an advertiser. Unsubscribe by replying to any mail, or ask at
  ${SITE.email} and the row is deleted, not flagged.


COOKIES AND BROWSER STORAGE

  Public classification needs no account. There are no advertising trackers.
  The public pages load a syntax highlighter from
  cdnjs.cloudflare.com; Content-Security-Policy restricts other sources.
  Signed-in dashboard access uses an HttpOnly session cookie managed by
  WorkOS AuthKit and a cookie for your selected workspace. Signing out clears
  dashboard session access and the selected workspace.
  Theme and sidebar preferences are saved in your browser's local storage.


AGENTS AND THE MCP SERVERS

  The MCP transport is stateless. Authenticated MCP calls use the same
  workspace credentials, usage records and optional content logging as API
  calls. Keyless MCP calls use the public service described above.


PRO BILLING

  Autumn and Stripe handle subscriptions and payments. Workspace billing
  state and credit adjustments are stored in Neon. Newsletter consent is
  stored independently in the subscriber table. Payment details are entered in
  Stripe checkout. Billing identity is not added to the anonymous public
  service logs; authenticated workspace usage is linked to the workspace
  for billing and reporting as described above.


PARTNER KEYS

  If you hold a partner key, requests made with it are attributed to that key
  for the purpose of applying its limits, and to nothing else.


CHANGES AND CONTACT

  This page is updated when the practice changes, with the date below. Questions
  to ${SITE.email}. Last updated ${SITE_UPDATED}.
`;

export const TERMS = `classifier.dev terms

The short version: the service is free within the published limits, it is
offered as it is, you are responsible for what you send and for what you do
with the answers, and it can change or stop. Pro is a monthly subscription
you can cancel at any time; there is no other contract unless you hold a
partner key with one.


WHAT YOU GET

  A zero-shot text classification API over HTTP, two MCP servers, a CLI, a
  skill, all at https://classifier.dev, with no account
  and no key, within the per-IP limits at https://classifier.dev/pricing. The
  limits, the models and the endpoints can change; the API reference and the
  changelog say when they do, and a versioned path stays as documented while
  it is served.


WHAT YOU AGREE TO

  Use it for lawful purposes and within the limits. Do not try to get around
  the per-IP limits, probe or disrupt the service, or send content you have no
  right to send. Do not use it to classify people in ways the law forbids, to
  make consequential decisions about a person with no human review, or to
  build anything that harms someone. A response is a probability from a model,
  not advice: check anything that matters.

  You keep every right to the texts and labels you send. The service uses them
  only to answer the request and, as https://classifier.dev/privacy explains,
  forwards them to the model provider that answers and does not store them.
  The answers are yours to keep and to use however you like.


SKILLS YOU SUBMIT

  A skill submitted to https://classifier.dev/skills is being published. By
  submitting it you say it is yours to publish and grant everyone a licence to
  read, copy and use it as a document; the directory lists it, unlisted skills
  are not kept. A listed skill can be taken down on request to the address
  below and by the service when it should not have been listed.


NO WARRANTY, NO LIABILITY

  The service is provided as is and as available, without warranty of any
  kind. Accuracy is measured and published at https://classifier.dev/benchmark
  and is not promised. To the extent the law allows, the service and the
  person who runs it are not liable for any loss arising from its use or from
  its unavailability; where liability cannot be excluded, it is limited to
  what you paid for the service, which for the free tier is nothing.


SUBSCRIPTIONS

  Paid plans are billed by Stripe through Autumn against the card you give at
  checkout and renew monthly until you cancel from your workspace at
  https://classifier.dev/app/plans. Cancelling stops the next charge; included
  usage stays available through the paid month. Prices can change with notice on
  https://classifier.dev/pricing before a renewal. Your API keys are yours to
  keep secret; requests made with one count against its workspace
  allowance whoever sends them.


PARTNER KEYS

  A partner key is issued under its own written terms, which take precedence
  over this page for requests made with it. A key can be revoked for use that
  breaks these terms.


CHANGES, TERMINATION AND CONTACT

  These terms can change; the date below moves when they do, and continued
  use after a change is acceptance of it. Access can be limited or ended for
  use that breaks these terms, and the service itself may be discontinued
  with notice on https://classifier.dev. The code is open source under the
  MIT licence at https://github.com/mrmps/classifier-dev, so the service
  ending does not take the software with it.

  These terms are governed by the law of California, United States. Questions
  to ${SITE.email}. Last updated ${SITE_UPDATED}.
`;

// ---------------------------------------------------------------- the plain-text convention
//
// One reading of the convention, shared by the HTML renderer in home.ts and
// the Markdown one below. Each used to carry its own copy of these rules and
// the copies drifted: the HTML page said "vs code" where the Markdown said "VS
// code", and a block the Markdown fenced could have re-flowed as prose in HTML.

/** A section heading: an UPPERCASE line, flush left. */
export const isHeading = (l: string) => /^[A-Z][A-Z0-9 ,/()'-]{2,}$/.test(l) && l.trim() === l;

/** The heading in sentence case, keeping the acronyms and product names the docs use. */
export function headingTitle(line: string): string {
  return (line.charAt(0) + line.slice(1).toLowerCase())
    .replace(/\b(cli|api|mcp|json|ndjson|url|http|rfc|vs|chatgpt|a2a|ard)\b/gi, (m) => (m.toLowerCase() === "chatgpt" ? "ChatGPT" : m.toUpperCase()))
    .replace(/\bClaude code\b/, "Claude Code")
    .replace(/\bVS code\b/, "VS Code");
}

/**
 * A block keeps its own spacing when it is a command, a table, or anything
 * else whose columns carry meaning: fenced in Markdown, <pre> in HTML. Prose
 * is re-flowed to the reader's width instead of the terminal's 80.
 */
export const isPreBlock = (lines: string[]) =>
  lines.some((l) => /\S {2,}\S/.test(l) || /^\s*(curl|npm|npx|classify|claude|codex|GET|POST|\{|\[|\/)(?!:)/.test(l) || /^\s{4,}\S/.test(l));

/** A block that starts with something you would paste into a shell. A line that is only a command's name and a colon ("curl:") is a caption, not a command. */
export const isCommandBlock = (lines: string[]) => lines.some((l) => /^\s*(curl|npm|npx|pip|go|claude|codex|classify)\b(?!:)/.test(l));

// ---------------------------------------------------------------- markdown

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
    const pre = isPreBlock(block);
    const indent = Math.min(...block.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
    const body = block.map((l) => l.slice(indent));
    if (pre) out.push("```" + (codeLang(body) ?? ""), ...body, "```", "");
    else out.push(body.map((l) => l.trim()).join(" "), "");
    block = [];
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (isHeading(line)) {
      flush();
      out.push(`## ${headingTitle(line)}`, "");
      continue;
    }
    if (!line.trim()) flush();
    else block.push(line);
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
