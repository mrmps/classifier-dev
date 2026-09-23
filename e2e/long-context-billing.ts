import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";
import { accountClassification } from "../src/http/classification";
import { AppError, parseCreditInteger, postgresDatabase } from "../src/server/db";
import { appEnvironment } from "../src/server/environment";
import { performAction } from "../src/server/agents";
import { provisionTestAccount } from "../tests/support/account";
import { RateLimiter } from "../src/limiter";
import type { Env } from "../src/index";

// Run with bun e2e/long-context-billing.ts. Real migrations, ledger and Worker
// inference; only provider responses and Cloudflare storage bindings are fixtures.
const live = process.argv.includes("--live");
if (live && !process.env.TYPESAFE_API_KEY) throw new Error("--live requires TYPESAFE_API_KEY.");
const artifact = `captures/long-context-billing${live ? "-live" : ""}.json`;
type AnalyticsPoint = { indexes: string[]; blobs: string[]; doubles: number[] };
const longEvents: AnalyticsPoint[] = [];
const report: { runtime: string; results: unknown[]; dedicatedAnalytics: AnalyticsPoint[] } = {
  runtime: `Bun account HTTP handler → Worker inference → ${live ? "real TypeSafe" : "local HTTP provider"}; in-memory PGlite with all migrations; DATABASE_URL ignored`,
  results: [],
  dedicatedAnalytics: longEvents,
};
const pg = new PGlite({ parsers: { 20: parseCreditInteger, 1700: parseCreditInteger } });
const originalFetch = globalThis.fetch;
let providerCalls = 0;
let reportedTokens = 123;
let mode: "normal" | "none" | "fail-final" = "normal";
const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  providerCalls++;
  const body = await request.json() as { model: string; questions: Record<string, { criteria: Record<string, unknown> }> };
  const screening = Object.values(body.questions).some(q => Object.hasOwn(q.criteria, "irrelevant"));
  if (!screening && mode === "fail-final")
    return Response.json({ detail: { error_type: "invalid_request" } }, { status: 400 });
  return Response.json({ model: body.model, usage: { input_tokens: reportedTokens, output_tokens: 0 },
    answers: Object.fromEntries(Object.entries(body.questions).map(([id, q]) => {
      const labels = Object.keys(q.criteria);
      const choice = screening ? mode === "none" ? "irrelevant" : "relevant" : labels[0];
      return [id, { choice, confidence: 0.99,
        probabilities: Object.fromEntries(labels.map(label => [label, label === choice ? 0.99 : 0.01 / (labels.length - 1)])) }];
    })),
  });
} });
globalThis.fetch = ((input, init) => {
  assert.equal(String(input), "https://api.typesafe.ai/v1/systemone", "unexpected external request");
  if (live) { providerCalls++; return originalFetch(input, init); }
  return originalFetch(provider.url, init);
}) as typeof fetch;

