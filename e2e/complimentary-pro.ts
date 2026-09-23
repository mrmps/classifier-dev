import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseCreditInteger, postgresDatabase } from "../src/server/db";
import { BILLING_PLANS } from "../src/lib/billing";
import { billingSnapshot } from "../src/server/billing";
import { createAutumnCheckout, createAutumnPortal } from "../src/server/autumn";
import { hasActiveComplimentaryPro, syncComplimentaryPro } from "../src/server/complimentary-pro";

const pg = new PGlite({ parsers: { 20: parseCreditInteger, 1700: parseCreditInteger } });
const db = postgresDatabase(queries => pg.transaction(async tx => {
  const results = [];
  for (const query of queries) {
    const result = await tx.query<Record<string, unknown>>(query.sql, query.params);
    results.push({ results: result.rows, meta: { changes: result.affectedRows ?? 0 } });
  }
  return results;
}));
const env = { APP_DB: db, APP_ACCOUNTS_ENABLED: "true" };
const email = "grantee@example.test";
const accountId = "workos:test-grantee";
const start = "2026-09-23T00:00:00.000Z";
const end = "2027-09-23T00:00:00.000Z";
const report: Record<string, unknown> = {
  runtime: "Complete PostgreSQL migrations + account ledger + complimentary Pro lifecycle in PGlite",
  grant: { start, end },
  observations: [],
};
const observations = report.observations as unknown[];
try {
  const directory = new URL("../migrations/postgres/", import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort())
    await pg.exec(await readFile(new URL(name, directory), "utf8"));
  await db.prepare("INSERT INTO app_accounts(id,email,name,balance,paid_balance,reset_at,created_at) VALUES(?,?,?,500000,100000,?,?)")
    .bind(accountId, email, "Grantee", start, start).run();
  await db.prepare("INSERT INTO app_complimentary_pro(email,starts_at,ends_at) VALUES(?,?,?)")
    .bind(email, "2025-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z").run();
  assert.equal(await hasActiveComplimentaryPro(env, accountId, new Date(start)), false);
  observations.push({ step: "unclaimed provisional dates do not shorten the award" });

  await syncComplimentaryPro(env, email.toUpperCase(), accountId, new Date(start));
  const claimed = await db.prepare("SELECT starts_at,ends_at,account_id FROM app_complimentary_pro WHERE email=?")
    .bind(email).first<{ starts_at: string; ends_at: string; account_id: string }>();
  assert.deepEqual(claimed, { starts_at: start, ends_at: end, account_id: accountId });
  assert.equal(await hasActiveComplimentaryPro(env, accountId, new Date(start)), true);
  let snapshot = await billingSnapshot(accountId, env);
  assert.equal(snapshot.plan, "pro");
  assert.equal(snapshot.availableCredits, snapshot.paidCredits + BILLING_PLANS.pro.includedCredits);
  assert.equal(snapshot.complimentaryUntil, end);
  assert.equal(snapshot.transactions.length, 1);
  assert.equal(snapshot.transactions[0].amountCents, 0);
  observations.push({ step: "activation", plan: snapshot.plan, credits: snapshot.availableCredits, amountCents: snapshot.transactions[0].amountCents });
  const billingEnv = { ...env, AUTUMN_PRO_PLAN_ID: "pro" };
  for (const operation of [createAutumnCheckout, createAutumnPortal])
    await assert.rejects(operation(billingEnv, accountId, "https://classifier.dev/app/plans"), { status: 409 });
  observations.push({ step: "paid checkout and portal blocked during grant" });

  await db.prepare("UPDATE app_accounts SET balance=balance-250000 WHERE id=?").bind(accountId).run();
  await syncComplimentaryPro(env, email, accountId, new Date("2026-09-24T00:00:00.000Z"));
  snapshot = await billingSnapshot(accountId, env);
  assert.equal(snapshot.availableCredits, snapshot.paidCredits + BILLING_PLANS.pro.includedCredits - 250000);
  assert.equal(snapshot.transactions.length, 1);
  observations.push({ step: "repeat does not refill spent usage", credits: snapshot.availableCredits });

  await syncComplimentaryPro(env, email, accountId, new Date("2026-10-23T00:00:00.000Z"));
  snapshot = await billingSnapshot(accountId, env);
  assert.equal(snapshot.availableCredits, snapshot.paidCredits + BILLING_PLANS.pro.includedCredits);
  assert.equal(snapshot.transactions.length, 2);
  observations.push({ step: "monthly renewal", credits: snapshot.availableCredits, grants: snapshot.transactions.length });

  await assert.rejects(syncComplimentaryPro(env, email, "workos:other", new Date("2026-10-24T00:00:00.000Z")));
  observations.push({ step: "wrong identity rejected" });

  await syncComplimentaryPro(env, email, accountId, new Date(end));
  snapshot = await billingSnapshot(accountId, env);
  assert.equal(snapshot.plan, "free");
  assert.equal(snapshot.availableCredits, snapshot.paidCredits);
  assert.equal(snapshot.complimentaryUntil, null);
  assert.equal(await hasActiveComplimentaryPro(env, accountId, new Date(end)), false);
  observations.push({ step: "one-year expiry", plan: snapshot.plan, credits: snapshot.availableCredits });
} finally {
  await mkdir("captures", { recursive: true });
  await writeFile("captures/complimentary-pro.json", JSON.stringify(report, null, 2));
  await pg.close();
}
console.log(`Complimentary Pro lifecycle passed; captures/complimentary-pro.json`);
