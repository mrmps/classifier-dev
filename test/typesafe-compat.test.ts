import { afterEach, describe, expect, test } from "bun:test";
import {
  choice,
  noul,
  RateLimitError,
  score,
  TypeSafeClient,
  UnprocessableEntityError,
} from "@typesafe-ai/sdk";

import worker, { type Env } from "../src/index";
import { DOCS } from "../src/docs";
import { OPENAPI } from "../src/openapi";
import { DEVELOPERS } from "../src/pages";

const realFetch = globalThis.fetch;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function harness() {
  const quotaCosts: number[] = [];
  const upstream: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const env = {
    TYPESAFE_API_KEY: "provider-secret",
    LIMITER: {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async (url: string) => {
          const cost = Number(new URL(url).searchParams.get("cost"));
          quotaCosts.push(cost);
          return Response.json({ limited: false, remaining: 3000 - cost });
        },
      }),
    },
  } as unknown as Env;

  const sdkFetch = (input: string | URL | Request, init?: RequestInit) =>
    worker.fetch(new Request(input, init), env, ctx);

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    upstream.push({ url, headers, body });
    if (url.endsWith("/v1/models")) {
      return Response.json({
        models: [{ name: "jev-latest", description: "General-purpose system one model.", release_date: "2026-09-15" }],
      }, { headers: { "x-typesafe-request-id": "req_models" } });
    }
    return Response.json({
      model: "jev-1.13.0",
      answers: {
        category: {
          type: "choice",
          choice: "billing",
          confidence: 0.91,
          probabilities: { billing: 0.91, technical: 0.09 },
        },
        urgent: { type: "noul", noul: 0.87 },
        frustration: {
          type: "score",
          score: 1.7,
          confidence: 0.82,
          legend: { "0": "calm", "1": "concerned", "2": "angry" },
          probabilities: { "0": 0.05, "1": 0.2, "2": 0.75 },
        },
      },
      usage: { input_tokens: 123, output_tokens: 9 },
    }, { headers: {
      "access-control-allow-credentials": "true",
      "x-typesafe-request-id": "req_systemone",
      "x-typesafe-feature": "future-metadata",
    } });
  }) as typeof fetch;

  return { env, quotaCosts, sdkFetch, upstream };
}