const objects = new Map<string, RateLimiter>();
const limiter = {
  idFromName: (name: string) => name,
  get(name: string) {
    if (!objects.has(name)) {
      const data = new Map<string, unknown>();
      let queue = Promise.resolve();
      objects.set(name, new RateLimiter({ storage: {
        get: async (key: string) => structuredClone(data.get(key)),
        put: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) data.set(key, structuredClone(value));
        },
      }, blockConcurrencyWhile<T>(run: () => Promise<T>) {
        const result = queue.then(run);
        queue = result.then(() => {}, () => {});
        return result;
      } } as unknown as DurableObjectState));
    }
    return { fetch: (input: string | Request) => objects.get(name)!.fetch(new Request(input)) };
  },
} as unknown as DurableObjectNamespace;
const db = postgresDatabase(queries => pg.transaction(async tx => {
  const results = [];
  for (const query of queries) {
    const result = await tx.query<Record<string, unknown>>(query.sql, query.params);
    results.push({ results: result.rows, meta: { changes: result.affectedRows ?? 0 } });
  }
  return results;
}));
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } } as ExecutionContext;
async function flush() { while (pending.length) await Promise.all(pending.splice(0)); }
const kv = new Map<string, string>();
const events: { doubles: number[] }[] = [];
const env = appEnvironment({ APP_DB: db, APP_ACCOUNTS_ENABLED: "true", SPENDING_ENABLED: "true",
  PRIVACY_SALT: "local-e2e-privacy", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters",
  TYPESAFE_API_KEY: live ? process.env.TYPESAFE_API_KEY : "fixture", AI_GATEWAY_DISABLED: "true", LIMITER: limiter,
  STATS: { get: async (key: string) => kv.get(key) ?? null, put: async (key: string, value: string) => { kv.set(key, value); } },
  ACCOUNT_AE: { writeDataPoint(point: { doubles: number[] }) { events.push(point); } },
  LONG_CONTEXT_AE: { writeDataPoint(point: AnalyticsPoint) { longEvents.push(point); } },
} as unknown as Env & { APP_DB: typeof db });
const document = "This contract renews annually. 文書の更新条件.\n\n".repeat(850);
const contextTokens = countTokens(document);
const nano = contextTokens * 84;
const body = { input: document, labels: ["renewing", "not-renewing"] };
let secret = "";
async function send(payload: Record<string, unknown> = body, idem?: string) {
  const eventStart = longEvents.length;
  const request = new Request("https://classifier.dev/v1/classify", { method: "POST", headers: {
    authorization: `Bearer ${secret}`, "content-type": "application/json", "cf-connecting-ip": "203.0.113.1",
    ...(idem ? { "idempotency-key": idem } : {}),
  }, body: JSON.stringify(payload) });
  let response: Response | null;
  try { response = await accountClassification(request, env, "API", ctx); }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    response = Response.json({ error: error.message }, { status: error.status });
  }
  assert.ok(response);
  await flush();
  const points = longEvents.slice(eventStart);
  const result = await response.clone().json();
  if (["long_context_no_evidence", "long_context_unavailable"].includes(result.code))
    assert.equal(points.length, 1, "one dedicated event for failed inference");
  if (response.ok && result.usage?.long_context) {
    assert.equal(points.length, 1, "one dedicated event per completed request");
    const stats = result.usage.long_context;
    assert.deepEqual(points[0].doubles, [1, stats.context_tokens, stats.documents, stats.chunks,
      stats.screened_chunks, stats.eligible_chunks, stats.selected_chunks, stats.omitted_chunks,
      stats.screening_input_tokens ?? 0, stats.final_input_tokens ?? 0,
      Number(stats.screening_input_tokens === null), Number(stats.final_input_tokens === null),
      stats.screening_calls, stats.final_calls, stats.screening_ms, stats.final_ms]);
    assert.ok(stats.screening_calls > 0 && stats.final_calls > 0);
    assert.equal(stats.screening_input_tokens + stats.final_input_tokens, result.usage.input_tokens);
  }
  assert.ok(points.length <= 1, "no duplicate dedicated analytics");
  for (const point of points) {
    assert.deepEqual(Object.keys(point).sort(), ["blobs", "doubles", "indexes"]);
    assert.deepEqual(point.indexes, []);
    assert.deepEqual(point.blobs, ["1", response.ok ? "success" : "error", "cl100k_base"]);
    assert.ok(point.doubles.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0));
    const serialized = JSON.stringify(point);
    assert.ok(!serialized.includes(secret) && !serialized.includes("203.0.113.1"));
    const raw = payload.input ?? payload.inputs ?? payload.items;
    for (const text of Array.isArray(raw) ? raw : [raw])
      if (typeof text === "string" && text.length > 32_000) assert.ok(!serialized.includes(text.slice(0, 100)));
  }
  return response;
}
const balance = () => db.prepare("SELECT balance::text,paid_balance::text,fractional_spend_nano::text FROM app_accounts WHERE id='local-demo'").first();
const ledger = (response: Response) => db.prepare("SELECT status,actual_nano::text AS nano,input_tokens::integer AS input_tokens,escalations,rate_version FROM app_usage WHERE id=?")
  .bind(response.headers.get("x-request-id")).first();
