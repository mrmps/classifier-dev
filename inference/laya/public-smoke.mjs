// Synthetic public-path checks; no key, customer payload, or account identifier.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const endpoint = "https://classifier.dev/v1/classify";
const base = { input: "Please refund the duplicate invoice payment.", labels: ["billing", "technical"] };
const report = { checkedAt: new Date().toISOString(), endpoint, checks: {} };

async function call(body, retry = false) {
  const deadline = Date.now() + 180_000;
  let attempts = 0;
  while (true) {
    const started = performance.now();
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const data = await response.json();
    const ms = Math.round(performance.now() - started);
    attempts++;
    if (retry && [429, 503].includes(response.status) && Date.now() < deadline) {
      const wait = Number(response.headers.get("retry-after")) || 5;
      if (Date.now() + wait * 1000 >= deadline) throw new Error("retry deadline exceeded");
      await new Promise(resolve => setTimeout(resolve, wait * 1000));
      continue;
    }
    return { status: response.status, data, ms, attempts, lane: response.headers.get("x-classifier-processing"), limit: response.headers.get("ratelimit-limit") };
  }
}

const jev = await call(base);
assert.equal(jev.status, 200);
assert.match(jev.data.model, /^jev/);
report.checks.jevDefault = { status: jev.status, model: jev.data.model };
const timings = [];
const serverTimings = [];
for (let i = 0; i < 8; i++) {
  const result = await call({ ...base, model: "laya", processing: "fast" }, true);
  assert.equal(result.status, 200);
  assert.equal(result.data.model, "laya-0.3.4-english-fast");
  assert.equal(result.lane, "fast");
  assert.equal(result.limit, "60");
  assert.equal(result.data.results.length, 1);
  timings.push(result.ms);
  serverTimings.push(result.data.usage.ms);
}
report.checks.fast = { status: 200, samples: 8, roundTripMs: timings, serverProcessingMs: serverTimings, scope: "Single client, sequential requests; not a global latency benchmark" };
console.log("Fast public route passed");
const invalid = await call({ ...base, model: "laya", processing: ["bulk"] });
assert.equal(invalid.status, 400);
report.checks.invalidLane = invalid.status;
const tooMany = await call({ labels: base.labels, inputs: [base.input, base.input], model: "laya", processing: "fast" });
assert.equal(tooMany.status, 400);
report.checks.fastBatchRejected = tooMany.status;
const ready = await call({ ...base, model: "laya", processing: "bulk" }, true);
assert.equal(ready.status, 200);
assert.equal(ready.data.model, "laya-0.3.4-english-bulk");
report.checks.bulkStartupAttempts = ready.attempts;
const bulk = await call({ labels: base.labels, inputs: Array(128).fill(base.input), model: "laya", processing: "bulk" }, true);
assert.equal(bulk.status, 200);
assert.equal(bulk.data.results.length, 128);
assert.ok(bulk.data.results.every(row => row.model === "laya-0.3.4-english-bulk"));
report.checks.bulk = { status: bulk.status, rows: 128, roundTripMs: bulk.ms, serverProcessingMs: bulk.data.usage.ms, attempts: bulk.attempts };
const languages = [base.input, "मुझसे दो बार शुल्क लिया गया है। कृपया मेरा पैसा वापस कर दें।",
  "Me han cobrado dos veces en mi cuenta. Por favor, quiero que me devuelvan el dinero.", "The application crashes every time I log in."];
const mixed = await call({ inputs: languages, labels: base.labels, model: "laya", processing: "bulk" }, true);
assert.equal(mixed.status, 200);
assert.equal(mixed.data.model, "mixed");
assert.deepEqual(mixed.data.results.map(row => row.model), ["english", "multilingual", "multilingual", "english"].map(checkpoint => `laya-0.3.4-${checkpoint}-bulk`));
const hindi = await call({ input: languages[1], labels: base.labels, model: "laya", processing: "fast" }, true);
assert.equal(hindi.status, 200);
assert.equal(hindi.data.model, "laya-0.3.4-multilingual-fast");
report.checks.routing = { fastHindi: hindi.data.model, mixedBulkModels: mixed.data.results.map(row => row.model), orderPreserved: true };
await mkdir(new URL("../../eval/data/", import.meta.url), { recursive: true });
await writeFile(new URL("../../eval/data/laya-public-checks.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
