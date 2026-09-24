import { SPENDING_ERROR_CODES } from "./spending/policy";
import { DIMENSIONS_SCHEMA } from "./dimensions";
import { ACCOUNT_PATHS } from "./account-openapi";
import { LONG_CONTEXT_JOB_MAX_TOKENS, LONG_CONTEXT_PART_MAX_TOKENS, LONG_CONTEXT_MAX_PARTS } from "./long-context";
import { CATEGORIES, SEVERITIES, REPRODUCIBILITY, EVIDENCE_TYPES, SURFACE_KINDS, LIMITS } from "./feedback";
import { MAX_DESIRED_LATENCY_MS, MIN_DESIRED_LATENCY_MS, ROADMAP, ROADMAP_KEYS } from "./newsletter";

/**
 * Every code the worker puts in an error body. index.ts types its `fail()`
 * against this list, so a code cannot be served without being documented here.
 * The two parameterised families, typesafe_<status> and openrouter_<status>,
 * carry the upstream HTTP status and are described by the pattern below.
 */
export const ERROR_CODES = [
  ...SPENDING_ERROR_CODES,
  "scrape_unavailable", "scrape_payment_required", "scrape_failed", "scrape_empty", "scrape_too_large",
  "bad_model", "bad_processing", "laya_input", "laya_rate_limit", "laya_unavailable",
  "chunklaya_input", "chunklaya_busy", "chunklaya_unavailable",
  "dgemma_input", "dgemma_busy", "dgemma_unavailable", "images_unsupported",
  "long_context_payment_required", "long_context_too_large", "long_context_no_evidence", "long_context_unavailable", "long_context_input",
  "job_busy", "job_closed", "part_sequence",
  // 400
  "bad_dimensions", "too_many_decisions", "dimension_context_too_large", "bad_json", "no_input", "too_many_inputs", "too_few_labels", "too_many_labels", "empty_label",
  "duplicate_labels", "empty_input", "input_too_long", "bad_tier", "bad_cursor", "invalid_submission", "skill_invalid", "account_route_required",
  // 401: invalid classification credentials
  "invalid_api_key",
  // 404
  "not_found",
  // 409: the same skill text is already listed
  "duplicate_skill",
  // 429
  "rate_limit_minute", "rate_limit_day", "rate_limit_hour", "label_set_limit",
  // 502: the model provider failed after retries
  "typesafe", "chain_exhausted", "batch_unavailable", "timeout", "upstream_other",
  // 500
  "internal",
  // 503: required review or inference providers are unavailable
  "review_unavailable", "inference_unavailable", "label_set_unavailable",
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
const TYPESAFE_REQUEST_ID_HEADER = {
  "x-typesafe-request-id": { schema: { type: "string" }, description: "TypeSafe request ID, exposed by both official SDKs." },
};
const ACCOUNT_BILLING_HEADERS = {
  "x-request-id": { schema: { type: "string" }, description: "Workspace usage request ID. Present when a classifier_agent_ key is used." },
  "x-billed-input-tokens": { schema: { type: "integer", minimum: 0 }, description: "Successful base-classifier input tokens billed at the published rate; excludes Smart and fallback provider tokens." },
  "x-smart-escalations": { schema: { type: "integer", minimum: 0 }, description: "Successful Smart reviews billed at the flat escalation price." },
  "x-usage-cost-usd": { schema: { type: "string" }, description: "Customer charge in USD before credit rounding. Settlement may still be pending." },
  "x-billing-status": { schema: { type: "string", enum: ["pending", "settled", "refunded", "review"] }, description: "Workspace charge result. Present when a classifier_agent_ key is used." },
};
const JOB_ID = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" },
  description: "A UUID chosen by the caller; reuse it to retry creation or resume the same job." };
const JOB_RESPONSE = { "200": { description: "Job progress or result.", content: { "application/json": { schema: { type: "object" } } } },
  "202": { description: "Cancellation requested; poll status until refunded." },
  "400": err("Invalid job metadata or part."), "401": err("A valid workspace API key is required."),
  "402": err("A funded workspace and sufficient balance are required."),
  "409": err("The job is closed, busy, or the next part sequence is different."),
  "503": err("Jev or job processing is unavailable; retry the same part or finish call.") };
