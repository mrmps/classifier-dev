import { afterEach, describe, expect, test } from "bun:test";
import Ajv from "ajv/dist/2020";
import worker, { type Env } from "../src/index";
import { packDimensions, readDimensions, classifyDimensions } from "../src/dimensions";
import { OPENAPI } from "../src/openapi";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const dims = { team: ["billing", "identity", "platform"], kind: ["bug", "request", "question"] };
const items = ["billing bug: charged twice", "identity request: add another login"];
function harness(extra: Partial<Env> = {}) {
  const points: any[] = [], pending: Promise<unknown>[] = [], gates: string[] = [];
  const env = {
    TYPESAFE_API_KEY: "fake", OPENROUTER_API_KEY: "fake", PRIVACY_SALT: "test-salt",
    STATS: { get: async () => null, put: async () => {} },
    AE: { writeDataPoint: (p: unknown) => points.push(p) },
    LIMITER: { idFromName: (s: string) => s, get: () => ({ fetch: async (url: string) => {
      gates.push(url); return Response.json({ limited: false, remaining: 2996 });
    } }) }, ...extra,
  } as unknown as Env;
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p) } as ExecutionContext;
  const post = async (body: unknown, path = "/v1/classify", headers = {}) => {
    const response = await worker.fetch(new Request(`https://classifier.dev${path}`, {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.12", ...headers }, body: JSON.stringify(body),
    }), env, ctx);
    await Promise.all(pending);
    return { response, body: await response.json() as any };
  };
  return { post, points, gates };
}
function fakeJev(options: { maxQuestions?: number; malformed?: boolean; low?: string } = {}) {
  const calls: any[] = [];
  globalThis.fetch = (async (_url, init) => {
    const b = JSON.parse(String(init?.body)); calls.push(b);
    if (Object.keys(b.questions).length > (options.maxQuestions ?? Infinity)) return Response.json({ detail: { error_type: "max_tokens_exceeded" } }, { status: 400 });
    const answers = Object.fromEntries(Object.entries(b.questions).map(([id, q]: [string, any]) => {
      const itemId = q.instructions.match(/item (i\d+)/)[1];
      const text = b.state.find((i: any) => i.id === itemId).text;
      const labels = Object.keys(q.criteria);
      const label = labels.find((l) => text.includes(l)) ?? labels[0];
      return [id, { choice: label, confidence: id === options.low ? 0.4 : 0.95,
        probabilities: Object.fromEntries(labels.map((l) => [l, l === label ? 0.9 : 0.1 / (labels.length - 1)])) }];
    }));
    if (options.malformed) delete answers[Object.keys(answers)[0]];
    return Response.json({ model: "jev-test", answers, usage: { input_tokens: 100 } });
  }) as typeof fetch;
  return calls;
}

