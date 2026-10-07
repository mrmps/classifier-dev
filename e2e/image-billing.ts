import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { accountClassification } from "../src/http/classification";
import { parseCreditInteger, postgresDatabase } from "../src/server/db";
import { appEnvironment } from "../src/server/environment";
import { performAction } from "../src/server/agents";
import { provisionTestAccount } from "../tests/support/account";
import type { Env } from "../src/index";

const pg = new PGlite({ parsers: { 20: parseCreditInteger, 1700: parseCreditInteger } });
const db = postgresDatabase(queries => pg.transaction(async tx => {
  const results = [];
  for (const query of queries) {
    const result = await tx.query<Record<string, unknown>>(query.sql, query.params);
    results.push({ results: result.rows, meta: { changes: result.affectedRows ?? 0 } });
  }
  return results;
}));
const evidence: unknown[] = [];
let mode = "ok", calls = 0;
let providerStarted: (() => void) | undefined;
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  assert.equal(request.headers.get("authorization"), "Bearer private-pod-token");
  assert.equal(request.headers.get("x-classifier-share-data"), null);
  const body = await request.json() as Record<string, unknown>;
  assert.equal(body.model, "imajev-4b");
  assert.equal(body.share_data, undefined);
  calls++;
  providerStarted?.();
  if (mode === "busy") return Response.json({ error: "Busy" }, { status: 429 });
  return Response.json({ model: "imajev-4b", answers: {
    subject: { type: "choice", choice: "cat", probabilities: { cat: 0.98, dog: 0.02 }, confidence: 0.96,
      unknown_probability: 0.01, abstained: false },
  }, usage: mode === "missing-usage" ? {} : { input_tokens: 1000, output_tokens: 0 } });
} });
const pending: Promise<unknown>[] = [];
const kv = new Map<string, string>();
const points: unknown[] = [];
const env = appEnvironment({ APP_DB: db, APP_ACCOUNTS_ENABLED: "true", SPENDING_ENABLED: "true",
  PRIVACY_SALT: "local-e2e-privacy", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters",
  IMAJEV_URL: `${provider.url}v1/systemone`, IMAJEV_TOKEN: "private-pod-token",
  STATS: { get: async (key: string) => kv.get(key) ?? null, put: async (key: string, value: string) => { kv.set(key, value); } },
  ACCOUNT_AE: { writeDataPoint(point: unknown) { points.push(point); } },
} as unknown as Env & { APP_DB: typeof db });
const ctx = { waitUntil(p: Promise<unknown>) { pending.push(p); } } as ExecutionContext;
const body = { model: "imajev-4b", images: ["data:image/png;base64,aGVsbG8="], state: "PRIVATE IMAGE CONTEXT",
  share_data: false, questions: { subject: { type: "choice", instructions: "PRIVATE QUESTION", criteria: { cat: null, dog: null } } } };
let key = "";
async function send(payload: unknown = body, credential = key, idem?: string) {
  const response = await accountClassification(new Request("https://classifier.dev/v1/systemone", {
    method: "POST", headers: { authorization: `Bearer ${credential}`, "content-type": "application/json",
      ...(idem ? { "idempotency-key": idem } : {}) }, body: JSON.stringify(payload),
  }), env, "API", ctx);
  assert.ok(response);
  while (pending.length) await Promise.all(pending.splice(0));
  const row = await db.prepare("SELECT status,actual_nano::text AS nano,input_tokens::integer AS tokens FROM app_usage WHERE id=?")
    .bind(response.headers.get("x-request-id")).first();
  const result = await response.json();
  evidence.push({ mode, status: response.status, result, ledger: row });
  return { response, row, result };
}
try {
  const directory = new URL("../migrations/postgres/", import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort())
    await pg.exec(await readFile(new URL(name, directory), "utf8"));
  await provisionTestAccount(new Request("http://localhost/auth/demo"), env);
  key = String((await performAction("local-demo", { type: "enroll", client: "Codex" }, env)).secret);
  await db.prepare("UPDATE app_accounts SET paid_balance=balance WHERE id='local-demo'").run();
  const success = await send(body, key, "image-once");
  assert.equal(success.response.status, 200);
  assert.deepEqual(success.row, { status: "completed", nano: "42000", tokens: 1000 });
  assert.equal((await send(body, key, "image-once")).response.status, 409);
  assert.equal(calls, 1);
  assert.equal((await send(body, "classifier_agent_invalid")).response.status, 401);
  assert.equal(calls, 1);
  assert.equal((await send({ ...body, images: ["http://127.0.0.1/private"] })).response.status, 400);
  assert.equal(calls, 1);
  mode = "busy";
  const busy = await send();
  assert.equal(busy.response.status, 429);
  assert.equal(busy.row?.status, "refunded");
  mode = "missing-usage";
  const missing = await send();
  assert.equal(missing.response.status, 502);
  assert.equal(missing.row?.status, "refunded");
  assert.doesNotMatch(JSON.stringify(points), /PRIVATE|aGVsbG8|private-pod-token|classifier_agent_/);
  assert.equal((await db.prepare("SELECT COUNT(*)::integer AS n FROM app_usage WHERE status='pending'").first())?.n, 0);
  mode = "ok";
  env.IMAJEV_SERVICE = { fetch: async (input: RequestInfo | URL, init: RequestInit) => {
    assert.equal(String(input), "http://imajev/v1/systemone");
    return fetch(`${provider.url}v1/systemone`, init);
  } } as Fetcher;
  const privateService = await send(body, key, "private-image-once");
  assert.equal(privateService.response.status, 200);
  assert.deepEqual(privateService.row, { status: "completed", nano: "42000", tokens: 1000 });
  mode = "busy";
  const privateBusy = await send();
  assert.equal(privateBusy.response.status, 429);
  assert.equal(privateBusy.row?.status, "refunded");
  mode = "ok";
  let releaseQuota: ((value: Response) => void) | undefined;
  let enteredQuota: (() => void) | undefined;
  env.LIMITER = { idFromName: (name: string) => name, get: () => ({ fetch: () => {
    enteredQuota?.();
    return new Promise<Response>(resolve => { releaseQuota = resolve; });
  } }) } as unknown as DurableObjectNamespace;
  const quotaStarted = new Promise<void>(resolve => { enteredQuota = resolve; });
  const inferenceStarted = new Promise<void>(resolve => { providerStarted = resolve; });
  let returned = false;
  const refused = send(body, key, "denied-during-inference").then(value => { returned = true; return value; });
  await quotaStarted;
  await Promise.race([inferenceStarted, new Promise((_, reject) => setTimeout(() => reject(new Error("Inference waited for quota")), 1000))]);
  assert.equal(returned, false, "An answer must never escape before exact quota admission");
  releaseQuota!(Response.json({ limited: true, remaining: 0, resetIn: 60 }));
  const denied = await refused;
  assert.equal(denied.response.status, 429);
  assert.equal(denied.row?.status, "refunded");
  assert.equal((denied.result as { answers?: unknown }).answers, undefined);
  console.log("Image admission, exact settlement, idempotency, refusal refunds, and privacy passed");
} finally {
  await mkdir("captures", { recursive: true });
  await writeFile("captures/image-billing.json", JSON.stringify({ runtime: "HTTP provider fixture + account handler + migrated PostgreSQL ledger", evidence }, null, 2));
  provider.stop(true);
  await pg.close();
}
