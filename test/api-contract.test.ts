// Run with: npm test
//
// What the documents promise about the HTTP API, checked against the worker.
// Each block here started as a live disagreement between a served document and
// the service (or a plain 500), so every test names the surface it pins down.
//
// The decision model is faked through globalThis.fetch: the fake answers each
// question by whether the item's text names the label, so results can be
// checked for order as well as shape. No request here leaves the process.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import worker from "../src/index";
import type { Env } from "../src/index";
import { ERROR_CODES, OPENAPI, UPSTREAM_CODE_PATTERN } from "../src/openapi";
import { accountReadRoutes } from "../src/http/account";
import type { AppEnv } from "../src/server/db";

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

/** A label "names" a text when every word of the label is a word of the text: "label 4" is not in "label 42". */
const names = (text: string, label: string) => {
  const words = new Set(text.split(/\s+/));
  return label.split(/\s+/).every((w) => words.has(w));
};

/** A Jev that labels an item by the first label its text names, 0.95 sure; multi: 0.9 per named label. */
function fakeJev(seen: { calls: number } = { calls: 0 }) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("api.typesafe.ai")) throw new Error(`unexpected fetch ${url}`);
    seen.calls++;
    const body = JSON.parse(String(init?.body)) as {
      state: { id: string; text: string }[];
      questions: Record<string, { type: string; criteria?: Record<string, null> }>;
    };
    const answers: Record<string, unknown> = {};
    for (const [qid, q] of Object.entries(body.questions)) {
      const itemId = q.type === "noul" ? qid.slice(0, qid.lastIndexOf("_")) : qid;
      const item = body.state.find((s) => s.id === itemId)!;
      if (q.type === "noul") {
        // The label is not in the question object; it is quoted in the instructions. Recover it from the text instead.
        const instr = (q as { instructions: string }).instructions;
        const label = instr.match(/category "([^"]+)"/)![1];
        answers[qid] = { noul: names(item.text, label) ? 0.9 : 0.1 };
      } else {
        const labels = Object.keys(q.criteria!);
        const hit = labels.find((l) => names(item.text, l)) ?? labels[0];
        const probabilities = Object.fromEntries(labels.map((l) => [l, l === hit ? 0.95 : 0.05 / Math.max(1, labels.length - 1)]));
        answers[qid] = { choice: hit, confidence: 0.95, probabilities };
      }
    }
    return Response.json({ model: "jev-test", answers, usage: { input_tokens: 10 } });
  }) as typeof fetch;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Enough Env for the classify path: a key so Jev is used, a KV that has nothing, no limiter (its absence fails open). */
const env = {
  TYPESAFE_API_KEY: "test",
  STATS: { get: async () => null, put: async () => {} },
} as unknown as Env;

const get = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://classifier.dev${path}`, { headers }), env, ctx);
const post = (body: string, path = "/", headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://classifier.dev${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body }), env, ctx);
const code = async (res: Response) => ((await res.json()) as { code: string }).code;

describe("input that used to crash the worker", () => {
  test("a malformed percent-encoding in the path is a 404, not a 500", async () => {
    for (const path of ["/%", "/a,b/%E0%A4%A", "/%zz"]) {
      const res = await get(path);
      expect(res.status).toBe(404);
    }
  });

  test("a JSON body that is not an object is a 400 bad_json with the API headers", async () => {
    for (const body of ["null", "[]", '"x"', "123", "not json at all"]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await code(res)).toBe("bad_json");
      expect(res.headers.get("x-api-version")).toBe("v1");
      expect(res.headers.get("ratelimit-limit")).toBe("3000");
    }
  });

  test("a lone null label is too_few_labels, not a crash while quoting it", async () => {
    const res = await post('{"input":"x","labels":[null]}');
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("too_few_labels");
  });
});

