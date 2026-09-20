// Read-only against Autumn. Rehearses every existing customer in a disposable
// PostgreSQL schema; never purchases, changes or cancels a subscription.
import { SQL } from "bun";
import { readFileSync, readdirSync } from "node:fs";
import { postgresDatabase } from "../src/server/db";
import { autumnRequest } from "../src/server/autumn";
import { reconcileAutumnCustomer } from "../src/server/billing-sync";

if (!process.env.POSTGRES_TEST_URL || !process.env.AUTUMN_PROD_SECRET_KEY)
  throw new Error("Set POSTGRES_TEST_URL and AUTUMN_PROD_SECRET_KEY.");
const schema = `migration_rehearsal_${crypto.randomUUID().replaceAll("-", "")}`;
const sql = new SQL(process.env.POSTGRES_TEST_URL, { max: 1 });
const db = postgresDatabase(async (queries, transaction) => sql.begin(transaction ? "ISOLATION LEVEL SERIALIZABLE" : "ISOLATION LEVEL READ COMMITTED", async (connection) => {
  await connection.unsafe(`SET LOCAL search_path TO ${schema}`);
  const results = [];
  for (const query of queries) {
    const rows = await connection.unsafe(query.sql, query.params);
    results.push({ results: Array.from(rows), meta: { changes: rows.count } });
  }
  return results;
}));
const env = { APP_DB: db, AUTUMN_SECRET_KEY: process.env.AUTUMN_PROD_SECRET_KEY, AUTUMN_PRO_PLAN_ID: "pro" };
try {
  await sql.begin(async (transaction) => {
    await transaction.unsafe(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`).simple();
    const directory = new URL("../migrations/postgres/", import.meta.url);
    for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort())
      await transaction.unsafe(readFileSync(new URL(name, directory), "utf8")).simple();
  });
  let cursor: string | null = null, paid = 0, free = 0;
  const emails = new Set<string>();
  do {
    const page = await autumnRequest(env, "customers.list", { limit: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    if (!Array.isArray(page.list)) throw new Error("Invalid customer listing.");
    for (const customer of page.list) {
      if (!/^[a-f0-9]{64}$/.test(customer.id) || typeof customer.email !== "string") throw new Error("Unexpected legacy identity; review before migration.");
      const email = customer.email.trim().toLowerCase();
      if (emails.has(email)) throw new Error("Duplicate billing email; review before migration.");
      emails.add(email);
      const id = `rehearsal:${customer.id}`;
      const timestamp = new Date().toISOString();
      await db.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at) VALUES(?,?,?,500000,?,?)")
        .bind(id, email, "Migration rehearsal", timestamp, timestamp).run();
      await db.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES(?,?)").bind(id, customer.id).run();
      await reconcileAutumnCustomer(env, customer.id);
      const expected = customer.subscriptions.some((s: { plan_id: string; status: string; past_due: boolean }) => s.plan_id === "pro" && s.status === "active" && !s.past_due) ? "pro" : "free";
      const row = await db.prepare("SELECT billing_plan,balance::integer AS balance FROM app_accounts WHERE id=?").bind(id).first<{ billing_plan: string; balance: number }>();
      if (row?.billing_plan !== expected || row.balance !== (expected === "pro" ? 2000000 : 500000)) throw new Error("Customer entitlement did not reconcile.");
      await db.prepare("UPDATE app_accounts SET balance=balance-42 WHERE id=?").bind(id).run();
      await reconcileAutumnCustomer(env, customer.id);
      const repeated = await db.prepare("SELECT balance::integer AS balance FROM app_accounts WHERE id=?").bind(id).first<{ balance: number }>();
      if (repeated?.balance !== row.balance - 42) throw new Error("Repeat migration changed the balance.");
      expected === "pro" ? paid++ : free++;
    }
    cursor = typeof page.next_cursor === "string" && page.next_cursor ? page.next_cursor : null;
  } while (cursor);
  console.log(JSON.stringify({ customers: emails.size, paid, free, repeatedReconciliationPreservesSpend: true, providerWrites: 0 }));
} finally {
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await sql.close();
}
