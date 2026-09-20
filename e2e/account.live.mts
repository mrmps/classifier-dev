// Explicit live smoke test. Never runs with the unit suite; consumes a few
// classifications from the supplied account, but never purchases a subscription.
import assert from "node:assert/strict";
import { test } from "node:test";

const origin = new URL(process.env.CLASSIFIER_BASE_URL || "https://classifier.dev");
assert.equal(origin.pathname, "/");
assert.ok(!origin.username && !origin.password && !origin.search && !origin.hash);
assert.ok(origin.protocol === "https:" || ["localhost", "127.0.0.1"].includes(origin.hostname));
const key = process.env.CLASSIFIER_ACCOUNT_API_KEY;
assert.ok(key?.startsWith("classifier_agent_"), "Set CLASSIFIER_ACCOUNT_API_KEY.");
const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
const call = async (path: string, body?: unknown) => {
  const response = await fetch(new URL(path, origin), {
    method: body === undefined ? "GET" : "POST", headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error", signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json();
  return { response, data };
};
const balance = async () => {
  const { response, data } = await call("/v1/account/balance");
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.exact, true);
  assert.equal(data.currency, "USD");
  assert.match(data.available, /^\d+\.\d{5}$/);
  assert.match(data.reserved, /^\d+\.\d{5}$/);
  return data as { available: string; reserved: string };
};

test("invalid requests leave the real account balance unchanged", async () => {
  const before = await balance();
  const { response } = await call("/v1/classify", { input: "test", labels: ["only one"] });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("x-billing-status"), "refunded");
  assert.deepEqual(await balance(), before);
});

for (const tier of ["fast", "smart"]) test(`${tier} account inference settles its reservation`, async () => {
  const before = await balance();
  const { response, data } = await call("/v1/classify", {
    inputs: ["Win a free prize now", "Lunch tomorrow?"], labels: ["spam", "not spam"], tier,
  });
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(response.headers.get("x-billing-status"), "settled");
  assert.ok(response.headers.get("x-request-id"));
  assert.equal(data.results.length, 2);
  assert.equal(data.usage.classifications, 2);
  const after = await balance();
  assert.equal(after.reserved, before.reserved, "inference must not leak a hold");
  assert.ok(Number(after.available) <= Number(before.available));
});

test("account MCP executes real inference through the same balance", async () => {
  const before = await balance();
  const { response, data } = await call("/mcp", {
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "classify_texts", arguments: { inputs: ["Lunch tomorrow?"], labels: ["spam", "not spam"] } },
  });
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.error, undefined, JSON.stringify(data));
  assert.equal(data.result.isError, undefined, JSON.stringify(data));
  assert.equal(data.result.structuredContent.results.length, 1);
  assert.equal((await balance()).reserved, before.reserved);
});

for (const path of ["usage/summary", "usage/timeseries", "usage/breakdown", "activity"]) {
  test(`account ${path} is available in production`, async () => {
    const { response, data } = await call(`/v1/account/${path}`);
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.ok(Array.isArray(data.data));
    assert.equal(data.meta.exact, false);
  });
}

test("unauthenticated and fake account keys cannot read balances", async () => {
  for (const authorization of [undefined, "Bearer classifier_agent_invalid"]) {
    const response = await fetch(new URL("/v1/account/balance", origin), {
      headers: authorization ? { authorization } : {}, redirect: "error",
    });
    assert.equal(response.status, 401);
  }
});