describe("tier", () => {
  test("anything but fast or smart is a 400 bad_tier on POST and on both GET forms", async () => {
    expect(await code(await post('{"input":"x","labels":["a","b"],"tier":"bogus"}'))).toBe("bad_tier");
    expect(await code(await post('{"input":"x","labels":["a","b"],"tier":7}'))).toBe("bad_tier");
    const byQuery = await get("/?labels=a,b&text=x&tier=bogus");
    expect(byQuery.status).toBe(400);
    expect(await byQuery.text()).toContain("error: tier must be");
    expect(await code(await get("/a,b/x?tier=bogus&verbose=1"))).toBe("bad_tier");
  });

  test("is read in any case, and an empty value means fast", async () => {
    globalThis.fetch = fakeJev();
    const smart = (await (await post('{"input":"a thing","labels":["a","b"],"tier":"Smart"}')).json()) as { tier: string };
    expect(smart.tier).toBe("smart");
    const empty = (await (await post('{"input":"a thing","labels":["a","b"],"tier":""}')).json()) as { tier: string };
    expect(empty.tier).toBe("fast");
  });
});

describe("the request body, read the way the docs describe it", () => {
  beforeEach(() => {
    globalThis.fetch = fakeJev();
  });

  test('multi: "true" and max_labels: "1" are read, not silently ignored', async () => {
    const j = (await (await post('{"input":"a and b here","labels":["a","b","c"],"multi":"true","max_labels":"1"}')).json()) as {
      results: { labels: string[]; scores: Record<string, number> }[];
    };
    expect(j.results[0].labels).toEqual(["a"]);
    expect(Object.keys(j.results[0].scores)).toEqual(["a", "b", "c"]);
  });

  test("max_labels of 0, a negative or a fraction never drops every label", async () => {
    for (const max of [0, -1, 0.5]) {
      const j = (await (await post(`{"input":"a and b here","labels":["a","b","c"],"multi":true,"max_labels":${max}}`)).json()) as { results: { labels: string[] }[] };
      expect(j.results[0].labels).toEqual(["a", "b"]);
    }
  });

  test("a string under inputs is one text", async () => {
    const j = (await (await post('{"inputs":"b please","labels":["a","b"]}')).json()) as { results: { label: string }[] };
    expect(j.results).toHaveLength(1);
    expect(j.results[0].label).toBe("b");
  });

  test("exactly 32,000 characters is accepted and 32,001 is input_too_long, saying so", async () => {
    const ok = await post(JSON.stringify({ input: "b".repeat(32_000), labels: ["a", "b"] }));
    expect(ok.status).toBe(200);
    const long = await post(JSON.stringify({ input: "b".repeat(32_001), labels: ["a", "b"] }));
    expect(long.status).toBe(400);
    const j = (await long.json()) as { code: string; error: string };
    expect(j.code).toBe("input_too_long");
    expect(j.error).toContain("at most 32,000");
  });

  test("a thousand inputs come back in order, across several packed requests; 1,001 do not go", async () => {
    const seen = { calls: 0 };
    globalThis.fetch = fakeJev(seen);
    const inputs = Array.from({ length: 1000 }, (_, i) => `${i % 2 ? "b" : "a"} item ${i} ${"x".repeat(300)}`);
    const res = await post(JSON.stringify({ inputs, labels: ["a", "b"] }));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { results: { label: string }[]; usage: { classifications: number }; modelsUsed: string[] };
    expect(j.results).toHaveLength(1000);
    expect(j.results.every((r, i) => r.label === (i % 2 ? "b" : "a"))).toBe(true);
    expect(j.usage.classifications).toBe(1000);
    expect(j.modelsUsed).toEqual(["jev-test"]);
    expect(seen.calls).toBeGreaterThan(1);

    const over = await post(JSON.stringify({ inputs: [...inputs, "one more"], labels: ["a", "b"] }));
    expect(await code(over)).toBe("too_many_inputs");
  });

  test("a hundred labels is the ceiling", async () => {
    const labels = Array.from({ length: 100 }, (_, i) => `label ${i}`);
    const ok = await post(JSON.stringify({ input: "label 42", labels }));
    expect(ok.status).toBe(200);
    const j = (await ok.json()) as { results: { label: string; scores: Record<string, number> }[] };
    expect(j.results[0].label).toBe("label 42");
    expect(Object.keys(j.results[0].scores)).toHaveLength(100);
    expect(await code(await post(JSON.stringify({ input: "x", labels: [...labels, "label 100"] })))).toBe("too_many_labels");
  });
});

