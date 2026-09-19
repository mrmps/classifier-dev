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
import { codeLang } from "./ui";

export const MCP_SETUP = `classifier.dev MCP

Use classifier.dev as a tool inside Claude, ChatGPT, Codex, Cursor or any other
MCP client. Two servers, both Streamable HTTP, both keyless and stateless:

  https://classifier.dev/mcp         tools: classify_texts, classify_dimensions, classify_multi_label,
                                     count_labels, review_uncertain
  https://classifier.dev/mcp/docs    tools: list_docs, read_doc, search_docs,
                                     get_examples

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
  OpenAPI 3.1     https://classifier.dev/openapi.json
  MCP             https://classifier.dev/mcp (tools) and https://classifier.dev/mcp/docs (documentation)
                  Setup for Claude, ChatGPT, Codex, Cursor: https://classifier.dev/mcp-setup
  CLI             npm i -g classifier-dev  ->  classify bug,feature,praise < feedback.txt
  Python SDK      Install the tagged source below; from classifier_dev import classify
                  https://github.com/mrmps/classifier-dev/tree/python-v0.1.0/sdk/python
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

  Classification works without a key within the free limits. Pro ($20/month)
  gives 10x those limits. Send Authorization: Bearer <key> on REST or MCP;
  Pro keys start with classifier_pro_. Sign in at https://classifier.dev/pro to subscribe and
  create a key. Partner keys remain supported. https://classifier.dev/auth.md


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
  Retry-After. Pro ($20/month) gives 10x the minute and daily allowances per
  billing account, across IPs: https://classifier.dev/pro. Both Pro tiers
  accept up to 1,000 inputs per request. Use --api-key with the CLI, or set
  CLASSIFY_API_KEY (CLASSIFIER_API_KEY also works). https://classifier.dev/auth.md


SANDBOX

  There is no separate test environment because there is nothing to protect:
  no stored inputs, no per-account state. Production is the sandbox. Build
  against the fast tier with a handful of inputs; every example on this page
  is safe to run again and again.


ERRORS

  Every POST error is JSON with a message and a stable code:

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
  chain did; batch_unavailable for more than twenty inputs while the decision
  model is down; upstream_other. Retry 502s with backoff. There are no 401s.
  The list a client can validate against: components.schemas.Error in
  https://classifier.dev/openapi.json


VERSIONING

  The response shape is stable and additive: fields are added, never renamed
  or removed, within a major version. The current major is v1, addressed
  as POST /v1/classify; the bare POST / is an alias that always tracks the
  current major. Every response carries an x-api-version header. A breaking
  change would ship as /v2 alongside /v1, and /v1 would then carry Deprecation
  and Sunset headers for at least six months before removal. Classification is
  idempotent by nature; an Idempotency-Key header is accepted and echoed so
  retry logic that expects one keeps working.


SOURCE AND SUPPORT

  The whole service — worker, CLI, eval harness — is open source at
  https://github.com/mrmps/classifier-dev. Issues there; conversations at
  https://cal.com/michaelsf/coffee; the person behind it at https://x.com/michael_chomsky.
  Measured accuracy, calibration and cost: https://classifier.dev/benchmark
`;