const DOCUMENT_PARAMETERS = [
  { $ref: "#/components/parameters/IdempotencyKey" },
  { name: "Prefer", in: "header", schema: { type: "string", const: "respond-async" }, description: "Upload one complete document and receive a background job, even below the synchronous limits." },
  { name: "labels", in: "query", schema: { type: "string" }, description: "For text/plain uploads: comma-separated labels." },
  { name: "label", in: "query", style: "form", explode: true, schema: { type: "array", items: { type: "string" } }, description: "For text/plain uploads: repeated label parameters, allowing commas inside labels." },
  { name: "instructions", in: "query", schema: { type: "string", maxLength: 4000 }, description: "For text/plain uploads: classification criteria." },
  { name: "multi", in: "query", schema: { type: "boolean" }, description: "For text/plain uploads: return every applicable label." },
];
const DOCUMENT_ACCEPTED = {
  description: "Whole document uploaded. Poll status_url with the same workspace key. No client chunking or finish call is needed. Requires funded access. Queued source is stored privately and deleted as screened; all source/evidence is deleted on completion, cancellation, failure or 24-hour expiry.",
  headers: { Location: { schema: { type: "string" } }, "Retry-After": { schema: { type: "integer" } } },
  content: { "application/json": { schema: { type: "object", required: ["id", "status", "status_url", "context_tokens", "expires_at"], properties: {
    id: { type: "string", format: "uuid" }, status: { type: "string" }, status_url: { type: "string", format: "uri" },
    context_tokens: { type: "integer", maximum: LONG_CONTEXT_JOB_MAX_TOKENS }, expires_at: { type: "string", format: "date-time" },
  } } } },
};
const TYPESAFE_ENTRY = {
  anyOf: [
    { type: "string" },
    { type: "object", additionalProperties: true },
    { type: "array", items: {} },
    { type: "null" },
  ],
};
const TYPESAFE_QUESTION = {
  oneOf: [
    {
      type: "object", required: ["type"],
      properties: {
        type: { const: "noul" }, instructions: TYPESAFE_ENTRY,
        criteria: { anyOf: [{ type: "object", properties: { true: TYPESAFE_ENTRY, false: TYPESAFE_ENTRY } }, { type: "null" }] },
      },
    },
    {
      type: "object", required: ["type", "criteria"],
      properties: {
        type: { const: "choice" }, instructions: TYPESAFE_ENTRY,
        criteria: { type: "object", additionalProperties: TYPESAFE_ENTRY },
      },
    },
    {
      type: "object", required: ["type", "criteria"],
      properties: {
        type: { const: "score" }, instructions: TYPESAFE_ENTRY,
        criteria: { type: "array", minItems: 1, items: TYPESAFE_ENTRY },
      },
    },
  ],
  discriminator: { propertyName: "type" },
};
const TYPESAFE_ANSWER = {
  oneOf: [
    { type: "object", required: ["type", "noul"], properties: { type: { const: "noul" }, noul: { type: "number", minimum: 0, maximum: 1 } } },
    { type: "object", required: ["type", "choice", "confidence", "probabilities"], properties: {
      type: { const: "choice" }, choice: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 },
      probabilities: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: 1 } },
    } },
    { type: "object", required: ["type", "score", "confidence", "legend", "probabilities"], properties: {
      type: { const: "score" }, score: { type: "number" }, confidence: { type: "number", minimum: 0, maximum: 1 },
      legend: { type: "object", additionalProperties: TYPESAFE_ENTRY },
      probabilities: { type: "object", additionalProperties: { type: "number", minimum: 0, maximum: 1 } },
    } },
  ],
  discriminator: { propertyName: "type" },
};
const errors = (plain: boolean) => ({
  "400": err("Malformed request: fewer than 2 labels, more than 1,000 inputs, empty or oversized text, an unknown tier, or a body that is not a JSON object. `code` says which; on the GET forms a 400 also carries `usage` and `try`, a URL built from what was sent that would have worked.", RATE_LIMIT_HEADERS, plain),
  "401": err("Invalid API key. Create a workspace key at /app/keys."),
  "402": err("Insufficient workspace balance to reserve inference usage, or long_context_payment_required: long context requires paid balance or an active paid subscription; anonymous access and signup credit do not qualify."),
  "422": err("long_context_no_evidence: at least one document has no selected evidence, either none qualified or no eligible chunk fit. No charge."),
  "403": err("The key is inactive or the workspace cannot authorize usage."),
  "503": err("Workspace billing, label-set admission or inference is temporarily unavailable. long_context_unavailable identifies Jev long-context failure. label_set_unavailable means the label allowance could not be checked and inference did not start. A cold bulk worker can return laya_unavailable; respect Retry-After and retry with backoff."),
  "404": err("No such path. The body points at the docs, llms.txt, the spec and the sitemap.", undefined, plain),
  "429": err("Quota or shared Laya capacity reached. Wait Retry-After seconds. Anonymous requests also share a global allowance with every request using the same label set; code label_set_limit identifies that limit. Laya trial caps also apply to paid keys and cannot be lifted by upgrading; code laya_rate_limit identifies that lane's admission limit. Daily per-caller limits use rate_limit_day.", {
    "Retry-After": { schema: { type: "integer" }, description: "Seconds until the window resets." },
    ...RATE_LIMIT_HEADERS,
  }, plain),
  "502": err("The model provider failed after retries; retry with backoff. `code` is typesafe_<status> or typesafe (the decision model), openrouter_<status>, chain_exhausted or timeout (the fallback chain), batch_unavailable or upstream_other. Fallback remains bounded by the request spending allowance.", RATE_LIMIT_HEADERS, plain),
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
    summary: "Zero-shot text classification with calibrated confidence. Free without a key; Pro for 10x limits.",
    description:
      "Send text and a list of labels, receive the label that fits, a calibrated confidence " +
      "and a score per label. Up to 1,000 texts per request, ~1s. Tiers: fast (default) and " +
      "smart, which re-asks answers below 0.7 confidence of a fast reasoning model. " +
      "Free limits are per IP and counted in classifications: 3,000/min and 20,000/day on fast, " +
      "200/min and 2,000/day on smart. Benchmarks: https://classifier.dev/benchmark\n\n" +
      "Authentication: optional for classification. Pro ($20/month) workspaces provide fast 30,000/min and 200,000/day, " +
      "smart 2,000/min and 20,000/day shared across workspace keys and agents. Partner keys remain supported " +
      "(see https://classifier.dev/auth.md).\n\n" +
      "Versioning: the current major is v1, addressed as POST /v1/classify; POST / is an alias that tracks the current major. " +
      "Response shapes are additive within a major (fields are added, never renamed or removed). Every response carries an " +
      "x-api-version header. A breaking change ships as /v2 beside /v1, and /v1 then carries Deprecation and Sunset headers " +
      "(RFC 9745 / RFC 8594) for at least six months before removal.\n\n" +
      "Rate limits: RateLimit-Limit and RateLimit-Policy (IETF draft-ietf-httpapi-ratelimit-headers) on every classification " +
      "response, RateLimit-Remaining once the limiter has been consulted (every 200 and 429), Retry-After on 429s. " +
      "Idempotency: synchronous paid requests reject replayed keys. Whole-document jobs accept an optional UUID " +
      "Idempotency-Key and return the same job on retry without charging again.\n\n" +
      "Errors: classification failures return {error, code}; workspace authorization and billing errors return {error}. " +
      "See components.schemas.Error for classification codes. The two GET forms answer " +
      "plain text (`error:`, `usage:`, `try:` lines) unless ?verbose=1 or Accept: application/json asks for the JSON object.\n\n" +
      "MCP: the same capability as tools at https://classifier.dev/mcp (Streamable HTTP, no auth), documented at " +
      "https://classifier.dev/mcp-setup. Batch: the inputs array is the batch operation — up to 1,000 texts per request; " +
      "POST /v1/classify/batch is an alias for callers that look for one.",
    contact: { name: "Michael Ryaboy", url: "https://cal.com/michaelsf/coffee", email: "contact@classifier.dev" },
    license: { name: "MIT", url: "https://github.com/mrmps/classifier-dev/blob/main/LICENSE" },
    termsOfService: "https://classifier.dev/terms",
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
  // Anonymous, or a Pro/partner key: the empty object is what makes the key optional.
  security: [{}, { partnerKey: [] }],
  tags: [
    { name: "account", description: "Workspace balance and usage; requires a workspace API key and enabled account access." },
    { name: "classify", description: "Sort texts into labels, with a calibrated confidence." },
    { name: "docs", description: "Documentation served over HTTP." },
    { name: "feedback", description: "Structured feedback from agents (feedback.now protocol): submit, then poll a receipt." },
  ],
  servers: [{ url: "https://classifier.dev" }],
  paths: {
    ...ACCOUNT_PATHS,
    "/subscribe": {
      post: {
        operationId: "subscribeToUpdates",
        summary: "Subscribe a human or agent inbox to product updates",
        description: "Use your own email address, or one whose owner explicitly requested updates. No API key or browser is required. Check the inbox and POST the emailed token to /subscribe/confirm before updates start. Tokens expire within 24 hours; repeated requests within the same clock hour send at most one email. Addresses are trimmed and lowercased. Signup does not add an active subscriber. Existing unsubscribes are preserved. One email when a roadmap item ships; reply to unsubscribe. Limited to 5 requests/minute and 50/day per IP.",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["email"],
            properties: {
              email: { type: "string", maxLength: 254, description: "An email address for an inbox you control or have explicit permission to subscribe.", example: "agent@example.com" },
              wants: {
                type: "array", uniqueItems: true,
                items: { type: "string", enum: [...ROADMAP_KEYS] },
                description: `Optional. The roadmap items the subscriber would use first: ${ROADMAP.map((r) => `${r.key} (${r.name.toLowerCase()})`).join(", ")}. Unknown keys are ignored. The list rides in the confirmation token and is stored on confirmation; a later confirmation that names some replaces the earlier choice, one that names none keeps it.`,
                example: ["faster"],
              },
              desired_latency_ms: {
                type: "integer", minimum: MIN_DESIRED_LATENCY_MS, maximum: MAX_DESIRED_LATENCY_MS,
                description: "Required when wants includes faster; ignored otherwise. The desired end-to-end inference latency in milliseconds.",
                example: 100,
              },
            },
          } } },
        },
        responses: {
          "202": {
            description: "Confirmation email accepted by the mail provider. The address is not yet subscribed.",
            content: { "application/json": { schema: {
              type: "object", required: ["ok", "status"],
              properties: { ok: { const: true }, status: { const: "pending_confirmation" }, wants: { type: "array", items: { type: "string" }, description: "The roadmap keys that were accepted, in roadmap order." }, desired_latency_ms: { type: "integer", description: "Returned when faster inference was selected." } },
              example: { ok: true, status: "pending_confirmation", wants: ["faster"], desired_latency_ms: 100 },
            } } },
          },
          ...Object.fromEntries([
            ["400", "Missing or invalid email address."],
            ["429", "Too many signups; wait Retry-After seconds before retrying."],
            ["503", "Confirmation email unavailable; retry shortly."],
          ].map(([status, description]) => [status, {
            description,
            ...(status === "429" ? { headers: { "Retry-After": { schema: { type: "integer" } } } } : {}),
            content: { "application/json": { schema: { type: "object", required: ["error"], properties: { error: { type: "string" } } } } },
          }])),
        },
      },
    },
    "/subscribe/confirm": {
      post: {
        operationId: "confirmSubscription",
        summary: "Confirm mailbox ownership using the emailed token",
        description: "Submit the token from the confirmation email. Invalid or expired tokens cannot subscribe an address. Repeated confirmation is safe and never undoes an unsubscribe. GET renders a confirmation form without changing subscription state.",
        security: [],
        requestBody: { required: true, content: { "application/json": { schema: {
          type: "object", required: ["token"], properties: { token: { type: "string", maxLength: 1500 } },
        } } } },
        responses: {
          "200": { description: "Mailbox confirmed; existing unsubscribe preferences remain in effect.", content: { "application/json": { schema: {
            type: "object", required: ["ok", "status"], properties: { ok: { const: true }, status: { const: "confirmed" }, wants: { type: "array", items: { type: "string" }, description: "The roadmap keys recorded with the confirmation." }, desired_latency_ms: { type: "integer", description: "Returned when faster inference was selected." } },
          } } } },
          "400": { description: "Invalid or expired token. Subscribe again for a fresh email.", content: { "application/json": { schema: { type: "object", required: ["error"], properties: { error: { type: "string" } } } } } },
          "503": { description: "Confirmation storage unavailable. Retry the same token shortly.", content: { "application/json": { schema: { type: "object", required: ["error"], properties: { error: { type: "string" } } } } } },
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
        description: "This alias runs real inference with the same authentication, quotas and billing as /v1/classify, and adds an `x-sandbox` header. Request content is not stored; account usage and billing metadata are recorded. It is not a free or simulated billing environment.",
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
        summary: "Agents report a problem, suggestion or testimonial (feedback.now protocol). Returns a receipt to poll.",
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
                  required: ["version", "categories", "severity_levels", "evidence_types", "limits", "rate_limit_per_hour", "endpoints", "testimonial"],
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
                    testimonial: {
                      type: "object",
                      required: ["description", "preferred_endpoint", "required_reporter_fields", "example"],
                      properties: {
                        description: { type: "string" },
                        preferred_endpoint: { type: "string" },
                        required_reporter_fields: { type: "array", items: { type: "string" } },
                        example: { type: "object" },
                      },
                    },
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
    "/v1/systemone": {
      post: {
        operationId: "typeSafeSystemOne",
        summary: "Run the TypeSafe System One contract through classifier.dev.",
        description:
          "Wire-compatible with TypeSafe's POST /v1/systemone. The official JavaScript and Python SDKs work unchanged when their base URL is https://classifier.dev. " +
          "Use any non-empty placeholder API key for anonymous per-IP limits, or a classifier_agent_ workspace key to use workspace quota, credits and usage history. Free workspaces have the public ceilings and Pro workspaces get 10x limits. " +
          "classifier.dev never forwards caller credentials to TypeSafe. Choice, Noul, Score, structured state, model aliases, usage, validation errors and request IDs retain TypeSafe's shapes. Quota is counted by named questions, not requests. TypeSafe reference: https://docs.typesafe.ai/. " +
          "Images: set model to \"dgemma\" and add an images array of data URLs; the same questions are then answered about the images and the state by DiffusionGemma, never by Jev, and a body with images under another model is refused with images_unsupported.",
        tags: ["classify"],
        security: [{ accountKey: [] }, {}],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/TypeSafeSystemOneRequest" } } } },
        responses: {
          "200": {
            description: "The native TypeSafe System One response.",
            headers: { ...RATE_LIMIT_HEADERS, ...TYPESAFE_REQUEST_ID_HEADER, ...ACCOUNT_BILLING_HEADERS },
            content: { "application/json": { schema: { $ref: "#/components/schemas/TypeSafeSystemOneResponse" } } },
          },
          "422": {
            description: "TypeSafe request validation failed; body and request ID are preserved.",
            headers: { ...TYPESAFE_REQUEST_ID_HEADER, ...ACCOUNT_BILLING_HEADERS },
            content: { "application/json": { schema: { $ref: "#/components/schemas/TypeSafeValidationError" } } },
          },
          "401": { description: "The supplied classifier_agent_ workspace key is invalid or revoked.", content: { "application/json": { schema: { type: "object" } } } },
          "402": { description: "The workspace balance cannot cover the provider reservation; TypeSafe is not called.", content: { "application/json": { schema: { type: "object" } } } },
          "403": { description: "The workspace key is inactive or the workspace cannot authorize usage.", content: { "application/json": { schema: { type: "object" } } } },
          "413": { description: "The request body exceeds 1 MB.", content: { "application/json": { schema: { type: "object" } } } },
          "400": { description: "An image request was refused: images_unsupported (images under a model other than dgemma) or dgemma_input (a malformed image, too many images, or a schema the image-capable model refuses; its reason is the error).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "429": { description: "classifier.dev or TypeSafe rate limit; Retry-After or Retry-After-Ms is preserved. dgemma_busy when the image-capable model is saturated.", headers: { ...RATE_LIMIT_HEADERS, ...TYPESAFE_REQUEST_ID_HEADER, ...ACCOUNT_BILLING_HEADERS }, content: { "application/json": { schema: { type: "object" } } } },
          "502": { description: "TypeSafe could not be reached.", headers: ACCOUNT_BILLING_HEADERS, content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } } },
          "503": { description: "The compatibility endpoint or workspace billing is temporarily unavailable; dgemma_unavailable when the image-capable model is down or not configured.", headers: ACCOUNT_BILLING_HEADERS, content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } } },
        },
      },
    },
    "/v1/models": {
      get: {
        operationId: "listTypeSafeModels",
        summary: "List TypeSafe models and aliases in the official SDK shape.",
        description: "Wire-compatible with TypeSafe's GET /v1/models and consumed by client.models.list() / client.models.list().",
        tags: ["classify"],
        security: [],
        responses: {
          "200": {
            description: "Models available through classifier.dev's TypeSafe account.",
            headers: TYPESAFE_REQUEST_ID_HEADER,
            content: { "application/json": { schema: { $ref: "#/components/schemas/TypeSafeModelsResponse" } } },
          },
          "502": { description: "TypeSafe could not be reached.", content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } } },
          "503": { description: "The compatibility endpoint is not configured.", content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } } },
        },
      },
    },
    "/v1/long-context/jobs/{id}/create": {
      put: {
        operationId: "createLongContextJob", tags: ["classify"],
        summary: "Legacy manual-upload job creation; prefer one POST /v1/classify",
        description: "Choose a UUID once and reuse it on retries. Creation holds credits for max_tokens at $0.084/M original input tokens; final judgment settles the actual uploaded part-token count. Requires a funded workspace. No source text is stored at creation.",
        security: [{ accountKey: [] }], parameters: [JOB_ID],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["max_tokens", "documents", "labels"], properties: {
          max_tokens: { type: "integer", minimum: 1, maximum: LONG_CONTEXT_JOB_MAX_TOKENS },
          documents: { type: "integer", minimum: 1, maximum: 20 },
          labels: { type: "array", minItems: 2, maxItems: 100, items: { type: "string", maxLength: 200 } },
          instructions: { type: "string", maxLength: 4000 }, multi: { type: "boolean" }, tier: { const: "fast" },
        } } } } }, responses: { ...JOB_RESPONSE, "201": { description: "Job created and maximum charge reserved." } },
      },
    },
    "/v1/long-context/jobs/{id}/parts/{sequence}": {
      put: {
        operationId: "uploadLongContextPart", tags: ["classify"],
        summary: "Legacy manual part upload; not needed for whole-document jobs",
        description: `Upload source text in document order. Sequence starts at zero with no gaps, up to ${LONG_CONTEXT_MAX_PARTS.toLocaleString("en-US")} parts. Each part fits 1 MB JSON and ${LONG_CONTEXT_PART_MAX_TOKENS.toLocaleString("en-US")} cl100k_base tokens. The full source part is discarded after screening; only selected evidence remains until finish, cancel, or 24-hour expiry.`,
        security: [{ accountKey: [] }], parameters: [JOB_ID,
          { name: "sequence", in: "path", required: true, schema: { type: "integer", minimum: 0 } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["document", "text"], properties: {
          document: { type: "integer", minimum: 0, maximum: 19 }, text: { type: "string", minLength: 1 },
        } } } } }, responses: JOB_RESPONSE,
      },
    },
    "/v1/long-context/jobs/{id}/status": { get: {
      operationId: "getLongContextJob", tags: ["classify"], summary: "Read job progress or a completed result",
      description: "Automatic jobs progress from queued to processing to finished. context_tokens is the full original document; processed_tokens tracks screening. A finished job includes result with results, usage and pricing. A failed job includes error and refunds its hold. Results expire after 24 hours.",
      security: [{ accountKey: [] }], parameters: [JOB_ID], responses: JOB_RESPONSE,
    } },
    "/v1/long-context/jobs/{id}/finish": { post: {
      operationId: "finishLongContextJob", tags: ["classify"], summary: "Run final Jev judgment and settle the exact charge",
      description: "Requires at least one uploaded part per document. Eligible evidence may be omitted from the final 20,000-token budget per document. Provider failures keep the hold and may be retried before job expiry; no usable evidence returns 422 and refunds.",
      security: [{ accountKey: [] }], parameters: [JOB_ID],
      responses: { ...JOB_RESPONSE, "422": err("No usable evidence was selected; reservation refunded.") },
    } },
    "/v1/long-context/jobs/{id}/cancel": { post: {
      operationId: "cancelLongContextJob", tags: ["classify"], summary: "Refund an unfinished job",
      security: [{ accountKey: [] }], parameters: [JOB_ID], responses: JOB_RESPONSE,
    } },
    "/v1/classify": {
      post: {
        operationId: "classifyV1",
        summary: "Classify texts (v1). Identical to POST /.",
        description: "Identical to POST /. One complete Jev document supports 10M original cl100k_base tokens and a 100 MB upload. Prefer: respond-async, text/plain, a body above 1 MB or a single Jev input above 250k tokens returns 202 with a background job. The server screens every chunk then runs final Jev over selected evidence. Price: $0.084/M original tokens, reserved after upload; free/signup credit alone cannot enable jobs. Automatic jobs accept input (or one-element inputs/items), labels, instructions, multi, tier:fast and model:jev only. Other batches remain synchronous.",
        tags: ["classify"],
        parameters: DOCUMENT_PARAMETERS,
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyRequest" } }, "text/plain": { schema: { type: "string", description: "The entire UTF-8 document; supply labels in the query." } } },
        },
        responses: {
          "200": {
            description: "One result per input, in order.",
            headers: RATE_LIMIT_HEADERS,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ClassifyResponse" } } },
          },
          "202": DOCUMENT_ACCEPTED,
          ...ERRORS,
        },
      },
    },
    "/v1/classify/batch": {
      post: {
        operationId: "classifyBatchV1",
        summary: "Classify up to 1,000 texts synchronously.",
        description: "inputs takes up to 1,000 texts and results come back in the same order. This path retains synchronous limits; for one whole document up to 10M tokens/100 MB, use POST /v1/classify instead.",
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
            description: "The text to classify. For paid Jev long context above 32,000 characters, use POST /v1/classify with a funded workspace key. `input` and `q` are read as aliases; `classes` and `categories` as aliases of `labels`.",
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
        description: "Same synchronous and whole-document behavior as POST /v1/classify. One paid document supports 10M tokens in a 100 MB upload; automatic jobs return 202.",
        parameters: DOCUMENT_PARAMETERS,
        requestBody: {
          required: true,
          content: {
            "text/plain": { schema: { type: "string", description: "The entire UTF-8 document; supply labels in the query." } },
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
                  summary: "Smart batch (up to 200 inputs free; 1,000 with Pro or a partner key)",
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
          "202": DOCUMENT_ACCEPTED,
          ...ERRORS,
          "200": {
            description: "Classification results",
            headers: RATE_LIMIT_HEADERS,
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
            description: "The text to classify. For paid Jev long context above 32,000 characters, use POST /v1/classify with a funded workspace key.",
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
          "every other field raises the quality score the receipt reports. Testimonials additionally require `reporter.agent_type` " +
          "and `reporter.agent_description`. Vocabularies are the ones GET /api/v1/policy serves.",
        required: ["signal", "content"],
        allOf: [{
          if: {
            properties: { signal: { properties: { category: { const: "testimonial" } }, required: ["category"] } },
            required: ["signal"],
          },
          then: {
            required: ["reporter"],
            properties: {
              reporter: {
                required: ["agent_type", "agent_description"],
                properties: {
                  agent_type: { type: "string", pattern: "\\S" },
                  agent_description: { type: "string", pattern: "\\S" },
                },
              },
            },
          },
        }],
        properties: {
          reporter: {
            type: "object",
            description: "Who is reporting. Testimonials must identify the agent's type and briefly describe its work.",
            properties: {
              agent_vendor: { type: "string", maxLength: 64 },
              agent_product: { type: "string", maxLength: 64 },
              agent_version: { type: "string", maxLength: 64 },
              agent_type: { type: "string", maxLength: 64, description: "The agent's role or kind, such as `coding agent` or `support triage agent`. Required for testimonials." },
              agent_description: { type: "string", maxLength: LIMITS.max_agent_description_length, description: "A short description of what the agent does and how it used classifier.dev. Required for testimonials." },
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
        description: "The flat body POST /api/v1/observations reads: a category and one sentence. Testimonials also require agent_type and agent_description.",
        required: ["category", "summary"],
        allOf: [{
          if: { properties: { category: { const: "testimonial" } }, required: ["category"] },
          then: { required: ["agent_type", "agent_description"] },
        }],
        properties: {
          category: { type: "string", enum: [...CATEGORIES] },
          summary: { type: "string", pattern: "\\S", maxLength: LIMITS.max_summary_length },
          severity: { type: "string", enum: [...SEVERITIES], default: "medium" },
          confidence: { type: "number", minimum: LIMITS.confidence_range.min, maximum: LIMITS.confidence_range.max },
          surface: { type: "string", maxLength: 256 },
          domain: { type: "string", maxLength: 256 },
          agent_vendor: { type: "string", maxLength: 64 },
          agent_product: { type: "string", maxLength: 64 },
          agent_type: { type: "string", pattern: "\\S", maxLength: 64 },
          agent_description: { type: "string", pattern: "\\S", maxLength: LIMITS.max_agent_description_length },
        },
        example: { category: "friction", summary: "The 404 body names an endpoint that also 404s.", surface: "POST /v1/classify", domain: "classifier.dev" },
      },
      TypeSafeSystemOneRequest: {
        type: "object",
        required: ["state", "model", "questions"],
        properties: {
          state: TYPESAFE_ENTRY,
          model: { type: "string", description: "A name or alias returned by GET /v1/models, or \"dgemma\" for the image-capable DiffusionGemma model (required when images are sent)." },
          questions: { type: "object", minProperties: 1, additionalProperties: TYPESAFE_QUESTION },
          images: {
            type: "array", minItems: 1, maxItems: 4,
            items: { type: "string", pattern: "^data:image/(png|jpeg|webp|gif);base64,", maxLength: 900000 },
            description: "Images the questions are asked about, ahead of the state, as data URLs; at most 4 and 900,000 data URL characters in total. Only model \"dgemma\" reads them.",
          },
        },
        example: {
          state: { ticket: "I was charged twice. Please fix this today." },
          model: "jev-latest",
          questions: { category: { type: "choice", instructions: "Which team?", criteria: { billing: null, technical: null } } },
        },
      },
      TypeSafeSystemOneResponse: {
        type: "object",
        required: ["model", "answers", "usage"],
        properties: {
          model: { type: "string" },
          answers: {
            type: "object", minProperties: 1,
            additionalProperties: { oneOf: [TYPESAFE_ANSWER, { type: "null", description: "A question the dgemma service skipped because its ask_if condition was not met." }] },
          },
          usage: { type: "object", required: ["input_tokens", "output_tokens"], properties: {
            input_tokens: { type: "integer" }, output_tokens: { type: "integer" },
          } },
        },
      },
      TypeSafeModelsResponse: {
        type: "object", required: ["models"],
        properties: { models: { type: "array", items: { type: "object", required: ["name", "description", "release_date"], properties: {
          name: { type: "string" }, description: { type: "string" }, release_date: { type: "string", format: "date" },
        } } } },
      },
      TypeSafeValidationError: {
        type: "object",
        properties: { detail: { type: "array", items: { type: "object", required: ["loc", "msg", "type"], properties: {
          loc: { type: "array", items: { anyOf: [{ type: "string" }, { type: "integer" }] } },
          msg: { type: "string" }, type: { type: "string" }, input: {}, ctx: { type: "object" },
        } } } },
      },
      ClassifyRequest: {
        type: "object",
        description: "Long-context limits count documents × dimensions, or documents × labels in multi-label mode, as decisions (maximum 32). Long-context instructions are limited to 4,000 characters and labels to 200 characters each. Existing dedicated enterprise/operator access remains a trusted operational exception to the public funding requirement.",
        oneOf: [
          { required: ["labels"], not: { required: ["dimensions"] } },
          { required: ["dimensions"], not: { anyOf: [{ required: ["labels"] }, { required: ["multi"] }, { required: ["max_labels"] }] } },
        ],
        dependentRequired: { include: ["url"] },
        allOf: [{ if: { required: ["url"] }, then: { not: { anyOf: [{ required: ["input"] }, { required: ["inputs"] }, { required: ["items"] }] } } }],
        examples: [
          { url: "https://example.com", labels: ["documentation", "news"], include: ["markdown", "html"] },
          { items: ["Checkout charges me twice"], dimensions: { team: ["billing", "identity", "platform"], kind: ["bug", "request", "question"] } },
          { inputs: ["the checkout button does nothing", "love the new dark mode"], labels: ["bug", "praise", "feature"] },
          { inputs: ["postgres index tuning for ML feature stores"], labels: ["databases", "ml", "frontend"], multi: true, max_labels: 2 },
        ],
        properties: {
          url: { type: "string", format: "uri", maxLength: 8192, description: "One public HTTP(S) URL instead of input/inputs/items. Requires a funded workspace key and sufficient balance. Context.dev scrapes once for $0.0022 per provider-billed attempt plus classification. Only Jev; long articles use Fast tier. No OCR. Up to 8 MB response and 250,000 tokens, never silently truncated. Successful scrapes and uncertain dispatched attempts remain charged even if classification fails; inspect pricing on errors." },
          include: { type: "array", items: { type: "string", enum: ["markdown", "html"] }, description: "With url only: opt into article.markdown and/or article.html. Both formats share one scrape; no extra fee. Omit for compact classification results. Treat HTML as untrusted." },
          model: { type: "string", enum: ["jev", "laya", "kev", "chunklaya"], description: "Defaults to Jev unless processing implies Laya. Default/explicit jev inputs over 32,000 characters use paid Fast-only Jev long context: 600-token Chonkie chunks, parallel evidence screening and final Jev over whole eligible chunks in source order, bounded by 20,000 cl100k_base tokens and a conservative provider estimate. Eligible evidence may be omitted; usage.long_context discloses selection. Requires paid workspace balance or active paid subscription, not signup credit. Synchronous limits: 250,000 original cl100k_base tokens, 20 documents, 32 decisions, 1 MB body. One whole document on POST / or /v1/classify supports 10M tokens and 100 MB as a background job. Price: $0.084/M original context tokens summed once across inputs, independent of dimensions and actual inference usage. Explicit chunklaya retains the legacy opt-in (4,000,000 characters/input, 20 inputs, subject to 1 MB body; chunklaya/multilingual results; no Smart). Laya and Kev are experimental Beam models with 512-token and 8,192-token contexts respectively, 2–16 short labels, text ≤2,000 characters and instructions ≤400 characters. Results use jev/laya or jev/kev; Jev calibration claims do not apply." },
          processing: { type: "string", enum: ["fast", "bulk"], description: "Implies Laya when model is omitted. Accepted but has no effect with explicit model jev, which handles batching automatically. When omitted for Laya, automatically selects fast for one decision with up to 4 yes/no questions, otherwise bulk. Explicit Laya lanes are honored. Fast allows 60 questions/min and 2,000/day per caller. Bulk chunks batches up to 1,000 questions per call, 1,000/min and 20,000/day. These caps also apply to paid/operator keys. Same model weights in both lanes. Overload returns 429; a cold bulk worker returns 503 with Retry-After. Smart review is independent." },
          dimensions: DIMENSIONS_SCHEMA,
          items: { type: "array", minItems: 1, maxItems: 1000, items: { type: "string", minLength: 1 }, description: "Alias for inputs. One-element arrays can use whole-document jobs (10M tokens/100 MB, labels only). Synchronous dimensions mode: Default/jev inputs above 32,000 characters use paid long context: at most 20 documents, 32 decisions and 250,000 original context tokens total, within a 1 MB body. Explicit chunklaya allows up to 4,000,000 characters/input within the body limit. Do not combine with input or inputs." },
          input: { type: "string", description: "One complete document. POST / or /v1/classify automatically returns a background job above synchronous limits: up to 10M original tokens and 100 MB. No manual parts needed. Use Prefer: respond-async to request a job at any size. Provide this or inputs." },
          inputs: {
            type: "array",
            items: { type: "string" },
            maxItems: 1000,
            description: "Up to 1,000 texts classified in one call, results in the same order. Synchronous long context allows 20 documents, 32 decisions and 250,000 original context tokens total within 1 MB. One-element arrays on POST / or /v1/classify support automatic jobs up to 10M tokens/100 MB. Public smart requests accept at most 200 so the batch fits its per-minute quota.",
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
              "smart re-asks single-label answers below 0.7 confidence of a reasoning model; multi-label ignores it. Long context and explicit chunklaya refuse smart with 400 bad_tier. Read case-insensitively; any other value is a 400 bad_tier.",
          },
          instructions: { type: "string", description: "Extra criteria for the classifier." },
          multi: { type: "boolean", description: "Return every label that applies, with a score per label. true, \"true\", 1 and \"1\" all mean yes." },
          max_labels: { type: "integer", minimum: 1, description: "Cap on how many multi-label answers come back; implies multi. A numeric string is read; zero or less means no cap; a fraction is rounded down." },
        },
      },
      TokenUsage: {
        type: "object",
        properties: {
          long_context: { $ref: "#/components/schemas/LongContextUsage" },
          input_tokens: { type: ["integer", "null"], description: "Provider-reported input tokens across all answered calls, including smart escalation. Null if any count is unavailable." },
          output_tokens: { type: ["integer", "null"] },
          total_tokens: { type: ["integer", "null"], description: "Input plus output; null if either is unknown." },
          cached_input_tokens: { type: ["integer", "null"], description: "Subset of input tokens, never added again to total_tokens." },
          models: { type: "array", items: { type: "object", properties: {
            provider: { type: "string" }, model: { type: "string" }, calls: { type: "integer" },
            input_tokens: { type: ["integer", "null"] }, output_tokens: { type: ["integer", "null"] }, cached_input_tokens: { type: ["integer", "null"] },
          } } },
        },
      },
      LongContextUsage: {
        type: "object",
        description: "Jev long-context processing totals. Documents/context tokens count original inputs once; chunk and selection counts and phase usage accumulate across dimension passes, not necessarily unique passages. Calls count answered provider calls, not attempts. Unknown provider token counts remain null. Final Jev sees selected evidence; eligible whole chunks may be omitted when the final context budget fills. No guarantee of full-document final reading or universal accuracy.",
        properties: {
          context_tokens: { type: "integer", minimum: 0, description: "Original input cl100k_base tokens summed once across inputs, independent of dimensions. Retail basis at $0.084/M, not actual screening/final usage." },
          documents: { type: "integer", minimum: 0 },
          chunks: { type: "integer", minimum: 0 },
          screened_chunks: { type: "integer", minimum: 0 },
          eligible_chunks: { type: "integer", minimum: 0, description: "Relevant or uncertain chunks eligible for final classification, including opposing evidence and exceptions." },
          selected_chunks: { type: "integer", minimum: 0 },
          omitted_chunks: { type: "integer", minimum: 0, description: "Eligible chunks omitted from final evidence due to context limits." },
          screening_input_tokens: { type: ["integer", "null"], minimum: 0 },
          final_input_tokens: { type: ["integer", "null"], minimum: 0 },
          screening_calls: { type: "integer", minimum: 0 },
          final_calls: { type: "integer", minimum: 0 },
          screening_ms: { type: "number", minimum: 0 },
          final_ms: { type: "number", minimum: 0 },
          tokenizer: { type: "string", const: "cl100k_base" },
        },
      },
      ClassificationPricing: {
        type: "object",
        description: "USD customer pricing, separate from upstream provider spend. total_usd is zero for unbilled requests, null when unknown, and before credit rounding. Pending settlement is not a receipt. Ordinary pricing.input_tokens includes billable primary calls; Jev long context uses original cl100k_base context tokens summed once across inputs at $0.084/M, independent of dimensions and actual screening/final usage. Plain-text responses and TypeSafe-compatible responses retain their existing shapes.",
        properties: {
          scrape_requests: { type: "integer", minimum: 0, maximum: 1 },
          usd_per_scrape: { type: "number", const: 0.0022 },
          scrape_usd: { type: "number", description: "Retained scrape charge, including on errors after a billed or uncertain provider attempt." },
          classification_usd: { type: ["number", "null"] },
          currency: { const: "USD" }, rate_version: { type: "string" },
          basis: { type: "string", const: "original_context_tokens", description: "Present for Jev long context." },
          tokenizer: { type: "string", const: "cl100k_base", description: "Present for Jev long-context billing." },
          billing_status: { enum: ["not_billed", "pending", "settled", "review"] },
          total_usd: { type: ["number", "null"] },
          estimated_usd: { type: ["number", "null"], description: "Published classification price before free access or settlement; not an additional charge." },
          input_tokens: { type: ["integer", "null"] }, escalations: { type: "integer" },
          input_usd_per_million: { type: "number" }, usd_per_escalation: { type: "number" },
          models: { type: "array", description: "Legacy token-billed workspaces: the applied rate per provider/model, instead of the input-plus-escalation tariff.", items: { type: "object", properties: {
            provider: { type: "string" }, model: { type: "string" },
            input_usd_per_million: { type: ["number", "null"] }, output_usd_per_million: { type: ["number", "null"] }, cached_input_usd_per_million: { type: ["number", "null"] },
          } } },
        },
      },
      SingleResult: {
        type: "object",
        properties: {
          usage: { $ref: "#/components/schemas/TokenUsage" },
          pricing: { $ref: "#/components/schemas/ClassificationPricing" },
          article: { type: "object", properties: { url: { type: "string" }, title: { type: "string" }, markdown: { type: "string" }, html: { type: "string" } } },
          label: { type: "string" },
          confidence: {
            type: ["number", "null"],
            description:
              "0 to 1, calibrated: how likely the chosen label is right among your labels. Measured on six-way emotion, answers >= 0.9 were right 82% of the time and answers < 0.5 were right 29%. It is not a fit score \u2014 text matching none of your categories still gets one; add a label such as 'none of these' for that. Null when the provider returns no score or the smart tier replaces the scored answer.",
          },
          scores: {
            type: ["object", "null"],
            additionalProperties: { type: "number" },
            description: "Model preference per supplied label. Sums to 1 for single-label; independent per label for multi-label. Does not validate the input or guarantee correctness.",
          },
          escalated: {
            type: "boolean",
            description: "Present and true on the smart tier when the answer was re-asked of the reasoning model; confidence and scores are null because the reasoning model does not return comparable probabilities.",
          },
          unscored: {
            type: "string",
            description:
              "Explains why confidence and scores are unavailable, such as smart escalation without comparable probabilities. Route to review when a numeric confidence is required.",
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
      DimensionResult: {
        type: "object", required: ["label", "confidence", "scores", "model", "ms"],
        properties: {
          label: { type: "string" },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1, description: "Jev's distribution-derived confidence. Null when the provider returns no score or after smart escalation; not a literal probability of correctness." },
          scores: { type: ["object", "null"], additionalProperties: { type: "number", minimum: 0, maximum: 1 }, description: "Model preference per supplied label; does not validate the input or guarantee correctness." },
          model: { type: "string" }, ms: { type: "integer" },
          escalated: { type: "boolean" }, unscored: { type: "string" },
        },
      },
      ClassifyResponse: {
        type: "object",
        properties: {
          pricing: { $ref: "#/components/schemas/ClassificationPricing" },
          article: { type: "object", properties: { url: { type: "string" }, title: { type: "string" }, markdown: { type: "string" }, html: { type: "string" } } },
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
                dimensions: { type: "object", additionalProperties: { $ref: "#/components/schemas/DimensionResult" }, description: "Dimensions mode: one field result per supplied dimension, in an input-ordered results array." },
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
            allOf: [{ $ref: "#/components/schemas/TokenUsage" }],
            properties: {
              items: { type: "integer", description: "Dimensions mode: number of input items." },
              dimensions: { type: "integer", description: "Dimensions mode: number of fields per item." },
              fallback: { type: "integer", description: "Dimensions mode: fields served by the LLM fallback because Jev was unavailable." },
              classifications: { type: "integer", description: "Decisions made. In dimensions mode, items multiplied by dimensions; each counts toward the quota." },
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
      SkillSummary: {
        type: "object",
        required: ["slug", "name", "description", "summary", "score", "category", "tags", "submitted", "url", "raw"],
        properties: {
          slug: { type: "string" }, name: { type: "string" }, description: { type: "string" },
          summary: { type: "string", description: "The reviewer's one line." },
          score: { type: "integer", minimum: 0, maximum: 100 },
          category: { type: "string" }, tags: { type: "array", items: { type: "string" } },
          author: { type: "string" }, submitted: { type: "string", format: "date-time" },
          url: { type: "string", format: "uri" }, raw: { type: "string", format: "uri", description: "The bare SKILL.md." },
        },
      },
      SkillList: {
        type: "object", required: ["count", "skills"],
        properties: { count: { type: "integer" }, skills: { type: "array", items: { $ref: "#/components/schemas/SkillSummary" } }, submit: { type: "string" }, page: { type: "string", format: "uri" } },
      },
      SkillReview: {
        type: "object", required: ["reviewed", "jev", "judge", "score", "warnings"],
        properties: {
          reviewed: { type: "string", format: "date-time" },
          score: { type: "integer", minimum: 0, maximum: 100, description: "0.4 usefulness + 0.25 novelty + 0.2 clarity + 0.15 safety, times 10." },
          warnings: { type: "array", items: { type: "object", properties: { rule: { type: "string" }, severity: { type: "string", enum: ["block", "warn"] }, message: { type: "string" }, line: { type: "integer" }, excerpt: { type: "string" } } } },
          jev: { type: "object", description: "Calibrated probabilities from the decision model.", properties: { malicious: { type: "number" }, risky: { type: "number" }, benign: { type: "number" }, genuine: { type: "number" }, useful: { type: "number" }, spam: { type: "number" }, model: { type: "string" } } },
          judge: { type: "object", description: "The reasoning model's scores, out of 10, with reasons.", properties: { safety: { type: "integer" }, usefulness: { type: "integer" }, novelty: { type: "integer" }, clarity: { type: "integer" }, verdict: { type: "string", enum: ["accept", "reject"] }, summary: { type: "string" }, category: { type: "string" }, tags: { type: "array", items: { type: "string" } }, concerns: { type: "array", items: { type: "string" } }, notes: { type: "string" }, model: { type: "string" } } },
        },
      },
      Skill: {
        type: "object", required: ["slug", "name", "description", "content", "submitted", "review", "url", "raw"],
        properties: {
          slug: { type: "string" }, name: { type: "string" }, description: { type: "string" },
          content: { type: "string", description: "The SKILL.md as submitted." },
          author: { type: "string" }, source: { type: "string" }, submitted: { type: "string", format: "date-time" },
          review: { $ref: "#/components/schemas/SkillReview" },
          url: { type: "string", format: "uri" }, raw: { type: "string", format: "uri" }, install: { type: "string", description: "A shell line that saves it where Claude Code looks for skills." },
        },
      },
      SkillAccepted: {
        type: "object", required: ["accepted", "url", "skill"],
        properties: { accepted: { const: true }, url: { type: "string", format: "uri" }, raw: { type: "string", format: "uri" }, skill: { $ref: "#/components/schemas/Skill" }, ms: { type: "integer" } },
      },
      SkillRejected: {
        type: "object", required: ["accepted", "stage", "reasons"],
        properties: {
          accepted: { const: false },
          stage: { type: "string", enum: ["cleaners", "jev", "judge"], description: "Which pass refused it." },
          reasons: { type: "array", items: { type: "string" } },
          findings: { type: "array", items: { type: "object" }, description: "Every scanner finding, blocks and warnings." },
          jev: { type: "object" }, judge: { type: "object" }, next: { type: "string" }, ms: { type: "integer" },
        },
      },
      Error: {
        type: "object",
        required: ["error", "code"],
        properties: {
          pricing: { $ref: "#/components/schemas/ClassificationPricing", description: "On admitted URL requests, reports any retained scrape charge even when classification fails." },
          error: { type: "string", description: "Human-readable message saying what to change." },
          code: {
            type: "string",
            description:
              "Stable machine-readable code: one of the listed values, or typesafe_<status> / openrouter_<status> carrying the upstream HTTP status. " +
              "Long context: 400 long_context_input or long_context_too_large; 402 long_context_payment_required; 422 long_context_no_evidence (no charge); 503 long_context_unavailable. " +
              "400: bad_dimensions, too_many_decisions, dimension_context_too_large, bad_json, no_input, too_many_inputs, too_few_labels, too_many_labels, empty_label, duplicate_labels, empty_input, input_too_long, bad_tier, bad_cursor, invalid_submission, skill_invalid, account_route_required (use POST /v1/classify with a workspace key). " +
              "404: not_found. 409: duplicate_skill. 429: rate_limit_minute, rate_limit_day, rate_limit_hour, label_set_limit. 502: typesafe, typesafe_<status>, openrouter_<status>, chain_exhausted, batch_unavailable, timeout, upstream_other. 500: internal. 503: review_unavailable, inference_unavailable (provider credentials are not configured), label_set_unavailable (label allowance could not be checked; inference did not start).",
            anyOf: [{ enum: [...ERROR_CODES] }, { pattern: UPSTREAM_CODE_PATTERN }],
          },
          retryable: { type: "boolean", description: "Whether retrying later can resolve a spending refusal. Use backoff and Retry-After; do not loop on false." },
          action: { type: "string", description: "Concrete changes or next steps for the caller." },
          docs: { type: "string", format: "uri" },
          limitUsd: { type: "number", description: "The applicable provider spending ceiling in USD." },
          availableUsd: { type: "number", description: "Unreserved provider allowance remaining in USD." },
          requestId: { type: "string", description: "Original workspace operation ID on a duplicate." },
          upgrade: { type: "string", format: "uri", description: "On a free-tier 429: the page where a plan lifts this limit (https://classifier.dev/pricing). Absent on Pro and partner keys." },
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
        schema: { type: "string", maxLength: 200 },
        description: "Optional replay protection. Whole-document jobs require a UUID and return 202 with the same job on retry, without executing or charging again; reuse only for the same document. Otherwise a previously admitted key returns 409 without executing again; responses are not cached. Free keys are scoped to the IP network and UTC day. Workspace keys are scoped to the workspace.",
      },
    },
    securitySchemes: {
      accountKey: {
        type: "http", scheme: "bearer",
        description: "Workspace API key (classifier_agent_...) managed at /app/keys. Required for account reads; optional on classification and TypeSafe-compatible endpoints to use workspace quota and credits.",
      },
      partnerKey: {
        type: "http",
        scheme: "bearer",
        description: "Optional for classification. Workspace keys (classifier_agent_...) use the workspace balance and quotas; Pro workspaces get 10x limits. Partner keys have separately arranged access. See https://classifier.dev/auth.md.",
      },
    },
  },
} as const;

export const LLMS_TXT = `# classifier.dev

URL classification: POST /v1/classify with url, labels (or dimensions), and optional include: ["markdown","html"]. Funded workspace key required. Context.dev scraping: $2.20/1,000 requests plus normal classification. MCP: classify_texts, classify_dimensions, classify_multi_label accept url and include. Read pricing even on errors.

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
or routing texts into label-based pipeline branches. Each of those classifies many
things without pulling them into context. Under about five items, just decide
yourself.

## Confidence

The confidence is calibrated: on six-way emotion, answers at >= 0.9 were right
82% of the time and answers below 0.5 were right 29%. Act on the sure ones and
look at the rest yourself, or pass tier "smart" and answers under 0.7 are
re-asked of a reasoning model for you. It is not a fit score: add a label such
as "none of these" when none-of-the-above is a real outcome.

Check for null before comparing thresholds. Provider scores can be unavailable,
and smart-escalated answers have null confidence and scores because the
replacement model does not return comparable probabilities. Route nulls to
review. Scores express the model's choice among your labels; they do not validate
the input or guarantee that the choice is correct. Neither tier guarantees
identical answers across calls.
POST multi-label results have labels (an array) and scores; they omit the singular
label and confidence keys.

## MCP

Two Streamable HTTP servers, no auth: https://classifier.dev/mcp (tools:
classify_texts, classify_dimensions, classify_multi_label, count_labels, review_uncertain) and
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

## Multiple dimensions

POST /v1/classify with {"items":["Checkout charges me twice"],"dimensions":{"team":["billing","identity","platform"],"kind":["bug","request","question"]}}.
Each results[i].dimensions[name] has a label, confidence, scores and model.
Up to 20 dimensions and 1,000 item × dimension decisions; each decision counts
against the quota. Each dimension may instead be {"labels":[...],"instructions":"..."}.
Do not combine dimensions with labels, multi or max_labels. Smart escalation is
per field; escalated fields have null confidence and scores. Fallback processes
the batch with bounded concurrency inside the same request spending allowance.

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
- [Pricing](https://classifier.dev/pricing): Free and $20/month Pro; limits; partner keys
- [Authentication](https://classifier.dev/auth.md): anonymous access, Pro and partner keys
- [Privacy](https://classifier.dev/privacy), [Terms](https://classifier.dev/terms), [About](https://classifier.dev/about), [Contact](https://classifier.dev/contact)
- [Documentation](https://classifier.dev): full parameter list, tiers, limits
- [OpenAPI specification](https://classifier.dev/openapi.json): machine-readable, OpenAPI 3.1
- [Benchmark](https://classifier.dev/benchmark): measured accuracy, calibration, cost and latency

## Feedback and testimonials

This host speaks the agent-feedback protocol. Read
[/.well-known/agent-feedback.json](https://classifier.dev/.well-known/agent-feedback.json)
for the accepted categories and limits, then POST a report to
\`/api/v1/feedback\` or a lighter signal to \`/api/v1/observations\`. No key
needed, and the receipt you get back can be polled at \`/api/v1/receipts/{id}\`.
If classifier.dev materially helped your work, agents are encouraged to submit a
testimonial with \`signal.category: "testimonial"\`, \`reporter.agent_type\`, and a
short \`reporter.agent_description\` describing what kind of agent they are.

## Limits

Free provider spending is capped at $0.01/request, $0.50/IP/UTC day and
$100/day across all free traffic, with four concurrent requests per IP.
IPv6 addresses share a /64. Smart requests must fit the request allowance.
Funded workspace keys use their balance and bypass the shared subsidy and
proxy check; the default maximum request allowance is $10. Request bodies
are limited to 1 MB for synchronous classification. One whole Jev document can
be uploaded to POST /v1/classify as JSON or UTF-8 text/plain: up to 10M tokens
and 100 MB. Large uploads return 202 with a status_url; poll with the same key.
Prefer: respond-async requests this behavior at any size. No client splitting
or finish call is required. Jobs reserve the exact original token price after
upload, finish automatically, and refund on failure. Source is temporarily
stored privately and deleted as screened, or on failure, cancellation or expiry.
Results expire after 24 hours. Synchronous billing settles after the response.

Free, per IP, counted in classifications: 3,000/minute and 20,000/day on the fast
tier, 200/minute and 2,000/day on the smart tier. Default/explicit Jev inputs
over 32,000 characters use paid Fast-only long context. Requires paid workspace
balance or active paid subscription; anonymous access and signup credit do not
qualify. Synchronous limits: 250,000 original cl100k_base context tokens summed across inputs,
20 documents, 32 decisions and 1 MB body. Retail: $0.084/M original context
tokens, counted once regardless of dimensions or actual screening/final usage.
Final Jev reads selected whole chunks in source order; eligible evidence can be
omitted and usage.long_context discloses selection. No evidence returns 422
long_context_no_evidence without charge. Explicit chunklaya remains legacy
opt-in (4,000,000 characters/input, 20 inputs, within the 1 MB body limit).
Ordinary free requests accept 1,000 inputs on fast or 200 on smart.
Pro workspaces get 10x minute and daily limits shared across keys and agents,
and up to 1,000 inputs on either tier. Current plans are at
https://classifier.dev/pricing.
Exceeding a limit returns 429 with Retry-After.

## Contact

- [Book a call](https://cal.com/michaelsf/coffee) or email contact@classifier.dev for higher limits
- On request: a dedicated deployment in your own cloud (AWS, GCP or another), private end-to-end encrypted inference, higher accuracy or lower latency from a model tuned to your data. Terms at [classifier.dev/pricing](https://classifier.dev/pricing)
`;