try {
  const directory = new URL("../migrations/postgres/", import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort())
    await pg.exec(await readFile(new URL(name, directory), "utf8"));
  await provisionTestAccount(new Request("http://localhost/auth/demo"), env);
  secret = String((await performAction("local-demo", { type: "enroll", client: "Codex" }, env)).secret);
  if (live) {
    await db.prepare("UPDATE app_accounts SET paid_balance=balance WHERE id='local-demo'").run();
    const filler = "The office inventory includes paper clips, plain envelopes, spare pencils and desktop organizers.\n\n";
    for (const [expected, clause] of [
      ["renewing", "This contract automatically renews for another year at the end of its term without any further action by either party."],
      ["not-renewing", "This contract does not automatically renew. It expires at the end of its term. A new contract signed by both parties is required to continue."],
    ]) {
      const input = `Office supply agreement.\n\n${filler.repeat(250)}Binding renewal clause: ${clause}\n\n${filler.repeat(250)}End of agreement.`;
      assert.ok(input.length > 40000);
      const tokens = countTokens(input);
      const before = providerCalls;
      const response = await send({ input, labels: body.labels,
        instructions: "Determine whether this contract automatically renews at the end of its term. Apply the binding renewal clause. Choose renewing only for automatic renewal; otherwise choose not-renewing." });
      assert.equal(response.status, 200, await response.clone().text());
      const payload = await response.json();
      const row = await ledger(response);
      report.results.push({ name: `real TypeSafe ${expected}`, characters: input.length, expected,
        actual: payload.results[0].label, providerCalls: providerCalls - before, pricing: payload.pricing,
        usage: payload.usage, ledger: row });
      assert.equal(payload.results[0].label, expected);
      assert.equal(payload.pricing.input_tokens, tokens);
      assert.equal(payload.pricing.total_usd, tokens * 84 / 1e9);
      assert.equal(row?.status, "completed");
      assert.equal(row?.nano, String(tokens * 84));
      assert.equal(row?.input_tokens, payload.usage.input_tokens);
      assert.ok(payload.usage.input_tokens > 0);
      assert.ok(payload.usage.long_context.screening_calls > 0);
      assert.ok(payload.usage.long_context.final_calls > 0);
    }
  } else for (const spending of ["true", "false"]) {
    env.SPENDING_ENABLED = spending;
    await db.prepare("UPDATE app_accounts SET billing_plan='free',paid_balance=0,balance=500000 WHERE id='local-demo'").run();
    let before = providerCalls;
    const free = await send();
    assert.equal(free.status, 402);
    assert.equal((await free.json()).code, "long_context_payment_required");
    assert.equal(providerCalls, before);
    report.results.push({ spending, name: "signup-credit account refused before provider", status: free.status });

    await db.prepare("UPDATE app_accounts SET paid_balance=balance WHERE id='local-demo'").run();
    reportedTokens = 123;
    before = providerCalls;
    const first = await send(body, `once-${spending}`);
    assert.equal(first.status, 200, await first.clone().text());
    const payload = await first.json();
    assert.equal(payload.pricing.total_usd, nano / 1e9);
    assert.equal(payload.pricing.estimated_usd, nano / 1e9);
    assert.equal(payload.pricing.input_tokens, contextTokens);
    assert.equal(payload.pricing.input_usd_per_million, 0.084);
    assert.equal(payload.pricing.tokenizer, "cl100k_base");
    assert.equal(payload.usage.input_tokens, (providerCalls - before) * reportedTokens);
    const row = await ledger(first);
    assert.equal(row?.status, "completed");
    assert.equal(row?.nano, String(nano));
    assert.equal(row?.input_tokens, payload.usage.input_tokens);
    assert.equal(row?.escalations, 0);
    assert.equal(events.at(-1)?.doubles[2], payload.usage.input_tokens);
    report.results.push({ spending, name: "paid credits on free plan settle original tokens once", pricing: payload.pricing, usage: payload.usage, ledger: row });

    before = providerCalls;
    const paidBalance = await balance();
    const duplicate = await send(body, `once-${spending}`);
    assert.equal(duplicate.status, 409);
    assert.equal(providerCalls, before);
    assert.deepEqual(await balance(), paidBalance);
    reportedTokens = 789;
    const different = await send();
    assert.equal(different.status, 200, await different.clone().text());
    const changed = await different.json();
    assert.equal(changed.pricing.total_usd, nano / 1e9);
    assert.notEqual(changed.usage.input_tokens, payload.usage.input_tokens);
    assert.equal((await ledger(different))?.nano, String(nano));
    report.results.push({ spending, name: "idempotency and provider-usage independence", duplicate: duplicate.status, changedProviderTokens: changed.usage.input_tokens });

    reportedTokens = 0;
    const zeroCost = await send();
    assert.equal(zeroCost.status, 200, await zeroCost.clone().text());
    assert.equal((await zeroCost.json()).pricing.total_usd, nano / 1e9);
    assert.equal((await ledger(zeroCost))?.nano, String(nano));
    assert.equal((await ledger(zeroCost))?.status, "completed");
    report.results.push({ spending, name: "zero provider cost still charges the original context tariff" });
    reportedTokens = 789;

    const dimensions = await send({ items: [document], dimensions: { renewal: ["yes", "no"], type: ["contract", "other"] } });
    assert.equal(dimensions.status, 200, await dimensions.clone().text());
    assert.equal((await dimensions.json()).pricing.input_tokens, contextTokens);
    assert.equal((await ledger(dimensions))?.nano, String(nano));
    report.results.push({ spending, name: "dimensions charge original document once" });

    for (const failure of ["none", "fail-final"] as const) {
      mode = failure;
      const previous = await balance();
      const failed = await send();
      assert.equal(failed.status, failure === "none" ? 422 : 503, await failed.clone().text());
      assert.equal((await ledger(failed))?.status, "refunded");
      assert.deepEqual(await balance(), previous);
      report.results.push({ spending, name: failure, status: failed.status, ledger: await ledger(failed) });
    }
    mode = "normal";
    const ambiguous = [
      ...[{ inputs: 42 }, { inputs: [] }, { inputs: "short" }, { items: null }].map(aliases => ({ ...body, ...aliases })),
      { items: [document], input: "short", labels: body.labels },
      { items: [document], labels: body.labels },
      { input: document, inputs: ["short"], dimensions: { kind: ["yes", "no"] } },
    ];
    for (const invalid of ambiguous) {
      before = providerCalls;
      const rows = await db.prepare("SELECT count(*)::integer AS n FROM app_usage").first();
      const rejected = await send(invalid);
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).code, "invalid_request");
      assert.equal(providerCalls, before);
      assert.deepEqual(await db.prepare("SELECT count(*)::integer AS n FROM app_usage").first(), rows);
    }
    report.results.push({ spending, name: "ambiguous aliases rejected before reservation" });
    const limits: [Record<string, unknown>, string][] = [
      [{ inputs: [document, ...Array(20).fill("short")], labels: body.labels }, "too_many_inputs"],
      [{ input: document, dimensions: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`field${i}`, ["yes", "no"]])) }, "too_many_decisions"],
      [{ ...body, tier: "smart" }, "bad_tier"],
      [{ input: " x".repeat(250001), labels: body.labels }, "long_context_too_large"],
      [{ inputs: [document, ""], labels: body.labels }, "long_context_input"],
    ];
    for (const [invalid, code] of limits) {
      before = providerCalls;
      const rows = await db.prepare("SELECT count(*)::integer AS n FROM app_usage").first();
      const rejected = await send(invalid);
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json()).code, code);
      assert.equal(providerCalls, before);
      assert.deepEqual(await db.prepare("SELECT count(*)::integer AS n FROM app_usage").first(), rows);
    }
    report.results.push({ spending, name: "documented preflight error codes without reservation", codes: limits.map(([, code]) => code) });
    await db.prepare("UPDATE app_accounts SET billing_plan='pro',paid_balance=0,reset_at=? WHERE id='local-demo'")
      .bind(new Date(Date.now() + 86400000).toISOString()).run();
    const subscription = await send();
    assert.equal(subscription.status, 200, await subscription.clone().text());
    assert.equal((await ledger(subscription))?.nano, String(nano));
    report.results.push({ spending, name: "active subscription qualifies without paid credits" });
  }
} finally {
  globalThis.fetch = originalFetch;
  await flush();
  await pg.close();
  await provider.stop(true);
  await mkdir("captures", { recursive: true });
  await writeFile(artifact, JSON.stringify(report, null, 2));
}
console.log(`${report.results.length} billing E2E scenarios passed; ${artifact}`);
