import { afterEach, beforeEach, expect, test } from "bun:test";
import worker, { type Env } from "../src/index";
import { newMeter } from "../src/cost";
import { provisionTestAccount } from "./support/account";
import { performAction } from "../src/server/agents";
import { getSnapshot } from "../src/server/accounts";
import { authorizeAndReserve } from "../src/server/usage";
import { settleTokenReservation, refundTokenReservation } from "../src/server/token-ledger";
import { parseTokenRateCard, priceTokens } from "../src/server/token-pricing";
import type { AppEnv } from "../src/server/db";
import { database } from "./support/postgres";

// Fixture prices prove mechanics only; these are not approved retail prices.
const card = parseTokenRateCard(JSON.stringify({ version: "fixture-v1", models: [
  { provider: "typesafe", model: "jev-fixture", inputUsdPerMillion: "0.042", outputUsdPerMillion: "0", cachedInputUsdPerMillion: "0.042" },
] }));
const originalFetch = globalThis.fetch;
let env: AppEnv;
let token: string;
beforeEach(async () => {
  env = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" };
  await provisionTestAccount(new Request("http://localhost/auth/demo", { headers: { origin: "http://localhost" } }), env);
  token = (await performAction("local-demo", { type: "create-key", name: "Token fixture" }, env)).secret!;
});
afterEach(() => { globalThis.fetch = originalFetch; });
const request = () => new Request("http://localhost/v1/classify", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ inputs: ["invoice question"], labels: ["billing", "support"] }),
});

test("authenticated reserve → inference meter → token price → settlement → dashboard uses actual tokens", async () => {
  let reportedTokens = 100;
  globalThis.fetch = (async () => Response.json({
    model: "jev-fixture", usage: { input_tokens: reportedTokens },
    answers: { i0: { choice: "billing", confidence: 0.99, probabilities: { billing: 0.99, support: 0.01 } } },
  })) as typeof fetch;
  const inferenceEnv = { TYPESAFE_API_KEY: "fixture", STATS: { get: async () => null, put: async () => {} } } as unknown as Env;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext;
  for (const expected of [1, 21]) {
    // This fixture has a known 100-credit bound. Production still needs a
    // provider-enforced bound before enabling this sequence for real customers.
    const reservation = await authorizeAndReserve(request(), env, 100, 1, { meteringMode: "tokens" });
    const meter = newMeter();
    const response = await worker.fetch(request(), inferenceEnv, ctx, {
      account: { id: reservation!.accountId, multiplier: 1 }, meter,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).results[0].label).toBe("billing");
    const charge = priceTokens(card, meter.tokens);
    expect(charge).not.toBeNull();
    const result = await settleTokenReservation(env.APP_DB, reservation!.id, charge, {
      inputTokens: meter.tokens[0].inputTokens, outputTokens: meter.tokens[0].outputTokens,
    });
    expect(result.chargedCredits).toBe(expected);
    expect(await settleTokenReservation(env.APP_DB, reservation!.id, charge)).toEqual(result);
    reportedTokens = 5000;
  }
  await Promise.all(pending);
  const snapshot = await getSnapshot("local-demo", env);
  expect(snapshot.credits.balance).toBe(500000 - 22);
  const { results } = await env.APP_DB.prepare(
    "SELECT credits,input_tokens FROM app_usage WHERE account_id='local-demo' ORDER BY input_tokens",
  ).all<{ credits: number; input_tokens: number }>();
  expect(results).toHaveLength(2);
  expect(results.reduce((total, row) => total + row.credits, 0)).toBe(22);
  expect(results.map((row) => row.input_tokens)).toEqual([100, 5000]);
});

