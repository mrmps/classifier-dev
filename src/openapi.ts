/** Served at /openapi.json and /.well-known/openapi.json */
export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "classifier.dev",
    version: "1.0.0",
    summary: "Zero-shot text classification with calibrated confidence. No API key, no account.",
    description:
      "Send text and a list of labels, receive the label that fits, a calibrated confidence " +
      "and a score per label. Up to 1,000 texts per request, ~1s. Tiers: fast (default) and " +
      "smart, which re-asks answers below 0.7 confidence of a fast reasoning model. " +
      "Limits are per IP and counted in classifications: 3,000/min and 20,000/day on fast, " +
      "200/min and 2,000/day on smart. Benchmarks: https://classifier.dev/benchmark\n\n" +
      "Authentication: none. Every endpoint is public; an optional bearer key lifts the per-IP limits for partners " +
      "(see https://classifier.dev/auth.md).\n\n" +
      "Versioning: the current major is v1, addressed as POST /v1/classify; POST / is an alias that tracks the current major. " +
      "Response shapes are additive within a major (fields are added, never renamed or removed). Every response carries an " +
      "x-api-version header. A breaking change ships as /v2 beside /v1, and /v1 then carries Deprecation and Sunset headers " +
      "(RFC 9745 / RFC 8594) for at least six months before removal.\n\n" +
      "Rate limits: RateLimit-Limit, RateLimit-Remaining and RateLimit-Policy (IETF draft-ietf-httpapi-ratelimit-headers) on every " +
      "response, Retry-After on 429s. Idempotency: classification has no side effects; an Idempotency-Key header is accepted and " +
      "echoed so generic retry logic keeps working.\n\n" +
      "Errors: every non-2xx body is {error, code} — see components.schemas.Error for the codes.\n\n" +
      "MCP: the same capability as tools at https://classifier.dev/mcp (Streamable HTTP, no auth), documented at " +
      "https://classifier.dev/mcp-setup. Batch: the inputs array is the batch operation — up to 1,000 texts per request; " +
      "POST /v1/classify/batch is an alias for callers that look for one.",
    contact: { name: "Michael Ryaboy", url: "https://cal.com/michaelsf/coffee", email: "miryaboy@gmail.com" },
    license: { name: "MIT", url: "https://github.com/mrmps/classifier-dev/blob/main/LICENSE" },
    termsOfService: "https://classifier.dev/privacy",
    "x-api-versioning": {
      scheme: "url-path",
      current: "v1",
      aliases: ["/", "/v1/classify", "/v1/classify/batch"],
      deprecationSignal: "Deprecation and Sunset response headers, at least 180 days notice",
      changelog: "https://github.com/mrmps/classifier-dev/commits/main",
    },
    "x-mcp": { url: "https://classifier.dev/mcp", docs: "https://classifier.dev/mcp/docs", card: "https://classifier.dev/.well-known/mcp/server-card.json" },
  },
  externalDocs: { description: "Developer guide", url: "https://classifier.dev/developers" },
  security: [{}, { partnerKey: [] }],
  tags: [
    { name: "classify", description: "Sort texts into labels, with a calibrated confidence." },
    { name: "docs", description: "Documentation served over HTTP." },
  ],
  servers: [{ url: "https://classifier.dev" }],
  paths: {
    "/v1/health": {
      get: {
        operationId: "getHealth",
        summary: "Liveness and version. No authentication.",
        description: "Returns {ok, service, version, time}. A cheap way to verify the API is reachable and open before sending work.",
        tags: ["docs"],
        responses: {
          "200": {
            description: "The service is up.",
            content: { "application/json": { schema: { type: "object", required: ["ok", "version"], properties: { ok: { type: "boolean" }, service: { type: "string" }, version: { type: "string" }, time: { type: "string", format: "date-time" }, docs: { type: "string" } } } } },
          },
          default: { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/api": {
      get: {
        operationId: "getAgentIndex",
        summary: "Machine-readable index: every endpoint, limit and document, as JSON.",
        description: "The same information as the home page, shaped for agents: API URLs and body shape, MCP servers, CLI, skill, limits, pricing and discovery files. Also served for GET /?mode=agent.",
        tags: ["docs"],
        responses: {
          "200": { description: "The index.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          default: { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/v1/classify": {
      post: {
        operationId: "classifyV1",
        summary: "Classify texts (v1). Identical to POST /.",
        description: "The versioned address of the classification endpoint. Same request body, same response, same limits as POST /.",
        tags: ["classify"],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyRequest" } } },
        },
        responses: {
          "200": {
            description: "One result per input, in order.",
            headers: {
              "RateLimit-Limit": { schema: { type: "string" }, description: "Classifications allowed per minute for this tier." },
              "RateLimit-Remaining": { schema: { type: "string" }, description: "Left in the current minute." },
              "RateLimit-Policy": { schema: { type: "string" }, description: "The policy, e.g. 3000;w=60, 20000;w=86400." },
              "x-api-version": { schema: { type: "string" }, description: "The API major that answered, e.g. v1." },
              "Idempotency-Key": { schema: { type: "string" }, description: "Echoed when sent." },
            },
            content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyResponse" } } },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "502": { $ref: "#/components/responses/Upstream" },
          default: { $ref: "#/components/responses/Error" },
        },
      },
    },
    "/v1/classify/batch": {
      post: {
        operationId: "classifyBatchV1",
        summary: "Classify up to 1,000 texts in one request (alias of POST /v1/classify).",
        description: "The batch operation is the normal operation: `inputs` takes up to 1,000 texts and the results come back in the same order. This path exists for callers that look for a batch endpoint by name; it behaves exactly like POST /v1/classify.",
        tags: ["classify"],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyRequest" } } },
        },
        responses: {
          default: { $ref: "#/components/responses/Error" },
          "200": {
            description: "One result per input, in order.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyResponse" } } },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "502": { $ref: "#/components/responses/Upstream" },
        },
      },
    },
    "/": {
      get: {
        operationId: "getDocs",
        summary: "Human- and agent-readable documentation as plain text.",
        responses: {
          default: { $ref: "#/components/responses/Error" },
          "200": { description: "Documentation", content: { "text/plain": { schema: { type: "string" } } } },
        },
      },
      post: {
        operationId: "classify",
        summary: "Classify one or many texts into one of the supplied labels.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ClassifyRequest" },
              examples: {
                single: {
                  summary: "One input",
                  value: {
                    input: "the checkout button does nothing",
                    labels: ["bug", "feature", "praise"],
                  },
                },
                batch: {
                  summary: "Up to 1,000 inputs, smart tier",
                  value: {
                    inputs: ["refund never came", "love this app"],
                    labels: ["billing", "praise"],
                    tier: "smart",
                  },
                },
              },
            },
          },
        },
        responses: {
          default: { $ref: "#/components/responses/Error" },
          "200": {
            description: "Classification results",
            headers: {
              "X-RateLimit-Limit": { schema: { type: "string" }, description: "e.g. 3000/min" },
              "X-RateLimit-Remaining": { schema: { type: "string" } },
            },
            content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyResponse" } } },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "502": { $ref: "#/components/responses/Upstream" },
        },
      },
    },
    "/{labels}/{text}": {
      get: {
        operationId: "classifyByPath",
        summary: "Classify a single text. Returns the bare label as plain text.",
        description:
          "The quickest possible call: labels comma-separated in the first path segment, " +
          "the text in the rest. Spaces may be written as + or %20. " +
          "Add ?verbose=1 for JSON including calibrated confidence and per-label scores.",
        parameters: [
          {
            name: "labels",
            in: "path",
            required: true,
            description: "Comma-separated categories, 2 to 100.",
            schema: { type: "string" },
            example: "spam,not+spam",
          },
          {
            name: "text",
            in: "path",
            required: true,
            description: "The text to classify, up to 32,000 characters.",
            schema: { type: "string" },
            example: "Win+a+free+iPhone+now",
          },
          {
            name: "tier",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["fast", "smart"], default: "fast" },
          },
          {
            name: "instructions",
            in: "query",
            required: false,
            description: "Extra criteria, e.g. judge the reviewer's overall verdict.",
            schema: { type: "string" },
          },
          {
            name: "verbose",
            in: "query",
            required: false,
            description: "Set to 1 to receive JSON instead of a bare label.",
            schema: { type: "string", enum: ["1"] },
          },
          {
            name: "multi",
            in: "query",
            required: false,
            description: "Set to 1 to return every category that applies, one per line.",
            schema: { type: "string", enum: ["1"] },
          },
          {
            name: "max_labels",
            in: "query",
            required: false,
            description: "Cap on how many labels a multi-label answer returns.",
            schema: { type: "integer" },
          },
        ],
        responses: {
          default: { $ref: "#/components/responses/Error" },
          "200": {
            description: "The chosen label, or JSON when verbose=1",
            content: {
              "text/plain": { schema: { type: "string", example: "spam" } },
              "application/json": { schema: { $ref: "#/components/schemas/SingleResult" } },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "502": { $ref: "#/components/responses/Upstream" },
        },
      },
    },
    "/benchmark": {
      get: {
        operationId: "getBenchmark",
        summary: "Measured accuracy, cost and latency for every model considered.",
        responses: {
          default: { $ref: "#/components/responses/Error" },
          "200": { description: "Benchmark", content: { "text/plain": { schema: { type: "string" } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      ClassifyRequest: {
        type: "object",
        required: ["labels"],
        properties: {
          input: { type: "string", description: "A single text. Provide this or inputs." },
          inputs: {
            type: "array",
            items: { type: "string" },
            maxItems: 1000,
            description: "Up to 1,000 texts classified in one call, results in the same order.",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 100,
            description: "Semantic category names. 'urgent bug' classifies better than 'p0'.",
          },
          tier: {
            type: "string",
            enum: ["fast", "smart"],
            default: "fast",
            description:
              "smart re-asks single-label answers below 0.7 confidence of a reasoning model; multi-label ignores it.",
          },
          instructions: { type: "string", description: "Extra criteria for the classifier." },
          multi: { type: "boolean", description: "Return every label that applies, with a score per label." },
          max_labels: { type: "integer", description: "Cap on how many multi-label answers come back." },
        },
      },
      SingleResult: {
        type: "object",
        properties: {
          label: { type: "string" },
          confidence: {
            type: ["number", "null"],
            description:
              "0 to 1, calibrated: how likely the chosen label is right among your labels. Measured on six-way emotion, answers >= 0.9 were right 82% of the time and answers < 0.5 were right 29%. It is not a fit score \u2014 text matching none of your categories still gets one; add a label such as 'none of these' for that. Null only when withheld; see unscored.",
          },
          scores: {
            type: ["object", "null"],
            additionalProperties: { type: "number" },
            description: "Probability per label. Sums to 1 for single-label; independent per label for multi-label.",
          },
          escalated: {
            type: "boolean",
            description: "Present and true on the smart tier when the answer was re-asked of the reasoning model; confidence and scores remain the decision model's.",
          },
          unscored: {
            type: "string",
            description:
              "Present only when confidence and scores were withheld because the input does not read as natural language. Treat the label as unreliable.",
          },
          ms: { type: "integer" },
          tier: { type: "string" },
          model: { type: "string" },
        },
      },
      ClassifyResponse: {
        type: "object",
        properties: {
          tier: { type: "string" },
          model: {
            type: "string",
            description: "The model used for every result, or `mixed` when the batch used more than one model.",
          },
          modelsUsed: {
            type: "array",
            items: { type: "string" },
            description: "Every model that served at least one result, in first-use order.",
          },
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                confidence: { type: ["number", "null"] },
                scores: { type: ["object", "null"], additionalProperties: { type: "number" } },
                unscored: { type: "string" },
                escalated: { type: "boolean" },
                labels: {
                  type: "array",
                  items: { type: "string" },
                  description: "Multi-label mode only, in place of `label`: every label scoring >= 0.7, most likely first.",
                },
                ms: { type: "integer" },
                model: { type: "string" },
              },
            },
          },
          usage: {
            type: "object",
            properties: {
              classifications: { type: "integer" },
              escalated: { type: "integer", description: "How many answers the smart tier re-asked." },
              ms: { type: "integer" },
            },
          },
        },
      },
      Error: {
        type: "object",
        required: ["error", "code"],
        properties: {
          error: { type: "string", description: "Human-readable message saying what to change." },
          code: {
            type: "string",
            description: "Stable machine-readable code.",
            enum: [
              "bad_json", "no_input", "too_many_inputs", "too_few_labels", "too_many_labels", "empty_label",
              "duplicate_labels", "empty_input", "input_too_long", "rate_limit_minute", "rate_limit_day",
              "upstream", "typesafe", "openrouter", "not_found",
            ],
          },
        },
      },
    },
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: false,
        schema: { type: "string", maxLength: 255 },
        description: "Optional. Classification has no side effects, so any retry is already safe; the key is accepted and echoed back unchanged so generic retry logic keeps working.",
      },
    },
    securitySchemes: {
      partnerKey: {
        type: "http",
        scheme: "bearer",
        description: "Optional. Lifts the per-IP limits for partners; issued by arrangement (https://classifier.dev/auth.md). Every operation works without it.",
      },
    },
    responses: {
      BadRequest: {
        description: "Malformed request, e.g. fewer than 2 labels or an oversized input.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      RateLimited: {
        description: "Per-IP limit reached.",
        headers: { "Retry-After": { schema: { type: "integer" }, description: "Seconds" } },
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Upstream: {
        description: "The model provider failed after retries.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "No such path. The body points at the docs, llms.txt, the spec and the sitemap.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Error: {
        description: "Any other error: the same {error, code} object.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
} as const;

export const LLMS_TXT = `# classifier.dev

> Zero-shot text classification over plain HTTP, with no API key and no account.
> Send text and a list of labels, get back the label that fits and a calibrated
> confidence. Up to 1,000 texts per request, back in about a second.

Quickest possible call:

    curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone+now
    spam

JSON, many at once:

    curl https://classifier.dev -d '{"inputs":["...","..."],"labels":["a","b"]}'
    {"results":[{"label":"a","confidence":0.97,"scores":{"a":0.97,"b":0.03}}, ...]}

## When an agent should call this

You can already classify text you can see. Call this when reading the input is
the expensive part: filtering search results before opening them, pre-filtering
before expensive reasoning, bucketing logs or tickets nobody reads line by line,
or routing a pipeline branch deterministically. The thread joining those is
classifying many things without pulling them into context. Under about five
items, just decide yourself.

## Confidence

The confidence is calibrated: on six-way emotion, answers at >= 0.9 were right
82% of the time and answers below 0.5 were right 29%. Act on the sure ones and
look at the rest yourself, or pass tier "smart" and answers under 0.7 are
re-asked of a reasoning model for you. It is not a fit score: add a label such
as "none of these" when none-of-the-above is a real outcome.

## MCP

Two Streamable HTTP servers, no auth: https://classifier.dev/mcp (tools:
classify_texts, classify_multi_label, count_labels, review_uncertain) and
https://classifier.dev/mcp/docs (list_docs, read_doc, search_docs). Setup for
Claude, ChatGPT, Codex and Cursor: [mcp-setup](https://classifier.dev/mcp-setup).
Server card: [server-card.json](https://classifier.dev/.well-known/mcp/server-card.json).

## CLI

    npm i -g classifier-dev
    classify bug,feature,praise < feedback.txt        # label, confidence, text per line
    classify a,b --review 0.7 < items.txt              # only the unsure ones

## Install as an agent skill

    npx skills add https://classifier.dev

Served from this domain via RFC 8615 discovery, no repository involved:
[/.well-known/agent-skills/index.json](https://classifier.dev/.well-known/agent-skills/index.json)
and [/skill.md](https://classifier.dev/skill.md), which is readable as-is.

## Multi-label

Pass "multi": true to get every category that applies, up to 100 labels, each
with a score. Labels scoring >= 0.7 are returned, most likely first;
"max_labels" caps the count. F1 0.887 on a seven-task set, ~200ms.

    curl https://classifier.dev -d '{"input":"...","labels":[...50 tags...],"multi":true,"max_labels":10}'

## Docs

- [For agents](https://classifier.dev/agents.md): when to use this, when not to, how to call it
- [Skill](https://classifier.dev/skill.md): when to reach for this, batching, confidence, pitfalls
- [Developers](https://classifier.dev/developers): every surface, limits, errors, versioning
- [MCP setup](https://classifier.dev/mcp-setup): Claude, ChatGPT, Codex, Cursor
- [Pricing](https://classifier.dev/pricing): free; limits; partner keys
- [Authentication](https://classifier.dev/auth.md): there is none
- [Privacy](https://classifier.dev/privacy), [About](https://classifier.dev/about), [Contact](https://classifier.dev/contact)
- [Documentation](https://classifier.dev): full parameter list, tiers, limits
- [OpenAPI specification](https://classifier.dev/openapi.json): machine-readable, OpenAPI 3.1
- [Benchmark](https://classifier.dev/benchmark): measured accuracy, calibration, cost and latency

## Found a problem?

This host speaks the agent-feedback protocol. Read
[/.well-known/agent-feedback.json](https://classifier.dev/.well-known/agent-feedback.json)
for the accepted categories and limits, then POST a report to
\`/api/v1/feedback\` or a lighter signal to \`/api/v1/observations\`. No key
needed, and the receipt you get back can be polled at \`/api/v1/receipts/{id}\`.

## Limits

Per IP, counted in classifications: 3,000/minute and 20,000/day on the fast
tier, 200/minute and 2,000/day on the smart tier. Inputs cap at 32,000
characters, 1,000 per request. Exceeding a limit returns 429 with Retry-After.

## Contact

- [Book a call](https://cal.com/michaelsf/coffee) for higher limits or a tuned classifier
`;