describe("the GET forms", () => {
  beforeEach(() => {
    globalThis.fetch = fakeJev();
  });

  test("a percent-encoded plus, slash or comma inside a label reaches the model intact", async () => {
    const j = (await (await get("/C%2B%2B,python/templates in C%2B%2B?verbose=1")).json()) as { label: string; scores: Record<string, number> };
    expect(j.label).toBe("C++");
    expect(Object.keys(j.scores)).toEqual(["C++", "python"]);
    const slash = (await (await get("/a%2Fb,c/about a%2Fb?verbose=1")).json()) as { label: string };
    expect(slash.label).toBe("a/b");
  });

  test("Accept: application/json is the same as ?verbose=1, for the answer and for an error", async () => {
    const res = await get("/a,b/b please", { accept: "application/json" });
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(((await res.json()) as { label: string; tier: string }).label).toBe("b");
    const bad = await get("/a/b please", { accept: "application/json" });
    expect(bad.status).toBe(400);
    const j = (await bad.json()) as { code: string; try: string };
    expect(j.code).toBe("too_few_labels");
    expect(j.try).toContain("https://classifier.dev/a,not+a/");
    // curl's */* keeps the bare label.
    const bare = await get("/a,b/b please", { accept: "*/*" });
    expect(bare.headers.get("content-type")).toContain("text/plain");
    expect(await bare.text()).toBe("b\n");
  });

  test("?multi=1 with ?verbose=1 carries labels, and the multi text form is one per line", async () => {
    const j = (await (await get("/a,b,c/a and b?multi=1&verbose=1")).json()) as { labels: string[]; label: string; confidence: null };
    expect(j.labels).toEqual(["a", "b"]);
    expect(j.label).toBe("a");
    expect(j.confidence).toBeNull();
    expect(await (await get("/a,b,c/a and b?multi=1")).text()).toBe("a\nb\n");
  });
});

describe("the rate-limit headers", () => {
  test("a 429 carries Retry-After and says nothing is left", async () => {
    const limited = {
      ...env,
      LIMITER: {
        idFromName: () => "id",
        get: () => ({ fetch: async () => Response.json({ limited: true, scope: "minute", remaining: 0, resetIn: 17 }) }),
      },
    } as unknown as Env;
    const res = await worker.fetch(new Request("https://classifier.dev/", { method: "POST", body: '{"input":"x","labels":["a","b"]}' }), limited, ctx);
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; code: string; upgrade?: string };
    expect(body.code).toBe("rate_limit_minute");
    expect(res.headers.get("retry-after")).toBe("17");
    expect(res.headers.get("ratelimit-remaining")).toBe("0");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(res.headers.get("ratelimit-limit")).toBe("3000");
    expect(res.headers.get("ratelimit-policy")).toBe("3000;w=60, 20000;w=86400");
    // Out of room is the moment to say where more is: the plan that lifts this
    // limit, named in the message and carried as a field an agent can act on.
    expect(body.upgrade).toBe("https://classifier.dev/pro");
    expect(body.error).toContain("30000 for $20/month");
  });

  test("a 400 carries the limit and the policy, and RateLimit-Remaining only where the limiter was asked", async () => {
    const res = await post('{"input":"x","labels":["a"]}');
    expect(res.headers.get("ratelimit-limit")).toBe("3000");
    expect(res.headers.get("ratelimit-policy")).toBe("3000;w=60, 20000;w=86400");
    expect(res.headers.get("ratelimit-remaining")).toBeNull();
  });
});

describe("?format=html", () => {
  test("forces the rendered page even for a shell client, as the spec says", async () => {
    for (const path of ["/?format=html", "/benchmark?format=html", "/developers?format=html"]) {
      const res = await get(path, { "user-agent": "curl/8.5.0", accept: "*/*" });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    }
    expect((await get("/?format=text", { accept: "text/html" })).headers.get("content-type")).toContain("text/plain");
  });
});

