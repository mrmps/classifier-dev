import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { accountClassification } from "../src/http/classification";
import { parseCreditInteger, postgresDatabase } from "../src/server/db";
import { appEnvironment } from "../src/server/environment";
import { performAction } from "../src/server/agents";
import { provisionTestAccount } from "../tests/support/account";
import type { Env } from "../src/index";

/**
 * Jev-Omni through a workspace key, against the migrated ledger: exact
 * settlement of the tokens the pod reports, refunds when it cannot answer,
 * idempotency, no answer before quota admission, and nothing private in
 * analytics. The same checks image-billing.ts makes of imajev.
 */
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
const MEDIA = "data:audio/wav;base64,UklGRlBSSVZBVEU=";
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  assert.equal(request.headers.get("authorization"), "Bearer private-pod-token");
  assert.equal(request.headers.get("x-classifier-share-data"), null);
  const body = await request.json() as Record<string, unknown>;
  assert.equal(body.model, "jev-omni");
  assert.deepEqual(Object.keys(body).sort(), ["media", "model", "questions", "state"]);
  assert.deepEqual(body.media, [MEDIA]);
  calls++;
  providerStarted?.();
  if (mode === "busy") return Response.json({ error: { type: "jevomni_busy", message: "Busy" } }, { status: 429 });
  return Response.json({ model: "jev-omni", answers: {
    subject: { type: "choice", choice: "refund", probabilities: { refund: 0.97, crash: 0.03 }, confidence: 0.97 },
  }, usage: mode === "missing-usage" ? {} : { input_tokens: 1000, output_tokens: 0, forward_passes: 1, inference_ms: 180 } });
} });
const pending: Promise<unknown>[] = [];
const kv = new Map<string, string>();
const points: unknown[] = [];
// imajev is deliberately not configured: Jev-Omni must not depend on it.
const env = appEnvironment({ APP_DB: db, APP_ACCOUNTS_ENABLED: "true", SPENDING_ENABLED: "true",
  PRIVACY_SALT: "local-e2e-privacy", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters",
  JEVOMNI_URL: `${provider.url}v1/systemone`, JEVOMNI_TOKEN: "private-pod-token",
  STATS: { get: async (key: string) => kv.get(key) ?? null, put: async (key: string, value: string) => { kv.set(key, value); } },
  ACCOUNT_AE: { writeDataPoint(point: unknown) { points.push(point); } },
} as unknown as Env & { APP_DB: typeof db });
const ctx = { waitUntil(p: Promise<unknown>) { pending.push(p); } } as ExecutionContext;
const body = { model: "jev-omni", media: [MEDIA], state: "PRIVATE VOICEMAIL CONTEXT", share_data: true,
  questions: { subject: { type: "choice", instructions: "PRIVATE QUESTION", criteria: { refund: null, crash: null } } } };
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

  // 1,000 tokens at $0.042 per million is exactly 42,000 nanodollars.
  const success = await send(body, key, "omni-once");
  assert.equal(success.response.status, 200);
  assert.deepEqual(success.row, { status: "completed", nano: "42000", tokens: 1000 });
  assert.deepEqual(success.result, { model: "jev-omni", answers: {
    subject: { type: "choice", choice: "refund", probabilities: { refund: 0.97, crash: 0.03 }, confidence: 0.97 },
  }, usage: { input_tokens: 1000, output_tokens: 0 } });
  // Media is never kept for training, even when the caller asked to share.
  assert.equal(success.response.headers.get("x-classifier-data-sharing"), "off");
  assert.equal((await send(body, key, "omni-once")).response.status, 409);
  assert.equal(calls, 1);

  // The same request carrying `images` rather than `media` is still Jev-Omni's.
  const { media, ...rest } = body;
  const viaImages = await send({ ...rest, images: [MEDIA] });
  assert.equal(viaImages.response.status, 200);
  assert.deepEqual(viaImages.row, { status: "completed", nano: "42000", tokens: 1000 });
  assert.equal(calls, 2);

  assert.equal((await send(body, "classifier_agent_invalid")).response.status, 401);
  assert.equal((await send({ ...body, media: ["http://127.0.0.1/private.wav"] })).response.status, 400);
  assert.equal((await send({ ...body, media: [MEDIA, MEDIA] })).response.status, 400);
  assert.equal(calls, 2, "Refused requests must not reach the GPU");

  mode = "busy";
  const busy = await send();
  assert.equal(busy.response.status, 429);
  assert.equal(busy.row?.status, "refunded");
  mode = "missing-usage";
  const missing = await send();
  assert.equal(missing.response.status, 502);
  assert.equal(missing.row?.status, "refunded");
  assert.doesNotMatch(JSON.stringify(points), /PRIVATE|UklGRl|private-pod-token|classifier_agent_/);
  assert.equal((await db.prepare("SELECT COUNT(*)::integer AS n FROM app_usage WHERE status='pending'").first())?.n, 0);

  // A quota refusal that lands while the GPU is already working must still win:
  // no answer escapes and the reservation is refunded.
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
  const refused = send(body, key, "omni-denied-during-inference").then(value => { returned = true; return value; });
  await quotaStarted;
  await Promise.race([inferenceStarted, new Promise((_, reject) => setTimeout(() => reject(new Error("Inference waited for quota")), 1000))]);
  assert.equal(returned, false, "An answer must never escape before exact quota admission");
  releaseQuota!(Response.json({ limited: true, remaining: 0, resetIn: 60 }));
  const denied = await refused;
  assert.equal(denied.response.status, 429);
  assert.equal(denied.row?.status, "refunded");
  assert.equal((denied.result as { answers?: unknown }).answers, undefined);
  console.log("Jev-Omni admission, exact settlement, idempotency, refusal refunds, and privacy passed");
} finally {
  await mkdir("captures", { recursive: true });
  await writeFile("captures/jevomni-billing.json", JSON.stringify({ runtime: "HTTP provider fixture + account handler + migrated PostgreSQL ledger", evidence }, null, 2));
  provider.stop(true);
  await pg.close();
}