export const PRICING = `classifier.dev pricing

Start free with no API key, account or card. Pro is $20/month for 10x the
classification rate limits. Both plans include fast and smart classification,
the MCP servers and the CLI.


FREE TIER

  Price                    $0
  Fast tier                3,000 classifications a minute, 20,000 a day, per IP
  Smart tier               200 a minute, 2,000 a day, per IP
  Inputs per request       up to 1,000 fast; 200 smart
  Labels per request       2 to 100
  Sign-up                  none
  Support                  GitHub issues, https://github.com/mrmps/classifier-dev/issues

  A classification is one text against one label set; 1,000 texts in one
  request are 1,000 classifications. Multi-label counts once per text, not per
  label.


PRO

  Price                    $20/month
  Fast tier                30,000 classifications a minute, 200,000 a day
  Smart tier               2,000 a minute, 20,000 a day
  Inputs per request       up to 1,000 on either tier
  Allowance                per billing account, shared across keys and IPs
  Sign-up and billing      https://classifier.dev/pro

  Sign in with a one-time email link, then subscribe through Stripe checkout,
  managed by Autumn. Create an API key after subscribing and save it when
  shown; it is shown only once. You can rotate it from your account.
  Send Authorization: Bearer classifier_pro_... on REST or MCP requests.
  With the CLI, use --api-key or CLASSIFY_API_KEY (CLASSIFIER_API_KEY also works).
  Manage payment details and cancellation from your account.


PARTNER

  Price                    by arrangement
  Limits                   lifted, on a bearer key
  For                      teams beyond Pro limits, or who need a contract
  How                      email ${SITE.email} or book https://cal.com/michaelsf/coffee

  Contact us for limits beyond Pro or a separate agreement.


ON REQUEST

  The public service is one shared deployment. These are available by
  arrangement, for teams whose data or latency budget cannot go through it:

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
  on the same allowance: per IP on Free, per billing account on Pro.
  Limits reset each minute and each UTC day;
  every response carries RateLimit-Remaining and a 429 says how long to wait.


COMPARED WITH DOING IT YOURSELF

  The model behind the fast tier costs about $0.005 per thousand
  classifications and needs a TypeSafe key; the smart tier adds about $0.70
  per thousand escalated answers. A general LLM prompted to classify costs
  $0.002 to $0.04 per thousand and 0.7 to 3.4 seconds per item, with no
  calibrated confidence. Numbers and method, from the providers' own usage
  accounting: https://classifier.dev/benchmark.
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

The short version: the texts you classify are not stored, and there are no
accounts to attach anything to.


WHAT IS SENT WHERE

  The texts and labels you send are forwarded to the model provider that
  answers the request — TypeSafe for the decision model, and for the smart
  tier's re-asked items, the reasoning model's provider via OpenRouter. This
  service does not write them to disk. The response says which provider
  answered (model, modelsUsed).


WHAT IS LOGGED

  Per request, for rate limiting and operations: which tier ran, which model
  answered, the latency, the response status, a coarse request-country and a
  client family derived from the User-Agent (curl, python, browser, MCP, ...).
  Not the text and not the labels: a keyed fingerprint of the label set counts
  the distinct classifiers in use without recording anyone's wording. The
  caller is a keyed hash of the IP that changes daily, so a record cannot be
  read back to an address or followed across days. The address itself serves
  the per-IP limits while the request is in flight and is not written down.
  These records feed the usage counts and the alerting, and are kept for 90
  days in Cloudflare Analytics Engine.


IF YOU ASK FOR UPDATES

  The updates form keeps the address you typed, the date, the signup source
  and what you ticked, in a separate database with no other table in it. The
  row holds no IP, user agent or request id, so there is nothing an address
  could be joined on. Your IP gates the form as it gates the API and is not
  stored beside the address.

  The updates bar on the home page keeps one flag in your browser's local
  storage: that you closed it. It never leaves the browser.

  The address gets the updates and nothing else: never sold, shared or passed
  to an advertiser. Unsubscribe by replying to any mail, or ask at
  ${SITE.email} and the row is deleted, not flagged.


WHAT IS NOT COLLECTED

  Free classification needs no account. There are no analytics or tracking
  scripts, and no advertising. The pages load one file from elsewhere, the
  syntax highlighter from cdnjs.cloudflare.com; Content-Security-Policy
  restricts other sources. Anonymous use keeps only the flag above.
  Pro sign-in also sets an HttpOnly session cookie for billing endpoints only,
  which expires after 30 days or when you sign out.


AGENTS AND THE MCP SERVERS

  The MCP servers are stateless: nothing about a session is remembered between
  calls. Tool inputs are handled exactly like API inputs above.


PRO BILLING

  Your billing email and account are held in separate Cloudflare Durable
  Object storage and with Autumn and Stripe for subscriptions and payments.
  They are separate from the newsletter database. Billing identity is never
  included in classification analytics; the daily caller fingerprints above
  continue to apply. Payment details are entered in Stripe checkout.
  Only hashes of API keys are stored on our server. A key is shown once when
  created; rotating it replaces the old credential.
  Subscription access is checked with a cache of at most 60 seconds.


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
  skill and a skills directory, all at https://classifier.dev, with no account
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


PRO

  Pro is $20 a month, billed by Stripe through Autumn against the card you
  give at checkout, and renews monthly until you cancel from your account at
  https://classifier.dev/pro. Cancelling stops the next charge; the
  allowance stays until the paid month ends. The price and the Pro limits at
  https://classifier.dev/pricing can change with notice on that page before
  a renewal. Your API key is yours to keep secret; requests made with it
  count against your allowance whoever sends them, and you can rotate it
  from your account at any time.


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
