import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";
import { LongContextJob } from "../src/long-context-job";
import { accountApi } from "../src/http/account-api";
import { accountClassification } from "../src/http/classification";
import { appEnvironment } from "../src/server/environment";
import { parseCreditInteger, postgresDatabase } from "../src/server/db";
import { performAction } from "../src/server/agents";
import { provisionTestAccount } from "../tests/support/account";
import type { Env } from "../src/index";

const report: { runtime: string; results: unknown[] } = {
  runtime: "account HTTP handler + job Durable Object + real PostgreSQL migrations/ledger + local Jev HTTP fixture",
  results: [],
};
const pg = new PGlite({ parsers: { 20: parseCreditInteger, 1700: parseCreditInteger } });
const db = postgresDatabase(queries => pg.transaction(async tx => {
  const results = [];
  for (const query of queries) {
    const result = await tx.query<Record<string, unknown>>(query.sql, query.params);
    results.push({ results: result.rows, meta: { changes: result.affectedRows ?? 0 } });
  }
  return results;
}));
let providerCalls = 0;
let failFinal = false;
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  providerCalls++;
  const body = await request.json() as { model: string; state: { id: string; text: string }[];
    questions: Record<string, { type?: string; criteria: Record<string, unknown> }> };
  const screening = Object.values(body.questions).some(q => Object.hasOwn(q.criteria ?? {}, "irrelevant"));
  if (!screening && failFinal) return Response.json({ detail: { error_type: "invalid_request" } }, { status: 400 });
  const answers = Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
    if (question.type === "noul") return [id, { noul: 0.9 }];
    const labels = Object.keys(question.criteria);
    const state = body.state.find(item => item.id === id) ?? body.state[0];
    const choice = screening ? state.text.includes("DECISIVE") ? "relevant" : "irrelevant" : labels[0];
    return [id, { choice, confidence: 0.99,
      probabilities: Object.fromEntries(labels.map(label => [label, label === choice ? 0.99 : 0.005])) }];
  }));
  return Response.json({ model: body.model, usage: { input_tokens: 1000, output_tokens: 0 }, answers });
} });
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input, init) => {
  assert.equal(String(input), "https://api.typesafe.ai/v1/systemone");
  return originalFetch(provider.url, init);
}) as typeof fetch;
const events: unknown[] = [];
const accountEvents: unknown[] = [];
const instances = new Map<string, LongContextJob>();
const stores = new Map<string, Map<string, unknown>>();
let env: Env & { APP_DB: typeof db };
const objects = {
  idFromName(name: string) { return name; },
  get(name: string) {
    if (!instances.has(name)) {
      const data = new Map<string, unknown>();
      stores.set(name, data);
      const storage = {
        get: async (key: string) => structuredClone(data.get(key)),
        put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); },
        delete: async (key: string) => data.delete(key),
        deleteAll: async () => { data.clear(); },
        setAlarm: async (_when: number) => {},
        transaction: async <T>(run: (value: unknown) => Promise<T>) => run(storage),
      };
      instances.set(name, new LongContextJob({ storage } as unknown as DurableObjectState, env));
    }
    return { fetch: (request: Request) => instances.get(name)!.fetch(request) };
  },
} as unknown as DurableObjectNamespace;
env = appEnvironment({ APP_DB: db, APP_ACCOUNTS_ENABLED: "true", SPENDING_ENABLED: "true",
  API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters",
  TYPESAFE_API_KEY: "fixture", AI_GATEWAY_DISABLED: "true", LONG_CONTEXT_JOBS: objects,
  LONG_CONTEXT_AE: { writeDataPoint(point: unknown) { events.push(point); } },
  ACCOUNT_AE: { writeDataPoint(point: unknown) { accountEvents.push(point); } },
} as unknown as Env & { APP_DB: typeof db });
const ctx = { waitUntil(_promise: Promise<unknown>) {} } as ExecutionContext;
const id = "00000000-0000-4000-8000-000000000001";
let secret = "";
async function send(method: string, path: string, body?: unknown, jobId = id) {
  const request = new Request(`https://classifier.dev/v1/long-context/jobs/${jobId}${path}`, {
    method, headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await accountClassification(request, env, "API", ctx);
  assert.ok(response);
  return response;
}
try {
  const preflight = await accountApi(new Request(`https://classifier.dev/v1/long-context/jobs/${id}/create`, {
    method: "OPTIONS", headers: { origin: "https://example.org", "access-control-request-method": "PUT" },
  }), env, ctx);
  assert.ok(preflight);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /PUT/);
  const directory = new URL("../migrations/postgres/", import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort())
    await pg.exec(await readFile(new URL(name, directory), "utf8"));
  await provisionTestAccount(new Request("http://localhost/auth/demo"), env);
  secret = String((await performAction("local-demo", { type: "enroll", client: "Codex" }, env)).secret);
  const createBody = { max_tokens: 10_000_000, documents: 1, labels: ["renewing", "not-renewing"] };
  const unfunded = await send("PUT", "/create", createBody);
  assert.equal(unfunded.status, 402);
  assert.equal(providerCalls, 0);
  await db.prepare("UPDATE app_accounts SET paid_balance=balance WHERE id='local-demo'").run();
  const created = await send("PUT", "/create", createBody);
  assert.equal(created.status, 201, await created.clone().text());
  assert.equal((await send("PUT", "/create", createBody)).status, 200);
  assert.equal((await created.json()).max_tokens, 10_000_000);
  const held = await db.prepare("SELECT status,credits FROM app_usage WHERE id=?")
    .bind((stores.get(id)?.get("job") as { reservationId: string }).reservationId).first<{ status: string; credits: number }>();
  assert.equal(held?.status, "pending");
  assert.equal(held?.credits, 84_000);
  const usageRows = await db.prepare("SELECT count(*)::integer AS n FROM app_usage WHERE account_id='local-demo'")
    .first<{ n: number }>();
  assert.equal(usageRows?.n, 1, "retrying creation keeps one hold");
  await db.prepare(`INSERT INTO app_accounts(id,email,name,reset_at,created_at,period_start,balance)
    SELECT 'local-other','other@example.com',name,reset_at,created_at,period_start,balance
    FROM app_accounts WHERE id='local-demo'`).run();
  const firstSecret = secret;
  secret = String((await performAction("local-other", { type: "enroll", client: "Codex" }, env)).secret);
  assert.equal((await send("GET", "/status")).status, 404);
  secret = firstSecret;
  report.results.push({ name: "10M limit accepted with exact $0.84 hold; free admission blocked", held });

  const part = `DECISIVE: The agreement automatically renews.\n\n${"Routine stationery inventory.\n\n".repeat(4000)}`;
  const parts = Array(13).fill(part) as string[];
  assert.ok(parts.reduce((sum, text) => sum + countTokens(text), 0) > 250_000);
  let count = 0;
  for (let i = 0; i < parts.length; i++) {
    const response = await send("PUT", `/parts/${i}`, { document: 0, text: parts[i] });
    assert.equal(response.status, 200, await response.clone().text());
    count += countTokens(parts[i]);
    assert.equal((await response.json()).context_tokens, count);
  }
  const duplicate = await send("PUT", "/parts/0", { document: 0, text: parts[0] });
  assert.equal(duplicate.status, 409);
  const finished = await send("POST", "/finish");
  assert.equal(finished.status, 200, await finished.clone().text());
  const result = await finished.json();
  assert.equal(result.results[0].label, "renewing");
  assert.equal(result.pricing.input_tokens, count);
  assert.equal(result.pricing.total_usd, count * 84 / 1e9);
  assert.equal(result.usage.long_context.screened_chunks, result.usage.long_context.chunks);
  assert.equal(events.length, 1);
  assert.equal(accountEvents.length, 1);
  const job = stores.get(id)?.get("job") as { reservationId: string; status: string };
  const ledger = await db.prepare("SELECT status,actual_nano::text AS nano FROM app_usage WHERE id=?")
    .bind(job.reservationId).first<{ status: string; nano: string }>();
  assert.equal(ledger?.status, "completed");
  assert.equal(ledger?.nano, String(count * 84));
  assert.equal(job.status, "finished");
  assert.equal(stores.get(id)?.has("doc:0"), false);
  report.results.push({ name: "more than 250k tokens screened in bounded parts, final judgment settled once", contextTokens: count,
    parts: parts.length, providerCalls, ledger, stats: result.usage.long_context });

  const retryId = "00000000-0000-4000-8000-000000000003";
  assert.equal((await send("PUT", "/create", { ...createBody, max_tokens: 50_000 }, retryId)).status, 201);
  const badPartCalls = providerCalls;
  const tooLargePart = await send("PUT", "/parts/0", { document: 0, text: " x".repeat(50_001) }, retryId);
  assert.equal(tooLargePart.status, 400);
  assert.equal(providerCalls, badPartCalls);
  assert.equal((await send("PUT", "/parts/0", { document: 0, text: part }, retryId)).status, 200);
  failFinal = true;
  const failedFinal = await send("POST", "/finish", undefined, retryId);
  assert.equal(failedFinal.status, 503);
  const retryJob = stores.get(retryId)?.get("job") as { reservationId: string; status: string };
  assert.equal(retryJob.status, "open");
  assert.equal((await db.prepare("SELECT status FROM app_usage WHERE id=?")
    .bind(retryJob.reservationId).first<{ status: string }>())?.status, "pending");
  failFinal = false;
  assert.equal((await send("POST", "/finish", undefined, retryId)).status, 200);
  const retryLedger = await db.prepare("SELECT status,actual_nano::text AS nano FROM app_usage WHERE id=?")
    .bind(retryJob.reservationId).first<{ status: string; nano: string }>();
  assert.equal(retryLedger?.status, "completed");
  assert.equal(retryLedger?.nano, String(countTokens(part) * 84));
  report.results.push({ name: "invalid part rejected before inference; failed final remains held and can be retried", ledger: retryLedger });

  const cancelId = "00000000-0000-4000-8000-000000000004";
  assert.equal((await send("PUT", "/create", { ...createBody, max_tokens: 50_000 }, cancelId)).status, 201);
  assert.equal((await send("PUT", "/parts/0", { document: 0, text: part }, cancelId)).status, 200);
  const cancelJob = stores.get(cancelId)?.get("job") as { reservationId: string };
  assert.equal((await send("POST", "/cancel", undefined, cancelId)).status, 200);
  assert.equal(stores.get(cancelId)?.has("doc:0"), false);
  assert.equal((await db.prepare("SELECT status FROM app_usage WHERE id=?")
    .bind(cancelJob.reservationId).first<{ status: string }>())?.status, "refunded");
  const expireId = "00000000-0000-4000-8000-000000000005";
  assert.equal((await send("PUT", "/create", { ...createBody, max_tokens: 50_000 }, expireId)).status, 201);
  const expireJob = stores.get(expireId)?.get("job") as { reservationId: string };
  await instances.get(expireId)!.alarm();
  assert.equal(stores.get(expireId)?.size, 0);
  assert.equal((await db.prepare("SELECT status FROM app_usage WHERE id=?")
    .bind(expireJob.reservationId).first<{ status: string }>())?.status, "refunded");
  report.results.push({ name: "cancel and expiry refund holds and delete selected evidence", status: "refunded" });
  assert.equal(accountEvents.length, 4);

  const emptyId = "00000000-0000-4000-8000-000000000007";
  assert.equal((await send("PUT", "/create", { ...createBody, max_tokens: 50_000 }, emptyId)).status, 201);
  assert.equal((await send("PUT", "/parts/0", { document: 0, text: "Routine inventory.\n".repeat(2000) }, emptyId)).status, 200);
  const noEvidence = await send("POST", "/finish", undefined, emptyId);
  assert.equal(noEvidence.status, 422);
  assert.equal((await noEvidence.json()).code, "long_context_no_evidence");
  const emptyJob = stores.get(emptyId)?.get("job") as { reservationId: string };
  assert.equal((await db.prepare("SELECT status FROM app_usage WHERE id=?")
    .bind(emptyJob.reservationId).first<{ status: string }>())?.status, "refunded");
  report.results.push({ name: "no evidence returns 422 with exact refund", status: "refunded" });

  const multiId = "00000000-0000-4000-8000-000000000006";
  assert.equal((await send("PUT", "/create", { ...createBody, max_tokens: 50_000, multi: true }, multiId)).status, 201);
  assert.equal((await send("PUT", "/parts/0", { document: 0, text: part }, multiId)).status, 200);
  const multiResponse = await send("POST", "/finish", undefined, multiId);
  assert.equal(multiResponse.status, 200, await multiResponse.clone().text());
  const multiResult = await multiResponse.json();
  assert.deepEqual(multiResult.results[0].labels, createBody.labels);
  assert.equal(multiResult.results[0].label, undefined);
  report.results.push({ name: "multi-label job returns the normal labels/scores shape", result: multiResult.results[0] });

  if (process.argv.includes("--full")) {
    const fullId = "00000000-0000-4000-8000-000000000002";
    const begin = await send("PUT", "/create", createBody, fullId);
    assert.equal(begin.status, 201, await begin.clone().text());
    const pieceTokens = countTokens(part);
    const completePieces = Math.floor(10_000_000 / pieceTokens);
    for (let i = 0; i < completePieces; i++) {
      const response = await send("PUT", `/parts/${i}`, { document: 0, text: part }, fullId);
      assert.equal(response.status, 200, `part ${i}: ${await response.clone().text()}`);
    }
    const remainder = 10_000_000 - completePieces * pieceTokens;
    assert.ok(remainder > 0 && remainder < 50_000);
    const last = await send("PUT", `/parts/${completePieces}`, { document: 0, text: " x".repeat(remainder) }, fullId);
    assert.equal(last.status, 200, await last.clone().text());
    assert.equal((await last.json()).context_tokens, 10_000_000);
    const complete = await send("POST", "/finish", undefined, fullId);
    assert.equal(complete.status, 200, await complete.clone().text());
    const completed = await complete.json();
    assert.equal(completed.pricing.total_usd, 0.84);
    assert.equal(completed.usage.long_context.context_tokens, 10_000_000);
    assert.equal(completed.usage.long_context.screened_chunks, completed.usage.long_context.chunks);
    const fullJob = stores.get(fullId)?.get("job") as { reservationId: string };
    const settled = await db.prepare("SELECT status,actual_nano::text AS nano FROM app_usage WHERE id=?")
      .bind(fullJob.reservationId).first<{ status: string; nano: string }>();
    assert.equal(settled?.status, "completed");
    assert.equal(settled?.nano, "840000000");
    report.results.push({ name: "full 10M token boundary, every chunk screened and exact $0.84 settlement",
      parts: completePieces + 1, chunks: completed.usage.long_context.chunks,
      providerCalls, ledger: settled, pricing: completed.pricing });
  }
} finally {
  globalThis.fetch = originalFetch;
  provider.stop();
  await mkdir("captures", { recursive: true });
  await writeFile("captures/long-context-job.json", JSON.stringify(report, null, 2));
  await pg.close();
}
console.log(`${report.results.length} job E2E scenarios passed; captures/long-context-job.json`);