describe("the feedback endpoints", () => {
  test("answer every error as {error, code} like the rest of the API", async () => {
    const invalid = await post("nope", "/api/v1/feedback");
    expect(invalid.status).toBe(400);
    expect(await code(invalid)).toBe("invalid_submission");
    const receipt = await get("/api/v1/receipts/nothing");
    expect(receipt.status).toBe(404);
    expect(await code(receipt)).toBe("not_found");
    const typo = await get("/api/v1/nope");
    expect(typo.status).toBe(404);
    expect(await code(typo)).toBe("not_found");
  });
});

describe("openapi.json", () => {
  test("every path it lists is routed, and every route the worker classifies or documents is listed", async () => {
    globalThis.fetch = fakeJev();
    const fill = (route: string) => route.replace("{labels}", "a,b").replace("{text}", "b please").replace("{id}", "nothing").replace("{name}", "nothing");
    for (const [route, methods] of Object.entries(OPENAPI.paths as Record<string, Record<string, unknown>>)) {
      for (const method of Object.keys(methods)) {
        const init: RequestInit = { method: method.toUpperCase() };
        // Account routes belong to the combined application Worker. Verify that
        // they are claimed and fail closed before touching an unconfigured DB.
        if (route.startsWith("/v1/account/")) {
          await expect(accountReadRoutes(new Request(`https://classifier.dev${route}`, init), {} as AppEnv))
            .rejects.toMatchObject({ status: 503 });
          expect((methods[method] as { security: unknown }).security).toEqual([{ accountKey: [] }]);
          continue;
        }
        if (method === "post") init.body = route.startsWith("/api/") ? "{}" : '{"input":"b please","labels":["a","b"]}';
        const res = await worker.fetch(new Request(`https://classifier.dev${fill(route)}`, init), env, ctx);
        // A 404 would mean the spec names a path the worker does not serve;
        // the receipt and skill lookups are the paths whose 404 is the documented answer for an unknown id.
        if (route === "/api/v1/receipts/{id}" || route === "/v1/skills/{name}") expect(res.status).toBe(404);
        else expect([200, 202, 400]).toContain(res.status);
      }
    }
    for (const route of ["/v1/classify", "/v1/classify/batch", "/v1/sandbox/classify", "/", "/{labels}/{text}", "/v1/health", "/v1/docs", "/api",
      "/api/v1/feedback", "/api/v1/observations", "/api/v1/feedback/{id}/attachments", "/api/v1/receipts/{id}", "/api/v1/policy", "/benchmark"]) {
      expect(Object.keys(OPENAPI.paths)).toContain(route);
    }
  });

  test("the Error schema admits exactly the codes the worker sends", () => {
    const schema = OPENAPI.components.schemas.Error.properties.code;
    const listed = schema.anyOf[0].enum as readonly string[];
    expect([...listed]).toEqual([...ERROR_CODES]);
    const pattern = new RegExp(UPSTREAM_CODE_PATTERN);
    expect(pattern.test("typesafe_429")).toBe(true);
    expect(pattern.test("openrouter_502")).toBe(true);
    expect(pattern.test("upstream")).toBe(false);
    // The codes the worker can only produce at runtime are in the list too.
    for (const c of ["bad_json", "bad_tier", "bad_cursor", "invalid_submission", "batch_unavailable", "chain_exhausted", "not_found", "internal"]) {
      expect(listed).toContain(c);
    }
  });

  test("the GET forms document their plain-text errors and the POST forms do not", () => {
    const byPath = OPENAPI.paths["/{labels}/{text}"].get.responses["400"].content as Record<string, unknown>;
    expect(Object.keys(byPath)).toContain("text/plain");
    const byPost = OPENAPI.paths["/v1/classify"].post.responses["400"].content as Record<string, unknown>;
    expect(Object.keys(byPost)).toEqual(["application/json"]);
  });
});
