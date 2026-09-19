import { CATEGORIES, SEVERITIES, REPRODUCIBILITY, EVIDENCE_TYPES, SURFACE_KINDS, LIMITS } from "./feedback";

/**
 * Every code the worker puts in an error body. index.ts types its `fail()`
 * against this list, so a code cannot be served without being documented here.
 * The two parameterised families, typesafe_<status> and openrouter_<status>,
 * carry the upstream HTTP status and are described by the pattern below.
 */
export const ERROR_CODES = [
  // 400
  "bad_json", "no_input", "too_many_inputs", "too_few_labels", "too_many_labels", "empty_label",
  "duplicate_labels", "empty_input", "input_too_long", "bad_tier", "bad_cursor", "invalid_submission",
  // 404
  "not_found",
  // 429
  "rate_limit_minute", "rate_limit_day",
  // 502: the model provider failed after retries
  "typesafe", "chain_exhausted", "batch_unavailable", "timeout", "upstream_other",
  // 500
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number] | `typesafe_${number}` | `openrouter_${number}`;
export const UPSTREAM_CODE_PATTERN = "^(typesafe|openrouter)_[0-9]{3}$";

const ERROR_SCHEMA = { $ref: "#/components/schemas/Error" };
/** Every non-2xx answer is the same {error, code} object; spelled out inline on each operation. */
const err = (description: string, headers?: Record<string, unknown>, plain = false) => ({
  description,
  ...(headers ? { headers } : {}),
  content: {
    "application/json": { schema: ERROR_SCHEMA },
    // The GET forms answer a bare label, so their errors are bare too:
    // `error:` and, on a 400, `usage:` and `try:` lines. ?verbose=1 or
    // Accept: application/json makes them the JSON object instead.
    ...(plain ? { "text/plain": { schema: { type: "string", example: "error: Provide at least 2 labels; got 1 (\"spam\"). Separate labels with commas.\nusage: GET /{labels}/{text}  or  GET /?labels={a,b}&text={text}\ntry:   https://classifier.dev/spam,not+spam/Win+a+free+iPhone\n" } } } : {}),
  },
});
const RATE_LIMIT_HEADERS = {
  "RateLimit-Limit": { schema: { type: "string" }, description: "Classifications allowed per minute for this tier." },
  "RateLimit-Remaining": { schema: { type: "string" }, description: "Left in the current minute. Present once the limiter has been consulted: on every 200 and 429, not on a 400 that never reached it." },
  "RateLimit-Policy": { schema: { type: "string" }, description: "The policy, e.g. 3000;w=60, 20000;w=86400." },
  "x-api-version": { schema: { type: "string" }, description: "The API major that answered, e.g. v1." },
  "Idempotency-Key": { schema: { type: "string" }, description: "Echoed when sent." },
};
const errors = (plain: boolean) => ({
  "400": err("Malformed request: fewer than 2 labels, more than 1,000 inputs, empty or oversized text, an unknown tier, or a body that is not a JSON object. `code` says which; on the GET forms a 400 also carries `usage` and `try`, a URL built from what was sent that would have worked.", RATE_LIMIT_HEADERS, plain),
  "404": err("No such path. The body points at the docs, llms.txt, the spec and the sitemap.", undefined, plain),
  "429": err("Per-IP limit reached. Wait `Retry-After` seconds. `code` is rate_limit_minute or rate_limit_day.", {
    "Retry-After": { schema: { type: "integer" }, description: "Seconds until the window resets." },
    ...RATE_LIMIT_HEADERS,
  }, plain),
  "502": err("The model provider failed after retries; retry with backoff. `code` is typesafe_<status> or typesafe (the decision model), openrouter_<status>, chain_exhausted or timeout (the fallback chain), batch_unavailable (more than 20 inputs while the decision model is down) or upstream_other.", RATE_LIMIT_HEADERS, plain),
  default: err("Any other error, same {error, code} shape.", undefined, plain),
});
const ERRORS = errors(false);
/** For GET /{labels}/{text} and GET /?labels=&text=, whose errors are plain text unless JSON was asked for. */
const GET_ERRORS = errors(true);

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
      "Rate limits: RateLimit-Limit and RateLimit-Policy (IETF draft-ietf-httpapi-ratelimit-headers) on every classification " +
      "response, RateLimit-Remaining once the limiter has been consulted (every 200 and 429), Retry-After on 429s. " +
      "Idempotency: classification has no side effects; an Idempotency-Key header is accepted and " +
      "echoed so generic retry logic keeps working.\n\n" +
      "Errors: every non-2xx body is {error, code} — see components.schemas.Error for the codes. The two GET forms answer " +
      "plain text (`error:`, `usage:`, `try:` lines) unless ?verbose=1 or Accept: application/json asks for the JSON object.\n\n" +
      "MCP: the same capability as tools at https://classifier.dev/mcp (Streamable HTTP, no auth), documented at " +
      "https://classifier.dev/mcp-setup. Batch: the inputs array is the batch operation — up to 1,000 texts per request; " +
      "POST /v1/classify/batch is an alias for callers that look for one.",
    contact: { name: "Michael Ryaboy", url: "https://cal.com/michaelsf/coffee", email: "contact@classifier.dev" },
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
  // Anonymous, or a partner key: the empty object is what makes the key optional.
  security: [{}, { partnerKey: [] }],
  tags: [
    { name: "classify", description: "Sort texts into labels, with a calibrated confidence." },
    { name: "docs", description: "Documentation served over HTTP." },
    { name: "feedback", description: "Structured feedback from agents (feedback.now protocol): submit, then poll a receipt." },
  ],
  servers: [{ url: "https://classifier.dev" }],
  paths: {
    "/subscribe": {
      post: {
        operationId: "subscribeToUpdates",
        summary: "Subscribe a human or agent inbox to product updates",
        description: "Use your own email address, or one whose owner explicitly requested updates. No API key, browser, or email confirmation is required. Addresses are trimmed and lowercased. Repeated submissions keep one subscriber and return the same response. One email when a roadmap item ships; reply to unsubscribe. Limited to 5 requests/minute and 50/day per IP.",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["email"],
            properties: { email: { type: "string", maxLength: 254, description: "An email address for an inbox you control or have explicit permission to subscribe.", example: "agent@example.com" } },
          } } },
        },
        responses: {
          "202": {
            description: "Address subscribed, including repeat submissions. No confirmation step.",
            content: { "application/json": { schema: {
              type: "object", required: ["ok", "subscribed"],
              properties: { ok: { const: true }, subscribed: { type: "string", description: "The normalized email address." } },
              example: { ok: true, subscribed: "agent@example.com" },
            } } },
          },
          ...Object.fromEntries([
            ["400", "Missing or invalid email address."],
            ["429", "Too many signups; wait Retry-After seconds before retrying."],
            ["503", "Subscription storage unavailable; retry shortly."],
          ].map(([status, description]) => [status, {
            description,
            ...(status === "429" ? { headers: { "Retry-After": { schema: { type: "integer" } } } } : {}),
            content: { "application/json": { schema: { type: "object", required: ["error"], properties: { error: { type: "string" } } } } },
          }])),
        },
      },
    },
    "/v1/health": {
      get: {
        operationId: "getHealth",
        summary: "Liveness and version. No authentication.",
        description: "Returns {ok, service, version, time}. A cheap way to verify the API is reachable and open before sending work.",
        tags: ["docs"],
        parameters: [{ name: "verbose", in: "query", required: false, schema: { type: "boolean", default: false }, description: "Also return the limits and the model behind each tier." }],
        responses: {
          "200": {
            description: "The service is up.",
            content: { "application/json": { schema: { type: "object", required: ["ok", "version"], properties: { ok: { type: "boolean" }, service: { type: "string" }, version: { type: "string" }, time: { type: "string", format: "date-time" }, docs: { type: "string" } } } } },
          },
          ...ERRORS,
        },
      },
    },
    "/v1/docs": {
      get: {
        operationId: "listDocSections",
        summary: "The documentation as a paged list of sections (cursor pagination).",
        description: "Walk every section of every document one page at a time. Follow `next` (or pass `page_info.next_cursor` as `cursor`) until `has_more` is false. `q` filters sections by a substring.",
        tags: ["docs"],
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 50, default: 10 }, description: "Sections per page." },
          { name: "cursor", in: "query", required: false, schema: { type: "string" }, description: "The `next_cursor` from the previous page. Omit for the first page." },
          { name: "q", in: "query", required: false, schema: { type: "string", maxLength: 100 }, description: "Only sections containing this text (case-insensitive)." },
        ],
        responses: {
          "200": {
            description: "One page of sections.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "page_info", "next"],
                  properties: {
                    items: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "doc", "heading", "url", "text"],
                        properties: { id: { type: "string" }, doc: { type: "string" }, heading: { type: "string" }, url: { type: "string", format: "uri" }, text: { type: "string" } },
                      },
                    },
                    page_info: {
                      type: "object",
                      required: ["limit", "count", "total", "has_more", "next_cursor"],
                      properties: { limit: { type: "integer" }, count: { type: "integer" }, total: { type: "integer" }, has_more: { type: "boolean" }, next_cursor: { type: ["string", "null"] } },
                    },
                    next: { type: ["string", "null"], format: "uri", description: "Ready-made URL of the next page, or null on the last page." },
                  },
                },
              },
            },
          },
          ...ERRORS,
        },
      },
    },
    "/v1/sandbox/classify": {
      post: {
        operationId: "classifySandbox",
        summary: "Sandbox: identical to POST /v1/classify. Exists for tooling that requires a sandbox URL.",
        description: "There is no separate test environment because production stores nothing and costs nothing; this alias answers exactly like /v1/classify and adds an `x-sandbox` header so integrations can point a sandbox setting somewhere real.",
        tags: ["classify"],
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyRequest" } } } },
        responses: {
          "200": { description: "Same as /v1/classify.", headers: { "x-sandbox": { schema: { type: "string" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyResponse" } } } },
          ...ERRORS,
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
          "200": { description: "The index.", content: { "application/json": { schema: { $ref: "#/components/schemas/AgentIndex" } } } },
          ...ERRORS,
        },
      },
    },
    "/api/v1/feedback": {
      post: {
        operationId: "submitFeedback",
        summary: "Agents report a problem or a suggestion (feedback.now protocol). Returns a receipt to poll.",
        description:
          "Asynchronous: the report is accepted immediately and scored, deduplicated and forwarded in the background. " +
          "The response carries a receipt with an `id` and a `status`; poll GET /api/v1/receipts/{id} until `status` is final. " +
          "Categories, evidence types and limits are at GET /api/v1/policy and /.well-known/agent-feedback.json. No authentication.",
        tags: ["feedback"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/FeedbackReport" } } },
        },
        responses: {
          "202": {
            description: "Accepted for processing. `Location` points at the receipt to poll; the body carries the same id.",
            headers: { Location: { schema: { type: "string", format: "uri" }, description: "GET here until status is final." } },
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["receipt"],
                  properties: {
                    receipt: {
                      type: "object",
                      required: ["id", "status"],
                      properties: {
                        id: { type: "string", description: "Job id; GET /api/v1/receipts/{id} returns its state." },
                        status: { type: "string", enum: ["accepted", "duplicate"] },
                        quality_score: { type: "number" },
                        duplicate_of: { type: ["string", "null"] },
                        budget_remaining: { type: "integer" },
                        poll: { type: "string", description: "URL to poll for the final state." },
                      },
                    },
                  },
                },
              },
            },
          },
          ...ERRORS,
        },
      },
    },
    "/api/v1/observations": {
      post: {
        operationId: "submitObservation",
        summary: "A lighter signal than a full report: one category and one sentence, no evidence.",
        description:
          "Flat body, no envelope. Accepted and forwarded the same way as POST /api/v1/feedback and answered with the same " +
          "receipt to poll. Use it for a quick note; use /api/v1/feedback when there is evidence to attach.",
        tags: ["feedback"],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Observation" } } },
        },
        responses: {
          "202": {
            description: "Accepted for processing. `Location` points at the receipt to poll.",
            headers: { Location: { schema: { type: "string", format: "uri" }, description: "GET here until status is final." } },
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["receipt"],
                  properties: {
                    receipt: {
                      type: "object",
                      required: ["id", "status"],
                      properties: {
                        id: { type: "string" },
                        observation_id: { type: "string" },
                        status: { type: "string", enum: ["accepted"] },
                        budget_remaining: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          ...ERRORS,
        },
      },
    },
    "/api/v1/policy": {
      get: {
        operationId: "getFeedbackPolicy",
        summary: "What this host accepts as feedback: categories, severities, evidence types, limits, budget.",
        description: "The feedback.now policy document. The same vocabularies are in /.well-known/agent-feedback.json and in the FeedbackReport schema.",
        tags: ["feedback"],
        responses: {
          "200": {
            description: "The policy.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["version", "categories", "severity_levels", "evidence_types", "limits", "rate_limit_per_hour", "endpoints"],
                  properties: {
                    version: { type: "string" },
                    categories: { type: "array", items: { type: "string", enum: [...CATEGORIES] } },
                    severity_levels: { type: "array", items: { type: "string", enum: [...SEVERITIES] } },
                    reproducibility_options: { type: "array", items: { type: "string", enum: [...REPRODUCIBILITY] } },
                    evidence_types: { type: "array", items: { type: "string", enum: [...EVIDENCE_TYPES] } },
                    surface_kinds: { type: "array", items: { type: "string", enum: [...SURFACE_KINDS] } },
                    limits: { type: "object", additionalProperties: true },
                    rate_limit_per_hour: { type: "integer" },
                    retention_days: { type: "integer" },
                    auth_required: { type: "boolean" },
                    endpoints: { type: "object", additionalProperties: { type: "string" } },
                  },
                },
              },
            },
          },
          ...ERRORS,
        },
      },
    },
    "/api/v1/feedback/{id}/attachments": {
      post: {
        operationId: "addFeedbackAttachments",
        summary: "Add evidence to a feedback report that was already submitted.",
        description: "Appends to the report's evidence list, within the per-report cap the policy states. The id is the `feedback_id` on the receipt. Synchronous: answers 200 with the new evidence ids.",
        tags: ["feedback"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "The feedback report id (`feedback_id` on its receipt)." }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["evidence"],
                properties: {
                  evidence: {
                    type: "array",
                    minItems: 1,
                    maxItems: LIMITS.max_evidence_per_feedback,
                    items: { type: "object", required: ["type", "content"], properties: { type: { type: "string", enum: [...EVIDENCE_TYPES] }, content: { description: "Text, or any JSON value, which is stored serialised." } } },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Evidence added.",
            content: { "application/json": { schema: { type: "object", required: ["evidence_ids", "evidence_count"], properties: { evidence_ids: { type: "array", items: { type: "string" } }, evidence_count: { type: "integer" } } } } },
          },
          ...ERRORS,
        },
      },
    },
    "/api/v1/receipts/{id}": {
      get: {
        operationId: "getReceipt",
        summary: "Poll a feedback receipt (the async job's state).",
        tags: ["feedback"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "The receipt id returned by POST /api/v1/feedback or /api/v1/observations." }],
        responses: {
          "200": {
            description: "The receipt.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["id", "status"],
                      properties: {
                        id: { type: "string" },
                        feedback_id: { type: "string" },
                        observation_id: { type: "string" },
                        status: { type: "string", enum: ["accepted", "duplicate", "processed"] },
                        quality_score: { type: "number" },
                        duplicate_of: { type: ["string", "null"] },
                        budget_remaining: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          ...ERRORS,
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
            headers: RATE_LIMIT_HEADERS,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyResponse" } } },
          },
          ...ERRORS,
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
          "200": {
            description: "One result per input, in order.",
            headers: RATE_LIMIT_HEADERS,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyResponse" } } },
          },
          ...ERRORS,
        },
      },
    },
    "/": {
      get: {
        operationId: "getDocs",
        summary: "The documentation: plain text by default, Markdown or HTML by Accept, JSON index for application/json.",
        description: "Content negotiation on Accept: text/plain (default, what curl prints), text/markdown, text/html, or application/json for the same machine-readable index as GET /api. `?format=` overrides Accept.",
        tags: ["docs"],
        parameters: [
          { name: "format", in: "query", required: false, schema: { type: "string", enum: ["text", "markdown", "html", "json"] }, description: "Force a representation regardless of Accept." },
          {
            name: "labels",
            in: "query",
            required: false,
            description: "With `text`, classifies instead of returning the docs: comma-separated categories, 2 to 100. Takes the same options as GET /{labels}/{text}.",
            schema: { type: "string" },
            example: "spam,not+spam",
          },
          {
            name: "text",
            in: "query",
            required: false,
            description: "The text to classify, up to 32,000 characters. `input` and `q` are read as aliases; `classes` and `categories` as aliases of `labels`.",
            schema: { type: "string" },
            example: "Win+a+free+iPhone",
          },
          { name: "tier", in: "query", required: false, schema: { type: "string", enum: ["fast", "smart"], default: "fast" }, description: "With labels and text. Anything else is a 400 bad_tier." },
          { name: "instructions", in: "query", required: false, schema: { type: "string" }, description: "With labels and text: extra criteria." },
          { name: "verbose", in: "query", required: false, schema: { type: "string", enum: ["1", "true", "yes", "on"] }, description: "With labels and text: JSON instead of a bare label." },
          { name: "multi", in: "query", required: false, schema: { type: "string", enum: ["1", "true", "yes", "on"] }, description: "With labels and text: every label that applies, one per line." },
          { name: "max_labels", in: "query", required: false, schema: { type: "integer", minimum: 1 }, description: "With labels and text: cap on a multi-label answer; implies multi." },
        ],
        responses: {
          ...GET_ERRORS,
          "200": {
            description: "Documentation, in the negotiated format; or, with labels and text, the classification exactly as GET /{labels}/{text} answers it.",
            content: {
              "text/plain": { schema: { type: "string" } },
              "text/markdown": { schema: { type: "string" } },
              "text/html": { schema: { type: "string" } },
              "application/json": { schema: { $ref: "#/components/schemas/AgentIndex" } },
            },
          },
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
                  summary: "Smart batch (up to 200 inputs without a partner key)",
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
          ...ERRORS,
          "200": {
            description: "Classification results",
            headers: {
              ...RATE_LIMIT_HEADERS,
              "X-RateLimit-Limit": { schema: { type: "string" }, description: "The older spelling, kept: e.g. 3000/min" },
              "X-RateLimit-Remaining": { schema: { type: "string" } },
            },
            content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyResponse" } } },
          },
          ...ERRORS,
        },
      },
    },
    "/{labels}/{text}": {
      get: {
        operationId: "classifyByPath",
        summary: "Classify a single text. Returns the bare label as plain text.",
        description:
          "The quickest possible call: labels comma-separated in the first path segment, " +
          "the text in the rest. Spaces may be written as + or %20. A raw comma, slash or plus is a separator; " +
          "a label's own comma, slash or plus sign is written percent-encoded (%2C, %2F, %2B), so /C%2B%2B,python/... reads the label C++. " +
          "Add ?verbose=1 (or send Accept: application/json) for JSON including calibrated confidence and per-label scores. " +
          "The same request works as query parameters on the root, GET /?labels=spam,not+spam&text=Win+a+free+iPhone, " +
          "with the same options; a malformed request answers with a URL that would have worked.",
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
            description: "fast or smart, any case. Anything else is a 400 bad_tier rather than a silent fast.",
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
            description: "Set to 1 to receive JSON instead of a bare label. Accept: application/json does the same.",
            schema: { type: "string", enum: ["1", "true", "yes", "on"] },
          },
          {
            name: "multi",
            in: "query",
            required: false,
            description: "Set to 1 to return every category that applies, one per line (an array under `labels` with ?verbose=1).",
            schema: { type: "string", enum: ["1", "true", "yes", "on"] },
          },
          {
            name: "max_labels",
            in: "query",
            required: false,
            description: "Cap on how many labels a multi-label answer returns; implies multi. Zero or less means no cap.",
            schema: { type: "integer" },
          },
        ],
        responses: {
          ...GET_ERRORS,
          "200": {
            description: "The chosen label, or JSON when verbose=1 or Accept: application/json",
            headers: RATE_LIMIT_HEADERS,
            content: {
              "text/plain": { schema: { type: "string", example: "spam" } },
              "application/json": { schema: { $ref: "#/components/schemas/SingleResult" } },
            },
          },
        },
      },
    },
    "/benchmark": {
      get: {
        operationId: "getBenchmark",
        description: "Measured accuracy, calibration, cost and latency. Accept: application/json (or ?format=json) returns the live measurement summary the tables are generated from (eval/vs_jev.py).",
        tags: ["docs"],
        parameters: [{ name: "format", in: "query", required: false, schema: { type: "string", enum: ["text", "markdown", "html", "json"] }, description: "Force a representation regardless of Accept." }],
        summary: "Measured accuracy, cost and latency for every model considered.",
        responses: {
          ...ERRORS,
          "200": { description: "Benchmark", content: {
              "text/plain": { schema: { type: "string" } },
              "text/markdown": { schema: { type: "string" } },
              "text/html": { schema: { type: "string" } },
              "application/json": { schema: { $ref: "#/components/schemas/BenchmarkSummary" } },
            } },
        },
      },
    },
  },
  components: {
    schemas: {
      FeedbackReport: {
        type: "object",
        description:
          "A feedback.now 1.1 report. Only `signal.category` and one of `content.title` or `content.summary` are required; " +
          "every other field raises the quality score the receipt reports. Vocabularies are the ones GET /api/v1/policy serves.",
        required: ["signal", "content"],
        properties: {
          reporter: {
            type: "object",
            description: "Who is reporting. Shown on the report as `vendor / product / version`.",
            properties: {
              agent_vendor: { type: "string", maxLength: 64 },
              agent_product: { type: "string", maxLength: 64 },
              agent_version: { type: "string", maxLength: 64 },
            },
          },
          subject: {
            type: "object",
            description: "What the report is about.",
            properties: {
              surface: { type: "string", maxLength: 256, description: "The endpoint, page or command, e.g. `POST /v1/classify`." },
              domain: { type: "string", maxLength: 256, description: "The host, e.g. `classifier.dev`." },
              kind: { type: "string", enum: [...SURFACE_KINDS] },
            },
          },
          signal: {
            type: "object",
            required: ["category"],
            properties: {
              category: { type: "string", enum: [...CATEGORIES] },
              severity: { type: "string", enum: [...SEVERITIES], default: "medium" },
              reproducibility: { type: "string", enum: [...REPRODUCIBILITY] },
              confidence: { type: "number", minimum: LIMITS.confidence_range.min, maximum: LIMITS.confidence_range.max },
            },
          },
          content: {
            type: "object",
            description: "`title` or `summary` is required. A missing title is taken from the summary.",
            anyOf: [
              { required: ["title"], properties: { title: { type: "string", pattern: "\\S" } } },
              { required: ["summary"], properties: { summary: { type: "string", pattern: "\\S" } } },
            ],
            properties: {
              title: { type: "string", maxLength: LIMITS.max_title_length },
              summary: { type: "string", maxLength: LIMITS.max_summary_length },
              hypothesis: { type: "string", maxLength: LIMITS.max_hypothesis_length, description: "What the reporter thinks is going on." },
            },
          },
          evidence: {
            type: "array",
            maxItems: LIMITS.max_evidence_per_feedback,
            description: "More can be added later with POST /api/v1/feedback/{id}/attachments.",
            items: {
              type: "object",
              required: ["type", "content"],
              properties: {
                type: { type: "string", enum: [...EVIDENCE_TYPES] },
                content: { description: "Text, or any JSON value, which is stored serialised." },
              },
            },
          },
        },
        example: {
          reporter: { agent_vendor: "anthropic", agent_product: "claude-code", agent_version: "2.1.0" },
          subject: { surface: "POST /v1/classify", domain: "classifier.dev", kind: "api_endpoint" },
          signal: { category: "bug", severity: "high", reproducibility: "always", confidence: 0.9 },
          content: {
            title: "POST /v1/classify returns 404",
            summary: "The documented path answers 404 not_found while POST / classifies the same body.",
            hypothesis: "The route was dropped in a recent deploy.",
          },
          evidence: [{ type: "repro_steps", content: "curl -d '{\"input\":\"hello\",\"labels\":[\"a\",\"b\"]}' https://classifier.dev/v1/classify" }],
        },
      },
      Observation: {
        type: "object",
        description: "The flat body POST /api/v1/observations reads: a category and one sentence.",
        required: ["category", "summary"],
        properties: {
          category: { type: "string", enum: [...CATEGORIES] },
          summary: { type: "string", pattern: "\\S", maxLength: LIMITS.max_summary_length },
          severity: { type: "string", enum: [...SEVERITIES], default: "medium" },
          confidence: { type: "number", minimum: LIMITS.confidence_range.min, maximum: LIMITS.confidence_range.max },
          surface: { type: "string", maxLength: 256 },
          domain: { type: "string", maxLength: 256 },
          agent_vendor: { type: "string", maxLength: 64 },
          agent_product: { type: "string", maxLength: 64 },
        },
        example: { category: "friction", summary: "The 404 body names an endpoint that also 404s.", surface: "POST /v1/classify", domain: "classifier.dev" },
      },
      ClassifyRequest: {
        type: "object",
        required: ["labels"],
        examples: [
          { inputs: ["the checkout button does nothing", "love the new dark mode"], labels: ["bug", "praise", "feature"] },
          { inputs: ["postgres index tuning for ML feature stores"], labels: ["databases", "ml", "frontend"], multi: true, max_labels: 2 },
        ],
        properties: {
          input: { type: "string", description: "A single text. Provide this or inputs; a string under `inputs` is read as one text too." },
          inputs: {
            type: "array",
            items: { type: "string" },
            maxItems: 1000,
            description: "Up to 1,000 texts classified in one call, results in the same order. Public smart requests accept at most 200 so the batch fits its per-minute quota.",
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
              "smart re-asks single-label answers below 0.7 confidence of a reasoning model; multi-label ignores it. Read case-insensitively; any other value is a 400 bad_tier.",
          },
          instructions: { type: "string", description: "Extra criteria for the classifier." },
          multi: { type: "boolean", description: "Return every label that applies, with a score per label. true, \"true\", 1 and \"1\" all mean yes." },
          max_labels: { type: "integer", minimum: 1, description: "Cap on how many multi-label answers come back; implies multi. A numeric string is read; zero or less means no cap; a fraction is rounded down." },
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
          labels: {
            type: "array",
            items: { type: "string" },
            description: "With ?multi=1 only: every label scoring >= 0.7, most likely first. `label` is then the first of them, or empty, and confidence is null.",
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
              escalation_failed: { type: "integer", description: "Present only when some smart-tier re-asks could not reach the reasoning model; those results carry the fast answer without `escalated`." },
              ms: { type: "integer" },
            },
          },
        },
      },
      BenchmarkSummary: {
        type: "object",
        required: ["measured", "summary"],
        properties: {
          measured: { type: "string", format: "date", description: "When the live measurement ran." },
          summary: {
            type: "object",
            description: "Per test set (ag_news, emotion): n, how many items Jev was unsure about, and one row per run (jev, fast, smart).",
            additionalProperties: {
              type: "object",
              required: ["n", "unsure", "rows"],
              properties: {
                n: { type: "integer" },
                unsure: { type: "integer" },
                rows: {
                  type: "object",
                  additionalProperties: {
                    type: "object",
                    properties: {
                      acc: { type: "number" }, acc_unsure: { type: ["number", "null"] }, acc_sure: { type: ["number", "null"] },
                      agree_with_jev: { type: "number" }, disagreements: { type: "integer" }, disagreements_unsure: { type: "integer" },
                      escalated: { type: "integer" }, ms_item: { type: "number" }, cost_per_1k: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      AgentIndex: {
        type: "object",
        required: ["name", "version", "api", "mcp", "limits"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          version: { type: "string" },
          authentication: { type: "object", properties: { required: { type: "boolean" }, optional_bearer: { type: "string" }, docs: { type: "string" } } },
          api: { type: "object", properties: { classify: { type: "object", properties: { method: { type: "string" }, url: { type: "string" }, alias: { type: "string" } } }, classify_one: { type: "object", properties: { method: { type: "string" }, url: { type: "string" } } }, openapi: { type: "string" } } },
          mcp: { type: "object", properties: { tools: { type: "string" }, docs: { type: "string" }, card: { type: "string" }, setup: { type: "string" } } },
          cli: { type: "object", properties: { install: { type: "string" }, example: { type: "string" } } },
          skill: { type: "object", properties: { install: { type: "string" }, url: { type: "string" } } },
          limits: { type: "object", properties: { fast: { type: "string" }, smart: { type: "string" }, headers: { type: "array", items: { type: "string" } } } },
          pricing: { type: "object", properties: { price: { type: "number" }, currency: { type: "string" }, url: { type: "string" } } },
          docs: { type: "object", additionalProperties: { type: "string" } },
          discovery: { type: "array", items: { type: "string", format: "uri" } },
        },
      },
      Error: {
        type: "object",
        required: ["error", "code"],
        properties: {
          error: { type: "string", description: "Human-readable message saying what to change." },
          code: {
            type: "string",
            description:
              "Stable machine-readable code: one of the listed values, or typesafe_<status> / openrouter_<status> carrying the upstream HTTP status. " +
              "400: bad_json, no_input, too_many_inputs, too_few_labels, too_many_labels, empty_label, duplicate_labels, empty_input, input_too_long, bad_tier, bad_cursor, invalid_submission. " +
              "404: not_found. 429: rate_limit_minute, rate_limit_day. 502: typesafe, typesafe_<status>, openrouter_<status>, chain_exhausted, batch_unavailable, timeout, upstream_other. 500: internal.",
            anyOf: [{ enum: [...ERROR_CODES] }, { pattern: UPSTREAM_CODE_PATTERN }],
          },
          usage: { type: "string", description: "GET forms only, on a 400: the two URL shapes." },
          try: { type: "string", format: "uri", description: "GET forms only, on a 400: a URL built from what was sent that would have worked." },
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
  },
} as const;

export const LLMS_TXT = `# classifier.dev

> Zero-shot text classification over plain HTTP, with no API key and no account.
> Send text and a list of labels, get back the label that fits and a calibrated
> confidence. Up to 1,000 texts per request, back in about a second.

Quickest possible call:

    curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone+now
    spam

Same call as query parameters:

    curl "https://classifier.dev/?labels=spam,not+spam&text=Win+a+free+iPhone+now"
    spam

JSON, many at once:

    curl https://classifier.dev -d '{"inputs":["...","..."],"labels":["a","b"]}'
    {"results":[{"label":"a","confidence":0.97,"scores":{"a":0.97,"b":0.03}}, ...]}

## When an agent should call this

You can already classify text you can see. Call this when reading the input is
the expensive part: filtering search results before opening them, pre-filtering
before expensive reasoning, bucketing logs or tickets nobody reads line by line,
or routing a pipeline branch deterministically. Each of those classifies many
things without pulling them into context. Under about five items, just decide
yourself.

## Confidence

The confidence is calibrated: on six-way emotion, answers at >= 0.9 were right
82% of the time and answers below 0.5 were right 29%. Act on the sure ones and
look at the rest yourself, or pass tier "smart" and answers under 0.7 are
re-asked of a reasoning model for you. It is not a fit score: add a label such
as "none of these" when none-of-the-above is a real outcome.

## MCP

Two Streamable HTTP servers, no auth: https://classifier.dev/mcp (tools:
classify_texts, classify_multi_label, count_labels, review_uncertain) and
https://classifier.dev/mcp/docs (list_docs, read_doc, search_docs, get_examples). Setup for
Claude, ChatGPT, Codex and Cursor: [mcp-setup](https://classifier.dev/mcp-setup).
Server card: [server-card.json](https://classifier.dev/.well-known/mcp/server-card.json).
Registry: [dev.classifier/classifier and dev.classifier/docs](https://registry.modelcontextprotocol.io/v0/servers?search=dev.classifier)
in the official MCP registry.

## SDKs

- Python: \`pip install "classifier-dev @ git+https://github.com/mrmps/classifier-dev.git@python-v0.1.0#subdirectory=sdk/python"\` — \`from classifier_dev import classify\` ([tagged source](https://github.com/mrmps/classifier-dev/tree/python-v0.1.0/sdk/python); Git required to install)
- Go: \`go get github.com/mrmps/classifier-dev/sdk/go\` ([pkg.go.dev](https://pkg.go.dev/github.com/mrmps/classifier-dev/sdk/go))
- JavaScript: no SDK needed. POST JSON to https://classifier.dev/v1/classify with fetch(); the npm package \`classifier-dev\` is the CLI.

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
