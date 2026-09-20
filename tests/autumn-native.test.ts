import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { readFileSync, readdirSync } from "node:fs";
import { postgresDatabase, type AppDatabase } from "../src/server/db";
import { reconcileAutumnCustomer } from "../src/server/billing-sync";

const url = process.env.POSTGRES_TEST_URL;
describe.skipIf(!url)("native PostgreSQL subscription contention", () => {
  const schema = `classifier_autumn_${crypto.randomUUID().replaceAll("-", "")}`;
  const originalFetch = globalThis.fetch;
  let sql: SQL, db: AppDatabase;
  beforeAll(async () => {
    sql = new SQL(url!, { max: 20 });
    await sql.begin(async (transaction) => {
      await transaction.unsafe(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`).simple();
      const directory = new URL("../migrations/postgres/", import.meta.url);
      for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
        await transaction.unsafe(readFileSync(new URL(name, directory), "utf8")).simple();
      }
    });
    db = postgresDatabase(async (queries, transaction) => sql.begin(transaction ? "ISOLATION LEVEL SERIALIZABLE" : "ISOLATION LEVEL READ COMMITTED", async (connection) => {
      await connection.unsafe(`SET LOCAL search_path TO ${schema}`);
      const results = [];
      for (const query of queries) {
        const rows = await connection.unsafe(query.sql, query.params);
        results.push({ results: Array.from(rows), meta: { changes: rows.count } });
      }
      return results;
    }));
    await db.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at) VALUES('a','a@example.test','Test',500000,'2026-01-01','2026-01-01')").run();
    await db.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  });
  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (sql) { await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.close(); }
  });
  test("twenty simultaneous reconciliations cannot grant a paid period twice", async () => {
    const start = Date.now() - 60_000, end = Date.now() + 86400_000;
    globalThis.fetch = (async (input) => Response.json(String(input).endsWith("customers.get")
      ? { id: "workspace_a", subscriptions: [{ id: "sub", plan_id: "pro", status: "active", past_due: false, current_period_start: start, current_period_end: end }] }
      : { list: [{ customer_id: "workspace_a", entity_id: null, status: "paid", currency: "usd", amount_paid: 20, total: 20, refunded_amount: 0,
        stripe_id: "invoice", items: [{ plan_id: "pro", feature_id: null, amount: 20, period_start: start, period_end: end }] }], next_cursor: null })) as typeof fetch;
    const env = { APP_DB: db, AUTUMN_SECRET_KEY: "test", AUTUMN_PRO_PLAN_ID: "pro" };
    // Superseded revisions deliberately fail/retry; only the newest can grant.
    await Promise.allSettled(Array.from({ length: 20 }, () => reconcileAutumnCustomer(env, "workspace_a")));
    await reconcileAutumnCustomer(env, "workspace_a");
    expect(await db.prepare("SELECT balance::integer AS balance FROM app_accounts WHERE id='a'").first()).toEqual({ balance: 2000000 });
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM app_autumn_grants").first()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM app_transactions").first()).toEqual({ count: 1 });
  });
});
