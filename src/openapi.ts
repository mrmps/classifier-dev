/** Served at /openapi.json and /.well-known/openapi.json */
export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "classifier.dev",
    version: "2.0.0",
    summary: "Zero-shot text classification with calibrated confidence. No API key, no account.",
    description:
      "Send text and a list of labels, receive the label that fits, a calibrated confidence " +
      "and a score per label. Up to 1,000 texts per request, ~1s. Tiers: fast (default) and " +
      "smart, which re-asks answers below 0.7 confidence of a fast reasoning model. " +
      "Limits are per IP and counted in classifications: 1,000/min and 20,000/day on fast, " +
      "200/min and 2,000/day on smart. Benchmarks: https://classifier.dev/benchmark",
    contact: { name: "Book a call", url: "https://cal.com/michaelsf/coffee" },
  },
  servers: [{ url: "https://classifier.dev" }],
  paths: {
    "/": {
      get: {
        operationId: "getDocs",
        summary: "Human- and agent-readable documentation as plain text.",
        responses: {
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
          "200": {
            description: "Classification results",
            headers: {
              "X-RateLimit-Limit": { schema: { type: "string" }, description: "e.g. 1000/min" },
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
          model: { type: "string" },
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
      Error: { type: "object", properties: { error: { type: "string" } } },
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

- [Skill](https://classifier.dev/skill.md): when to reach for this, batching, confidence, pitfalls
- [Documentation](https://classifier.dev): full parameter list, tiers, limits
- [OpenAPI specification](https://classifier.dev/openapi.json): machine-readable, OpenAPI 3.1
- [Benchmark](https://classifier.dev/benchmark): measured accuracy, calibration, cost and latency

## Limits

Per IP, counted in classifications: 1,000/minute and 20,000/day on the fast
tier, 200/minute and 2,000/day on the smart tier. Inputs cap at 32,000
characters, 1,000 per request. Exceeding a limit returns 429 with Retry-After.

## Contact

- [Book a call](https://cal.com/michaelsf/coffee) for higher limits or a tuned classifier
`;
