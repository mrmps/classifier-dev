import { expect, test } from "bun:test";
import { database } from "./support/postgres";
import { provisionTestAccount } from "./support/account";
import { performAction } from "../src/server/agents";
import { authorizeAndReserve } from "../src/server/usage";
import { extendTokenReservation, providerCallBound } from "../src/server/token-reservation";
import { refundTokenReservation } from "../src/server/token-ledger";
import { parseTokenRateCard } from "../src/server/token-pricing";
import rates from "../src/retail-rates.json";
import type { AppEnv } from "../src/server/db";

test("provider bounds reject unpriced fallback and invalid output allowance", () => {
  const card = parseTokenRateCard(JSON.stringify(rates))!;
  expect(providerCallBound(card, "typesafe", "jev-1.13.0", 0)).toBe(276);
  expect(providerCallBound(card, "openrouter", "google/gemini-3.8-flash", 2000)).toBe(95272);
  expect(() => providerCallBound(card, "vercel", "jev@vercel", 0)).toThrow();
  expect(() => providerCallBound(card, "openrouter", "google/gemini-3.8-flash", 65537)).toThrow();
});

test("parallel reservation extensions cannot overspend and refund restores paid sources once", async () => {
  const env: AppEnv = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" };
  await provisionTestAccount(new Request("http://localhost/login", { headers: { origin: "http://localhost" } }), env);
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=1000,paid_balance=700 WHERE id='local-demo'").run();
  const key = await performAction("local-demo", { type: "create-key", name: "Reservation test" }, env);
  const request = new Request("http://localhost/v1/classify", { headers: { authorization: `Bearer ${key.secret}` } });
  const reservation = (await authorizeAndReserve(request, env, 0, 1, { meteringMode: "tokens" }))!;
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => extendTokenReservation(env.APP_DB, reservation.id, 276)));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
  expect(await env.APP_DB.prepare("SELECT balance,paid_balance FROM app_accounts WHERE id='local-demo'").first()).toEqual({ balance: 172, paid_balance: 172 });
  await refundTokenReservation(env.APP_DB, reservation.id);
  await refundTokenReservation(env.APP_DB, reservation.id);
  expect(await env.APP_DB.prepare("SELECT balance,paid_balance FROM app_accounts WHERE id='local-demo'").first()).toEqual({ balance: 1000, paid_balance: 700 });
  await expect(extendTokenReservation(env.APP_DB, reservation.id, 1)).rejects.toThrow();
});
