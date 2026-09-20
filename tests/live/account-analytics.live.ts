/** Opt-in real Cloudflare test. Creates/deletes one random protected Worker;
 * writes two synthetic tenants retained by AE for its standard retention.
 * Run: RUN_LIVE_AE=1 bun --env-file=.secrets.env tests/live/account-analytics.live.ts
 * Requires CLOUDFLARE_API_TOKEN, plus CLOUDFLARE_ACCOUNT_ID or wrangler.toml.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { readAccountAnalytics } from "../../src/server/analytics/query";

if (process.env.RUN_LIVE_AE !== "1") throw new Error("Set RUN_LIVE_AE=1 explicitly to create the temporary verification Worker.");
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? (await readFile("wrangler.toml", "utf8")).match(/^account_id\s*=\s*"([a-f0-9]+)"/m)?.[1];
assert(token && account && /^[a-f0-9]{32}$/i.test(account), "Cloudflare credentials/account required");
const id = crypto.randomUUID().replaceAll("-", "");
const worker = `classifier-ae-e2e-${id.slice(0, 16)}`;
const tenant = `e2e_${id}`;
const secret = crypto.randomUUID();
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers = { authorization: `Bearer ${token}` };
async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Cloudflare ${init.method ?? "GET"} ${path} returned ${response.status}`);
  const body = await response.json() as { success: boolean; result: Record<string, unknown> };
  assert(body.success, `Cloudflare request failed: ${path}`);
  return body.result;
}
const exists = await fetch(`${base}/workers/scripts/${worker}`, { headers });
assert.equal(exists.status, 404, "Refusing to overwrite an existing Worker");
const bundle = await build({ entryPoints: ["tests/live/account-analytics-writer.ts"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const form = new FormData();
form.set("metadata", new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-09-01", bindings: [
  { type: "analytics_engine", name: "ACCOUNT_AE", dataset: "classifier_account_events" },
  { type: "secret_text", name: "TEST_SECRET", text: secret },
  { type: "plain_text", name: "TEST_ACCOUNT", text: tenant },
] })], { type: "application/json" }));
form.set("worker.js", new Blob([bundle.outputFiles![0].text], { type: "application/javascript+module" }), "worker.js");
let attemptedUpload = false;
try {
  attemptedUpload = true;
  await api(`/workers/scripts/${worker}`, { method: "PUT", body: form });
  const subdomain = String((await api("/workers/subdomain")).subdomain);
  assert(/^[a-z0-9-]+$/.test(subdomain));
  await api(`/workers/scripts/${worker}/subdomain`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true, previews_enabled: false }) });
  const url = `https://${worker}.${subdomain}.workers.dev`;
  // Wait only for routing, without resubmitting synthetic writes.
  let ready = false;
  for (let i = 0; i < 12; i++) {
    const response = await fetch(url).catch(() => null);
    if (response?.status === 403) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  assert(ready, "Temporary Worker route did not become ready");
  const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  assert.equal(response.status, 204, "Real writer failed");
  console.log("Wrote two synthetic tenant events using actual writeAccountAnalytics.");
  const env = { CLOUDFLARE_ACCOUNT_ID: account, CF_ANALYTICS_TOKEN: token };
  let ingested = false;
  for (let i = 0; i < 24; i++) {
    try {
      const result = await readAccountAnalytics(env, tenant, "summary");
      if (Number(result.data[0]?.requests) === 1) { ingested = true; break; }
    } catch { /* New dataset may not yet exist. Bounded ingestion wait. */ }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  assert(ingested, "Synthetic event was not queryable within two minutes");
  for (const kind of ["summary", "timeseries", "breakdown", "activity"] as const) {
    const params = new URLSearchParams({ source: "api", key_id: "synthetic_key", ...(kind === "timeseries" ? { interval: "hour" } : {}) });
    const result = await readAccountAnalytics(env, tenant, kind, params);
    assert.equal(result.data.length, 1, `${kind} rows`);
    const row = result.data[0];
    assert.equal(Number(row.items), 3, `${kind} tenant isolation`);
    assert.equal(Number(row.inputTokens), 120, `${kind} tokens`);
    assert.equal(Number(row.requests), 1, `${kind} requests`);
    assert(Math.abs(Number(row.retailCostUsd) - 0.00000504) < 1e-12, `${kind} cost`);
    if (kind === "activity") assert.equal(row.requestId, `${tenant}_request`);
    if (kind === "breakdown") assert.equal(row.dimension, "synthetic_key");
    assert.equal(result.meta.sampled, false);
    console.log(`PASS real ${kind}: 1 request, 3 items, 120 input tokens; other tenant excluded.`);
  }
} finally {
  if (attemptedUpload) {
    await api(`/workers/scripts/${worker}`, { method: "DELETE" });
    console.log(`Removed temporary Worker ${worker}; only two synthetic AE events remain until retention expiry.`);
  }
}
