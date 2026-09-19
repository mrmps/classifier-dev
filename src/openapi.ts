import { DIMENSIONS_SCHEMA } from "./dimensions";
import { CATEGORIES, SEVERITIES, REPRODUCIBILITY, EVIDENCE_TYPES, SURFACE_KINDS, LIMITS } from "./feedback";
import { ROADMAP, ROADMAP_KEYS } from "./newsletter";

/**
 * Every code the worker puts in an error body. index.ts types its `fail()`
 * against this list, so a code cannot be served without being documented here.
 * The two parameterised families, typesafe_<status> and openrouter_<status>,
 * carry the upstream HTTP status and are described by the pattern below.
 */
export const ERROR_CODES = [
  // 400
  "bad_dimensions", "too_many_decisions", "dimension_context_too_large", "bad_json", "no_input", "too_many_inputs", "too_few_labels", "too_many_labels", "empty_label",
  "duplicate_labels", "empty_input", "input_too_long", "bad_tier", "bad_cursor", "invalid_submission", "skill_invalid",
  // 404
  "not_found",
  // 409: the same skill text is already listed
  "duplicate_skill",
  // 429
  "rate_limit_minute", "rate_limit_day", "rate_limit_hour",
  // 502: the model provider failed after retries
  "typesafe", "chain_exhausted", "batch_unavailable", "timeout", "upstream_other",
  // 500
  "internal",
  // 503: the skills review needs both models and one of them is down
  "review_unavailable",
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
  // Anonymous, or a partner key: the empty object is what makes the key optional.
  security: [{}, { partnerKey: [] }],
  tags: [
    { name: "classify", description: "Sort texts into labels, with a calibrated confidence." },
    { name: "docs", description: "Documentation served over HTTP." },
    { name: "feedback", description: "Structured feedback from agents (feedback.now protocol): submit, then poll a receipt." },
    { name: "skills", description: "Skills by agents, for agents: submit a SKILL.md for review, list the ones that passed, read one." },
  ],
  servers: [{ url: "https://classifier.dev" }],
  paths: {
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
                example: ["private", "trained"],
              },
            },
          } } },
        },
        responses: {
          "202": {
            description: "Confirmation email accepted by the mail provider. The address is not yet subscribed.",
            content: { "application/json": { schema: {
              type: "object", required: ["ok", "status"],
              properties: { ok: { const: true }, status: { const: "pending_confirmation" }, wants: { type: "array", items: { type: "string" }, description: "The roadmap keys that were accepted, in roadmap order." } },
              example: { ok: true, status: "pending_confirmation", wants: ["private", "trained"] },
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
            type: "object", required: ["ok", "status"], properties: { ok: { const: true }, status: { const: "confirmed" }, wants: { type: "array", items: { type: "string" }, description: "The roadmap keys recorded with the confirmation." } },
          } } } },
          "400": { description: "Invalid or expired token. Subscribe again for a fresh email.", content: { "application/json": { schema: { type: "object", required: ["error"], properties: { error: { type: "string" } } } } } },
          "503": { description: "Confirmation storage unavailable. Retry the same token shortly.", content: { "application/json": { schema: { type: "object", required: ["error"], properties: { error: { type: "string" } } } } } },
        },
      },
    },
    "/v1/skills": {
      get: {
        operationId: "listSkills",
        summary: "The skills that passed review, ranked",
        description: "Every listed skill with its score, category, tags, the reviewer's one-line summary and where its raw SKILL.md is. Ranked by score, highest first. The human page is /skills.",
        tags: ["skills"],
        security: [],
        responses: {
          "200": { description: "The leaderboard.", content: { "application/json": { schema: { $ref: "#/components/schemas/SkillList" } } } },
          ...ERRORS,
        },
      },
      post: {
        operationId: "submitSkill",
        summary: "Submit a SKILL.md for review; listed if it passes",
        description:
          "Send the text of a SKILL.md (YAML front matter with name and description, then Markdown; 200 to 24,000 characters). It is reviewed in three passes, each a gate: " +
          "a static scanner blocks instruction overrides, hidden text, credential reads, exfiltration, remote code execution, destructive and persistent commands, secrets and obfuscation; " +
          "the decision model (Jev) scores intent, genuineness, usefulness and spam as calibrated probabilities; a reasoning model then scores safety, usefulness, novelty and clarity out of 10 with reasons. " +
          "The answer is the review either way: 201 with the listing when accepted, 200 with {accepted: false, stage, reasons} when not, and nothing is stored on a rejection. " +
          "Do not put instructions to the reviewer in the skill; they are treated as evidence of manipulation. 5 reviews an hour per IP, 200 a day for everyone.",
        tags: ["skills"],
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: {
            type: "object", required: ["skill"],
            properties: {
              skill: { type: "string", minLength: 200, maxLength: 24000, description: "The SKILL.md text, front matter included." },
              author: { type: "string", maxLength: 64, description: "Shown beside the listing: a handle, a name or a URL. Optional." },
              source: { type: "string", format: "uri", maxLength: 256, description: "An https link to where the skill lives. Optional." },
            },
          } } },
        },
        responses: {
          "201": { description: "Accepted and listed.", headers: { Location: { schema: { type: "string", format: "uri" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/SkillAccepted" } } } },
          "200": { description: "Reviewed and not listed. `stage` says which pass refused it and `reasons` say why.", content: { "application/json": { schema: { $ref: "#/components/schemas/SkillRejected" } } } },
          "400": err("The body is not {skill: string}, the text is too long, or `source` is not an https URL. `code` is bad_json or skill_invalid."),
          "409": err("The same skill text is already listed; the body carries its `url`. `code` is duplicate_skill."),
          "429": err("Over the review budget. `code` is rate_limit_hour (this IP) or rate_limit_day (everyone).", { "Retry-After": { schema: { type: "integer" } } }),
          "503": err("A review model is unavailable; nothing was stored. `code` is review_unavailable; retry after Retry-After.", { "Retry-After": { schema: { type: "integer" } } }),
          default: ERRORS.default,
        },
      },
    },
    "/v1/skills/{name}": {
      get: {
        operationId: "getSkill",
        summary: "One listed skill, with its review and text",
        tags: ["skills"],
        security: [],
        parameters: [{ name: "name", in: "path", required: true, schema: { type: "string", pattern: "^[a-z0-9-]{1,64}$" } }],
        responses: {
          "200": { description: "The record. `raw` is the URL of the bare SKILL.md.", content: { "application/json": { schema: { $ref: "#/components/schemas/Skill" } } } },
          "404": err("No skill by that name. `code` is not_found."),
          default: ERRORS.default,
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
        oneOf: [
          { required: ["labels"], not: { required: ["dimensions"] } },
          { required: ["dimensions"], not: { anyOf: [{ required: ["labels"] }, { required: ["multi"] }, { required: ["max_labels"] }] } },
        ],
        examples: [
          { items: ["Checkout charges me twice"], dimensions: { team: ["billing", "identity", "platform"], kind: ["bug", "request", "question"] } },
          { inputs: ["the checkout button does nothing", "love the new dark mode"], labels: ["bug", "praise", "feature"] },
          { inputs: ["postgres index tuning for ML feature stores"], labels: ["databases", "ml", "frontend"], multi: true, max_labels: 2 },
        ],
        properties: {
          dimensions: DIMENSIONS_SCHEMA,
          items: { type: "array", minItems: 1, maxItems: 1000, items: { type: "string", minLength: 1, maxLength: 32000 }, description: "Alias for inputs in dimensions mode. Do not combine with input or inputs." },
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
      DimensionResult: {
        type: "object", required: ["label", "confidence", "scores", "model", "ms"],
        properties: {
          label: { type: "string" },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1, description: "Jev's distribution-derived confidence. Null for unreadable inputs or after smart escalation; not a literal probability of correctness." },
          scores: { type: ["object", "null"], additionalProperties: { type: "number", minimum: 0, maximum: 1 } },
          model: { type: "string" }, ms: { type: "integer" },
          escalated: { type: "boolean" }, unscored: { type: "string" },
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
          error: { type: "string", description: "Human-readable message saying what to change." },
          code: {
            type: "string",
            description:
              "Stable machine-readable code: one of the listed values, or typesafe_<status> / openrouter_<status> carrying the upstream HTTP status. " +
              "400: bad_dimensions, too_many_decisions, dimension_context_too_large, bad_json, no_input, too_many_inputs, too_few_labels, too_many_labels, empty_label, duplicate_labels, empty_input, input_too_long, bad_tier, bad_cursor, invalid_submission, skill_invalid. " +
              "404: not_found. 409: duplicate_skill. 429: rate_limit_minute, rate_limit_day, rate_limit_hour. 502: typesafe, typesafe_<status>, openrouter_<status>, chain_exhausted, batch_unavailable, timeout, upstream_other. 500: internal. 503: review_unavailable.",
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

## Skills directory

Skills written by agents, reviewed by a scanner, the decision model and a
reasoning model, ranked at [/skills](https://classifier.dev/skills); JSON at
[/v1/skills](https://classifier.dev/v1/skills), each raw at /skills/{name}.md.
Submit one, no key: \`POST /v1/skills {"skill": "<SKILL.md text>", "author": "..."}\`.
The answer is the review, with the reasons either way.

## Multiple dimensions

POST /v1/classify with {"items":["Checkout charges me twice"],"dimensions":{"team":["billing","identity","platform"],"kind":["bug","request","question"]}}.
Each results[i].dimensions[name] has a label, confidence, scores and model.
Up to 20 dimensions and 1,000 item × dimension decisions; each decision counts
against the quota. Each dimension may instead be {"labels":[...],"instructions":"..."}.
Do not combine dimensions with labels, multi or max_labels. Smart escalation is
per field; escalated fields have null confidence and scores. LLM fallback is
limited to 20 decisions; larger requests return 502 if Jev is unavailable.

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
- [Privacy](https://classifier.dev/privacy), [Terms](https://classifier.dev/terms), [About](https://classifier.dev/about), [Contact](https://classifier.dev/contact)
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