test("unknown token charge survives legacy stale cleanup and can be explicitly refunded once", async () => {
  const reservation = await authorizeAndReserve(request(), env, 10, 1, { meteringMode: "tokens" });
  await settleTokenReservation(env.APP_DB, reservation!.id, null);
  await env.APP_DB.prepare("UPDATE app_usage SET created_at='2020-01-01T00:00:00.000Z' WHERE id=?").bind(reservation!.id).run();
  expect((await getSnapshot("local-demo", env)).credits.balance).toBe(499990);
  expect(await env.APP_DB.prepare("SELECT status,reporting_status FROM app_usage WHERE id=?").bind(reservation!.id).first())
    .toEqual({ status: "pending", reporting_status: "review" });
  await refundTokenReservation(env.APP_DB, reservation!.id);
  await refundTokenReservation(env.APP_DB, reservation!.id);
  expect((await getSnapshot("local-demo", env)).credits.balance).toBe(500000);
});

test("a revoked credential cannot reserve", async () => {
  await env.APP_DB.prepare("UPDATE app_agents SET status='revoked' WHERE account_id='local-demo'").run();
  await expect(authorizeAndReserve(request(), env, 1, 1, { meteringMode: "tokens" })).rejects.toThrow();
});

test("explicitly zero-priced token work reserves and settles zero without inventing a minimum charge", async () => {
  const reservation = await authorizeAndReserve(request(), env, 0, 1, { meteringMode: "tokens" });
  expect(reservation).not.toBeNull();
  expect((await settleTokenReservation(env.APP_DB, reservation!.id, { version: "free-fixture", nanodollars: 0n })).chargedCredits).toBe(0);
  expect((await getSnapshot("local-demo", env)).credits.balance).toBe(500000);
});

// Explicit opt-in: this one request uses the real provider and synthetic text.
// It exercises the new local ledger, not Autumn or the deployed account API.
test.skipIf(process.env.LIVE_TOKEN_BILLING !== "true")("real TypeSafe response settles through the PostgreSQL ledger", async () => {
  expect(!!process.env.TYPESAFE_API_KEY).toBe(true);
  const reservation = await authorizeAndReserve(request(), env, 1000, 1, { meteringMode: "tokens" });
  const meter = newMeter();
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext;
  const response = await worker.fetch(request(), {
    TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
    STATS: { get: async () => null, put: async () => {} },
  } as unknown as Env, ctx, { account: { id: reservation!.accountId, multiplier: 1 }, meter });
  try {
    expect(response.status).toBe(200);
    expect((await response.json()).results[0].label).toBe("billing");
    expect(meter.tokens).toHaveLength(1);
    expect(meter.tokens[0].provider).toBe("typesafe");
    expect(meter.tokens[0].inputTokens).toBeGreaterThan(0);
    // Fixture retail price uses the observed model ID; production configuration
    // must instead explicitly approve every supported routing model.
    const fixture = parseTokenRateCard(JSON.stringify({ version: "live-fixture-v1", models: [{
      provider: "typesafe", model: meter.tokens[0].model,
      inputUsdPerMillion: "0.042", outputUsdPerMillion: "0", cachedInputUsdPerMillion: "0.042",
    }] }));
    const priced = priceTokens(fixture, meter.tokens)!;
    expect(priced).not.toBeNull();
    const settled = await settleTokenReservation(env.APP_DB, reservation!.id, priced, {
      inputTokens: meter.tokens[0].inputTokens, outputTokens: meter.tokens[0].outputTokens,
    });
    expect(settled.status).toBe("completed");
    const snapshot = await getSnapshot("local-demo", env);
    expect(snapshot.credits.balance).toBe(500000 - settled.chargedCredits);
    expect(snapshot.usage[0].inputTokens).toBe(meter.tokens[0].inputTokens);
    console.info(JSON.stringify({ model: meter.tokens[0].model, inputTokens: meter.tokens[0].inputTokens,
      fixtureChargeNanodollars: priced.nanodollars.toString(), chargedCredits: settled.chargedCredits }));
  } finally {
    await Promise.all(pending);
    await refundTokenReservation(env.APP_DB, reservation!.id);
  }
}, 30000);
