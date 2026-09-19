// Explicitly invoked: ordinary unit tests never make paid network calls.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { assertMatrix, record } from "./matrix.mts";

const base = new URL(process.env.CLASSIFIER_BASE_URL || "https://classifier.dev");
assert.ok(["https:", "http:"].includes(base.protocol));
assert.equal(base.pathname, "/", "CLASSIFIER_BASE_URL must be an origin");
assert.ok(!base.search && !base.hash && !base.username && !base.password, "do not put credentials in the URL");
const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "classifier-typescript-e2e/1.0" };
if (process.env.CLASSIFIER_API_KEY) headers.authorization = `Bearer ${process.env.CLASSIFIER_API_KEY}`;
async function post(body: unknown, path = "/v1/classify", status = 200): Promise<unknown> {
  const response = await fetch(new URL(path, base), { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(120_000) });
  const data: unknown = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  return data;
}
const dimensions = {
  team: { labels: ["billing", "identity", "platform"], instructions: "billing handles payments and invoices. identity handles all authentication, including passwords, sign-in, and passkey login features. platform handles uptime and availability." },
  urgency: { labels: ["immediate", "normal", "low"], instructions: "immediate means an active outage or repeated financial harm. normal means a single user cannot complete a task. low means a cosmetic issue or future feature request." },
  kind: { labels: ["bug", "request", "question"], instructions: "bug is broken existing behavior. request asks for a new capability. question asks for information." },
} as const;
const fixtures = [
  { text: "Checkout is broken and repeatedly charges my card twice for every purchase.", labels: ["billing", "immediate", "bug"] },
  { text: "Please add passkey login next year. My current login works fine.", labels: ["identity", "low", "request"] },
  { text: "The service is completely down for every customer right now.", labels: ["platform", "immediate", "bug"] },
  { text: "My password reset link is broken and I cannot sign in.", labels: ["identity", "normal", "bug"] },
] as const;

describe(`real multidimensional API at ${base.origin}`, { concurrency: false, timeout: 240_000 }, () => {
  for (const size of [4, 100]) test(`${size} items: correct ordered decisions and complete Jev distributions`, async (t) => {
    const items = Array.from({ length: size }, (_, i) => fixtures[i % fixtures.length]!.text);
    const data = await post({ items, dimensions });
    assertMatrix(data, size, dimensions);
    assert.equal(data.usage.fallback, 0);
    assert.ok(data.modelsUsed.every(model => model.startsWith("jev-")));
    data.results.forEach((row, i) => {
      // These accesses are typechecked against the actual dimension names and label unions.
      assert.deepEqual([row.dimensions.team.label, row.dimensions.urgency.label, row.dimensions.kind.label], fixtures[i % fixtures.length]!.labels, `item ${i}`);
      for (const field of Object.values(row.dimensions)) assert.notEqual(field.confidence, null);
    });
    t.diagnostic(JSON.stringify({ model: data.model, ...data.usage }));
  });

  test("smart tier actually escalates uncertain fields and withholds stale scores", async (t) => {
    const items = [
      "Something about my account looks wrong, but I cannot tell whether it is the invoice or login.",
      "The screen seems odd and I would like some help.",
      "Could you change this behavior? I thought it used to work differently.",
      "I cannot access my paid subscription after checking out.",
    ];
    const dims = { team: ["billing", "identity", "platform"], kind: ["bug", "request", "question"] } as const;
    const data = await post({ items, dimensions: dims, tier: "smart" });
    assertMatrix(data, items.length, dims, "smart");
    assert.equal(data.usage.fallback, 0);
    assert.equal(data.usage.escalation_failed, undefined, "reasoning provider must be reachable");
    assert.ok(data.usage.escalated > 0, "fixtures must exercise real escalation; confidence drift must not silently skip this check");
    for (const row of data.results) for (const field of Object.values(row.dimensions)) {
      if (field.escalated) assert.ok(!field.model.startsWith("jev-"));
    }
    t.diagnostic(JSON.stringify({ models: data.modelsUsed, ...data.usage }));
  });

  test("unreadable input withholds uncertainty for every field", async () => {
    const data = await post({ items: ["asdkjfhaskdjfh"], dimensions });
    assertMatrix(data, 1, dimensions);
    for (const field of Object.values(data.results[0]!.dimensions)) assert.equal(field.confidence, null);
  });

  test("input aliases and label-array shorthand use the same contract", async () => {
    const dims = { team: ["billing", "platform"], kind: ["bug", "request"] } as const;
    for (const input of [{ input: fixtures[0].text }, { inputs: [fixtures[0].text] }]) {
      const data = await post({ ...input, dimensions: dims }, "/v1/classify/batch");
      assertMatrix(data, 1, dims);
      assert.equal(data.results[0]!.dimensions.team.label, "billing");
      assert.equal(data.results[0]!.dimensions.kind.label, "bug");
    }
  });

  const invalid: { name: string; body: unknown; code: string }[] = [
    { name: "one-label dimension", body: { items: [fixtures[0].text], dimensions: { team: ["billing"] } }, code: "bad_dimensions" },
    { name: "conflicting labels", body: { items: [fixtures[0].text], dimensions, labels: ["a", "b"] }, code: "bad_dimensions" },
    { name: "conflicting input aliases", body: { items: [fixtures[0].text], input: fixtures[0].text, dimensions }, code: "bad_dimensions" },
    { name: "over 1,000 decisions", body: { items: Array(501).fill(fixtures[0].text), dimensions: { team: ["billing", "platform"], kind: ["bug", "request"] } }, code: "too_many_decisions" },
  ];
  for (const fixture of invalid) test(`rejects ${fixture.name} with a stable error code`, async () => {
    const data = await post(fixture.body, "/v1/classify", 400);
    record(data); assert.equal(data.code, fixture.code); assert.equal(data.results, undefined);
  });

  test("MCP calls return the same typed matrix", async () => {
    const rpc = await post({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "classify_dimensions", arguments: { items: [fixtures[0].text], dimensions } } }, "/mcp");
    record(rpc); assert.equal(rpc.id, 1); assert.equal(rpc.error, undefined); record(rpc.result);
    assert.equal(rpc.result.isError, undefined);
    const data = rpc.result.structuredContent;
    assertMatrix(data, 1, dimensions);
    assert.equal(data.results[0]!.dimensions.team.label, "billing");
  });

  test("legacy single-label and multi-label calls remain compatible", async () => {
    const single = await post({ input: "Win a free iPhone now", labels: ["spam", "not spam"] });
    record(single); assert.ok(Array.isArray(single.results)); record(single.results[0]);
    assert.equal(single.results[0].label, "spam"); assert.equal(single.results[0].dimensions, undefined);
    const multi = await post({ input: "The billing page is broken.", labels: ["billing", "bug", "praise"], multi: true });
    record(multi); assert.ok(Array.isArray(multi.results)); record(multi.results[0]);
    assert.ok(Array.isArray(multi.results[0].labels));
    assert.ok(multi.results[0].labels.includes("billing")); assert.ok(multi.results[0].labels.includes("bug"));
  });

  test("OpenAPI advertises dimension requests and typed field results", async () => {
    const response = await fetch(new URL("/openapi.json", base), { signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200);
    const data: unknown = await response.json();
    record(data); record(data.components); record(data.components.schemas);
    const request = data.components.schemas.ClassifyRequest;
    record(request); record(request.properties); record(request.properties.dimensions);
    record(data.components.schemas.DimensionResult);
  });
});