describe("multidimensional HTTP contract", () => {
  test("one shared state, one question per cell, input order, per-field scores and private analytics", async () => {
    const calls = fakeJev(); const h = harness();
    const { response, body } = await h.post({ items, dimensions: dims }, "/v1/classify", { "idempotency-key": "matrix-1" });
    expect(response.status).toBe(200);
    expect(response.headers.get("idempotency-key")).toBe("matrix-1");
    expect(response.headers.get("ratelimit-remaining")).toBe("2996");
    expect(calls).toHaveLength(1);
    expect(calls[0].state).toHaveLength(2);
    expect(Object.keys(calls[0].questions)).toHaveLength(4);
    expect(body.results.map((r: any) => [r.dimensions.team.label, r.dimensions.kind.label])).toEqual([["billing", "bug"], ["identity", "request"]]);
    expect(body.results[0].dimensions.team).toMatchObject({ confidence: 0.95, model: "jev-test", scores: { billing: 0.9 } });
    expect(body.usage).toMatchObject({ items: 2, dimensions: 2, classifications: 4, escalated: 0, fallback: 0 });
    expect(h.gates[0]).toContain("cost=4");
    expect(h.points[0].blobs[8]).toBe("dimensions");
    expect(h.points[0].doubles.slice(5)).toEqual([2, 2, 0, 0]);
    const stored = JSON.stringify(h.points);
    for (const privateValue of ["203.0.113.12", ...items, "billing", "identity", "team", "kind"]) expect(stored).not.toContain(privateValue);
    expect(h.points[0].blobs[1]).toMatch(/^ls_/);
    const ajv = new Ajv({ strict: false, validateFormats: false });
    const schema: any = OPENAPI.components.schemas;
    const req = ajv.compile({ ...schema.ClassifyRequest });
    expect(req({ items, dimensions: dims })).toBe(true);
    expect(req({ items, dimensions: dims, labels: ["a", "b"] })).toBe(false);
    const res = ajv.compile({ ...schema.ClassifyResponse, components: OPENAPI.components });
    expect(res(body)).toBe(true);
  });
  test("aliases and per-dimension instructions work", async () => {
    const calls = fakeJev(); const h = harness();
    for (const path of ["/", "/v1/classify/batch", "/v1/sandbox/classify"]) {
      const r = await h.post({ inputs: items, instructions: "shared policy", dimensions: { team: { labels: dims.team, instructions: "team policy" }, kind: dims.kind } }, path);
      expect(r.response.status).toBe(200);
    }
    expect(calls[0].questions.i0_d0.instructions).toContain("shared policy team policy");
    expect(calls[0].questions.i0_d1.instructions).not.toContain("team policy");
  });
  test("hostile property names remain plain data", async () => {
    fakeJev(); const h = harness();
    const dimensions = JSON.parse('{"__proto__":["__proto__","constructor"],"constructor":["yes","no"]}');
    const r = await h.post({ items: ["the word __proto__ appears here"], dimensions });
    expect(r.response.status).toBe(200);
    expect(Object.keys(r.body.results[0].dimensions)).toEqual(["__proto__", "constructor"]);
    expect(r.body.results[0].dimensions.__proto__.label).toBe("__proto__");
  });
  test("unreadable text withholds every field's scores", async () => {
    fakeJev(); const r = await harness().post({ items: ["asdkjfhaskdjfh"], dimensions: dims });
    expect(r.response.status).toBe(200);
    for (const v of Object.values(r.body.results[0].dimensions) as any[]) {
      expect(v.confidence).toBeNull(); expect(v.scores).toBeNull(); expect(v.unscored).toBeDefined();
    }
  });
  const invalid = [null, [], {}, { a: ["one"] }, { a: ["same", "same"] }, { " ": ["a", "b"] }, { a: ["a", 2] }, { a: { labels: ["a", "b"], instructions: 1 } }, { a: { labels: ["a", "b"], extra: true } }, Object.fromEntries(Array.from({length:21},(_,i)=>[`d${i}`,["a","b"]]))];
  for (const dimensions of invalid) test(`rejects bad dimensions ${JSON.stringify(dimensions).slice(0,60)} before inference`, async () => {
    const calls = fakeJev(); const h = harness();
    const r = await h.post({ items, dimensions });
    expect(r.response.status).toBe(400); expect(r.body.code).toBe("bad_dimensions"); expect(calls).toHaveLength(0);
    expect(h.points[0].blobs[8]).toBe("dimensions"); expect(h.points[0].blobs[6]).toBe("bad_dimensions");
  });
  for (const extra of [{ labels: ["a","b"] }, { multi: false }, { max_labels: 2 }, { inputs: items }, { input: "another" }, { instructions: 2 }]) test(`rejects conflicting input ${JSON.stringify(extra)}`, async () => {
    fakeJev(); const r = await harness().post({ items, dimensions: dims, ...extra });
    expect(r.response.status).toBe(400); expect(r.body.code).toBe("bad_dimensions");
  });
  test("caps decisions, including smart public quota, before upstream work", async () => {
    const calls = fakeJev(); const h = harness();
    const r = await h.post({ items: Array(501).fill("A valid input sentence"), dimensions: dims });
    expect(r.body.code).toBe("too_many_decisions");
    const smart = await h.post({ items: Array(101).fill("A valid input sentence"), dimensions: dims, tier: "smart" });
    expect(smart.body.code).toBe("too_many_decisions"); expect(calls).toHaveLength(0);
  });
  test("records quota failures as dimension requests", async () => {
    fakeJev(); const h = harness({ LIMITER: { idFromName: () => "id", get: () => ({ fetch: async () => Response.json({ limited: true, scope: "day", resetIn: 123 }) }) } as any });
    const r = await h.post({ items, dimensions: dims });
    expect(r.response.status).toBe(429); expect(r.response.headers.get("retry-after")).toBe("123");
    expect(h.points[0].blobs[8]).toBe("dimensions"); expect(h.points[0].blobs[6]).toBe("rate_limit_day");
  });
  test("MCP dispatch reaches the same matrix API and telemetry", async () => {
    fakeJev(); const h = harness();
    const r = await h.post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "classify_dimensions", arguments: { items, dimensions: dims } } }, "/mcp");
    expect(r.body.result.structuredContent.usage.classifications).toBe(4);
    expect(h.points[0].blobs[8]).toBe("dimensions");
  });
});