describe("the TypeSafe-compatible API", () => {
  test("runs the unmodified official JavaScript SDK for every question type and model listing", async () => {
    const h = harness();
    const client = new TypeSafeClient({
      apiKey: "unused-by-classifier.dev",
      baseURL: "https://classifier.dev",
      fetch: h.sdkFetch,
      retry: { maxRetries: 0 },
      defaultHeaders: { "x-trace": "trace-123", "cf-connecting-ip": "must-not-leak" },
    });

    const result = await client.systemOne({
      state: { ticket: "I was charged twice and need this fixed today." },
      questions: {
        category: choice("Which team should handle this?", { billing: null, technical: null }),
        urgent: noul("Does this need prompt attention?"),
        frustration: score("How frustrated is the customer?", ["calm", "concerned", "angry"]),
      },
    }).withResponse();

    expect(result.data.answers.category.choice).toBe("billing");
    expect(result.data.answers.urgent.noul).toBe(0.87);
    expect(result.data.answers.frustration.score).toBe(1.7);
    expect(result.data.usage).toEqual({ input_tokens: 123, output_tokens: 9 });
    expect(result.requestId).toBe("req_systemone");
    expect(result.response.headers.get("x-typesafe-feature")).toBe("future-metadata");
    expect(result.response.headers.get("access-control-allow-origin")).toBe("*");
    expect(result.response.headers.has("access-control-allow-credentials")).toBe(false);
    expect(await client.models.list()).toEqual([
      { name: "jev-latest", description: "General-purpose system one model.", release_date: "2026-09-15" },
    ]);

    expect(h.quotaCosts).toEqual([3]);
    expect(h.upstream.map((call) => call.url)).toEqual([
      "https://api.typesafe.ai/v1/systemone",
      "https://api.typesafe.ai/v1/models",
    ]);
    expect(h.upstream[0].headers.get("authorization")).toBe("Bearer provider-secret");
    expect(h.upstream[0].headers.get("authorization")).not.toContain("unused-by-classifier.dev");
    expect(h.upstream[0].headers.get("x-typesafe-sdk")).toMatch(/^typesafe-sdk\//);
    expect(h.upstream[0].headers.get("x-trace")).toBe("trace-123");
    expect(h.upstream[0].headers.has("cf-connecting-ip")).toBe(false);
    expect(h.upstream[0].body).toMatchObject({ model: "jev-latest" });
  });

  test("preserves TypeSafe validation bodies, status, request IDs and retry headers", async () => {
    const h = harness();
    globalThis.fetch = (async () => Response.json({
      detail: [{ loc: ["body", "questions", "category", "criteria"], msg: "Field required", type: "missing" }],
    }, {
      status: 422,
      headers: {
        "x-typesafe-request-id": "req_invalid",
        "retry-after-ms": "125",
      },
    })) as typeof fetch;
    const client = new TypeSafeClient({
      apiKey: "unused",
      baseURL: "https://classifier.dev",
      fetch: h.sdkFetch,
      retry: { maxRetries: 0 },
    });

    let error: unknown;
    try {
      await client.systemOne({
        state: "ticket",
        questions: { category: choice("Category?", { billing: null, technical: null }) },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UnprocessableEntityError);
    expect(error).toMatchObject({ status: 422, requestId: "req_invalid" });
    expect((error as UnprocessableEntityError).body).toEqual({
      detail: [{ loc: ["body", "questions", "category", "criteria"], msg: "Field required", type: "missing" }],
    });
    expect((error as UnprocessableEntityError).headers.get("retry-after-ms")).toBe("125");
  });

  test("surfaces classifier.dev quota through the SDK without spending an upstream call", async () => {
    let upstreamCalls = 0;
    globalThis.fetch = (async () => { upstreamCalls++; return Response.json({}); }) as typeof fetch;
    const env = {
      TYPESAFE_API_KEY: "provider-secret",
      LIMITER: {
        idFromName: (name: string) => name,
        get: () => ({ fetch: async () => Response.json({ limited: true, remaining: 0, resetIn: 17 }) }),
      },
    } as unknown as Env;
    const client = new TypeSafeClient({
      apiKey: "unused",
      baseURL: "https://classifier.dev",
      fetch: (input, init) => worker.fetch(new Request(input, init), env, ctx),
      retry: { maxRetries: 0 },
    });

    let error: unknown;
    try {
      await client.systemOne({ state: "ticket", questions: { urgent: noul("Is this urgent?") } });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ status: 429, retryAfterMs: 17_000 });
    expect(upstreamCalls).toBe(0);
  });

  test("admits browser SDK headers in preflight and exposes TypeSafe response metadata", async () => {
    const h = harness();
    const response = await worker.fetch(new Request("https://classifier.dev/v1/systemone", {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type,x-typesafe-sdk,x-typesafe-runtime,x-typesafe-retry-count",
      },
    }), h.env, ctx);
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain("X-TypeSafe-SDK");
    expect(response.headers.get("access-control-allow-headers")).toContain("X-TypeSafe-Runtime");
    expect(response.headers.get("access-control-expose-headers")).toContain("x-typesafe-request-id");
    expect(response.headers.get("access-control-expose-headers")).toContain("Retry-After-Ms");
  });

  test("returns an SDK-readable service error without sending a request when the provider is unconfigured", async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return Response.json({}); }) as typeof fetch;
    const response = await worker.fetch(new Request("https://classifier.dev/v1/systemone", {
      method: "POST",
      headers: { authorization: "Bearer unused", "content-type": "application/json" },
      body: JSON.stringify({ state: "ticket", model: "jev-latest", questions: { urgent: { type: "noul" } } }),
    }), {} as Env, ctx);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "The TypeSafe-compatible endpoint is temporarily unavailable." });
    expect(calls).toBe(0);
  });

  test("publishes the SDK setup in human, agent and OpenAPI documentation", async () => {
    expect(DOCS).toContain("TYPESAFE SDK COMPATIBILITY");
    expect(DOCS).toContain('baseURL: "https://classifier.dev"');
    expect(DOCS).toContain('base_url="https://classifier.dev"');
    expect(DOCS).toContain("classifier_agent_...");
    expect(DOCS).toContain("Do not put a real TypeSafe API key here");
    expect(DEVELOPERS).toContain("POST    /v1/systemone");
    expect(DEVELOPERS).toContain("GET     /v1/models");
    expect(OPENAPI.paths).toHaveProperty("/v1/systemone");
    expect(OPENAPI.paths).toHaveProperty("/v1/models");
    expect(OPENAPI.paths["/v1/systemone"].post.security).toEqual([{ accountKey: [] }, {}]);

    const h = harness();
    const agentIndex = await worker.fetch(new Request("https://classifier.dev/api"), h.env, ctx);
    const body = await agentIndex.json() as { api: Record<string, { url: string }>; sdks: { typesafe: { api_key: { workspace: string } } } };
    expect(body.api.typesafe_system_one.url).toBe("https://classifier.dev/v1/systemone");
    expect(body.api.typesafe_models.url).toBe("https://classifier.dev/v1/models");
    expect(body.sdks.typesafe.api_key.workspace).toContain("classifier_agent_");
  });
});
