/** Served at /openapi.json and /.well-known/openapi.json */
export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "classifier.dev",
    version: "1.0.0",
    summary: "Zero-shot text classification. No API key, no account.",
    description:
      "Send text and a list of labels, receive the label that fits. Two tiers: " +
      "fast (single-token, ~450ms) and smart (native reasoning, ~2.4s). " +
      "Limits are per IP and counted in classifications: 60/min and 5,000/day on fast, " +
      "10/min and 500/day on smart. Benchmarks: https://classifier.dev/benchmark",
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
                  summary: "Up to 20 inputs, smart tier",
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
              "X-RateLimit-Limit": { schema: { type: "string" }, description: "e.g. 60/min" },
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
          "Add ?verbose=1 for JSON including confidence and per-label scores.",
        parameters: [
          {
            name: "labels",
            in: "path",
            required: true,
            description: "Comma-separated categories, 2 to 26 of them.",
            schema: { type: "string" },
            example: "spam,not+spam",
          },
          {
            name: "text",
            in: "path",
            required: true,
            description: "The text to classify, up to roughly 8,000 tokens.",
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
            maxItems: 20,
            description: "Up to 20 texts classified in one call.",
          },
          labels: {
            type: "array",
            items: { type: "string" },
            minItems: 2,
            maxItems: 26,
            description: "Semantic category names. 'urgent bug' classifies better than 'p0'.",
          },
          tier: { type: "string", enum: ["fast", "smart"], default: "fast" },
          instructions: { type: "string", description: "Extra criteria for the classifier." },
        },
      },
      SingleResult: {
        type: "object",
        properties: {
          label: { type: "string" },
          confidence: {
            type: ["number", "null"],
            description:
              "0 to 1. How sure the model is of the label it picked, NOT whether the text fits any label \u2014 a well-formed sentence matching none of your categories can still score 1.0. Null either because the provider returned no logprobs (certainty high) or because the score was withheld; see unscored. For a real 'no fit' answer, add a label such as 'none'.",
          },
          scores: { type: ["object", "null"], additionalProperties: { type: "number" } },
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
                ms: { type: "integer" },
              },
            },
          },
          usage: {
            type: "object",
            properties: { classifications: { type: "integer" }, ms: { type: "integer" } },
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
> Send text and a list of labels, get back the label that fits.

Quickest possible call:

    curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone+now
    spam

JSON:

    curl https://classifier.dev -d '{"input":"...","labels":["a","b"]}'

## Docs

- [Documentation](https://classifier.dev): full parameter list, tiers, limits
- [OpenAPI specification](https://classifier.dev/openapi.json): machine-readable, OpenAPI 3.1
- [Benchmark](https://classifier.dev/benchmark): measured accuracy, cost and latency

## Limits

Per IP, counted in classifications: 60/minute and 5,000/day on the fast tier,
10/minute and 500/day on the smart tier. Inputs cap at ~8,000 tokens, 20 per
request. Exceeding a limit returns 429 with Retry-After.

## Contact

- [Book a call](https://cal.com/michaelsf/coffee) for higher limits or a tuned classifier
`;