describe("packing and recovery", () => {
  test("splits long states and many questions without losing or duplicating cells", async () => {
    fakeJev(); const ds = readDimensions(Object.fromEntries(Array.from({length:20},(_,i)=>[`dimension${i}`,["bug","request"]])));
    const texts = Array(50).fill("這是錯誤報告".repeat(600));
    const batches = packDimensions(texts, ds);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((b)=>b.cells)).toHaveLength(1000);
    expect(new Set(batches.flatMap((b)=>b.cells.map(c=>c.id))).size).toBe(1000);
    const out = await classifyDimensions({ typesafe: "key" }, batches);
    expect(out).toHaveLength(50); out.forEach((row)=>expect(row).toHaveLength(20));
  });
  test("splits a rejected wide item by questions", async () => {
    const calls = fakeJev({maxQuestions:1});
    const out = await classifyDimensions({ typesafe: "key" }, packDimensions(items, readDimensions(dims)));
    expect(out.map(row=>row.map(r=>r.label))).toEqual([["billing","bug"],["identity","request"]]);
    expect(calls.filter(c=>Object.keys(c.questions).length===1)).toHaveLength(4);
  });
  test("a single oversized cell is rejected before inference", async () => {
    const calls=fakeJev(); const r=await harness().post({items:["漢".repeat(15000)],dimensions:dims});
    expect(r.response.status).toBe(400); expect(r.body.code).toBe("dimension_context_too_large"); expect(calls).toHaveLength(0);
  });
  test("missing answers retry and then fail the whole large matrix", async () => {
    const calls=fakeJev({malformed:true}); const h=harness();
    const r=await h.post({items:Array(11).fill("billing bug"),dimensions:dims});
    expect(r.response.status).toBe(502); expect(r.body.results).toBeUndefined(); expect(calls).toHaveLength(3);
    expect(h.points[0].blobs[6]).toBe("batch_unavailable"); expect(h.points[0].blobs[8]).toBe("dimensions");
  });
  test("small matrices use a bounded fallback and report it", async () => {
    let calls=0;
    globalThis.fetch=(async()=>{calls++;return Response.json({choices:[{message:{content:"A"}}],usage:{cost:0.001}});}) as typeof fetch;
    const h=harness({TYPESAFE_API_KEY:undefined}); const r=await h.post({items,dimensions:dims});
    expect(r.response.status).toBe(200); expect(calls).toBe(4); expect(r.body.usage.fallback).toBe(4);
    expect(h.points[0].doubles[8]).toBe(4);
  });
  test("smart escalates only an uncertain cell and does not attach stale scores", async () => {
    fakeJev({low:"i0_d1"}); const upstream=globalThis.fetch; let llmCalls=0;
    globalThis.fetch=(async(u,i)=>{if(String(u).includes("typesafe"))return upstream(u,i);llmCalls++;return Response.json({choices:[{message:{content:"B"}}]});}) as typeof fetch;
    const r=await harness().post({items,dimensions:dims,tier:"smart"});
    expect(r.response.status).toBe(200); expect(llmCalls).toBe(1); expect(r.body.usage.escalated).toBe(1);
    expect(r.body.results[0].dimensions.kind).toMatchObject({label:"request",escalated:true,confidence:null,scores:null});
    expect(r.body.results[0].dimensions.team.confidence).toBe(0.95);
  });
  test("failed smart escalation preserves the field and records the failure", async () => {
    fakeJev({low:"i0_d1"}); const upstream=globalThis.fetch;
    globalThis.fetch=(async(u,i)=>String(u).includes("typesafe")?upstream(u,i):Response.json({error:{code:"bad_key"}},{status:401})) as typeof fetch;
    const h=harness(); const r=await h.post({items,dimensions:dims,tier:"smart"});
    expect(r.response.status).toBe(200); expect(r.body.usage.escalation_failed).toBe(1);
    expect(r.body.results[0].dimensions.kind).toMatchObject({label:"bug",confidence:0.4}); expect(h.points[0].doubles[4]).toBe(1);
  });
});

describe("single-label smart confidence", () => {
  for (const answer of ["A", "B"]) test(`escalation to ${answer} withholds the first model's probabilities`, async () => {
    globalThis.fetch = (async (url) => String(url).includes("typesafe")
      ? Response.json({ model: "jev-test", answers: { i0: { choice: "bug", confidence: 0.4, probabilities: { bug: 0.4, request: 0.6 } } } })
      : Response.json({ choices: [{ message: { content: answer } }] })) as typeof fetch;
    const { response, body } = await harness().post({ input: "please improve this", labels: ["bug", "request"], tier: "smart" });
    expect(response.status).toBe(200);
    expect(body.results[0]).toMatchObject({ label: answer === "A" ? "bug" : "request", escalated: true, confidence: null, scores: null, unscored: "reasoning model does not return comparable probabilities" });
    expect(body.usage.escalated).toBe(1);
  });
  test("failed escalation keeps the original answer and probabilities", async () => {
    globalThis.fetch = (async (url) => String(url).includes("typesafe")
      ? Response.json({ model: "jev-test", answers: { i0: { choice: "bug", confidence: 0.4, probabilities: { bug: 0.4, request: 0.6 } } } })
      : Response.json({ error: { code: "bad_key" } }, { status: 401 })) as typeof fetch;
    const { body } = await harness().post({ input: "please improve this", labels: ["bug", "request"], tier: "smart" });
    expect(body.results[0]).toMatchObject({ label: "bug", confidence: 0.4, scores: { bug: 0.4, request: 0.6 } });
    expect(body.results[0].escalated).toBeUndefined();
    expect(body.usage.escalation_failed).toBe(1);
  });
});
