import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { readFileSync, readdirSync } from "node:fs";
import { postgresDatabase, type AppDatabase } from "../src/server/db";
import { refundTokenReservation, settleTokenReservation } from "../src/server/token-ledger";
import { extendTokenReservation } from "../src/server/token-reservation";

const url = process.env.POSTGRES_TEST_URL;
describe.skipIf(!url)("native PostgreSQL token settlement contention", () => {
  const schema = `classifier_token_${crypto.randomUUID().replaceAll("-", "")}`;
  let sql: SQL;
  let db: AppDatabase;
  beforeAll(async () => {
    sql = new SQL(url!, { max: 20 });
    await sql.begin(async (transaction) => {
      await transaction.unsafe(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`).simple();
      const directory = new URL("../migrations/postgres/", import.meta.url);
      for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
        await transaction.unsafe(readFileSync(new URL(name, directory), "utf8")).simple();
      }
    });
    db = postgresDatabase(async (queries, transaction) => sql.begin(
      transaction ? "ISOLATION LEVEL SERIALIZABLE" : "ISOLATION LEVEL READ COMMITTED",
      async (connection) => {
        await connection.unsafe(`SET LOCAL search_path TO ${schema}`);
        const results = [];
        for (const query of queries) {
          const rows = await connection.unsafe(query.sql, query.params);
          results.push({ results: Array.from(rows), meta: { changes: rows.count } });
        }
        return results;
      },
    ));
    await db.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at,period_start) VALUES('account','account@example.com','Tokens',1000,'2026-10-20','2026-09-20','2026-09-20')").run();
    await db.prepare("INSERT INTO app_agents(id,account_id,name,client,token_hash,prefix,created_at) VALUES('key','account','Key','API','hash','prefix','2026-09-20')").run();
  }, 30_000);
  afterAll(async () => {
    if (sql) {
      await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await sql.close();
    }
  }, 30_000);
  async function reserve(credits: number) {
    const id = crypto.randomUUID();
    await db.batch([
      db.prepare("UPDATE app_accounts SET balance=balance-? WHERE id='account'").bind(credits),
      db.prepare("UPDATE app_agents SET used=used+? WHERE id='key'").bind(credits),
      db.prepare("INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at,metering_mode) VALUES(?,'account','key',1,?,'pending','2026-09-20','tokens')").bind(id, credits),
    ]);
    return id;
  }
  test("20 simultaneous settlements share one fractional accumulator", async () => {
    const ids = [];
    for (let index = 0; index < 20; index++) ids.push(await reserve(1));
    const settled = await Promise.all(ids.map((id) => settleTokenReservation(db, id, { version: "test-v1", nanodollars: 42n })));
    expect(settled.reduce((sum, value) => sum + value.chargedCredits, 0)).toBe(1);
    expect(await db.prepare("SELECT balance::integer AS balance,fractional_spend_nano::integer AS remainder FROM app_accounts WHERE id='account'").first())
      .toEqual({ balance: 999, remainder: 840 });
    expect(await db.prepare("SELECT SUM(actual_nano)::text AS nano FROM app_usage").first()).toEqual({ nano: "840" });
  }, 30_000);
  test("parallel refund and completion contenders observe exactly one committed result", async () => {
    const id = await reserve(3);
    const outcomes = await Promise.all(Array.from({ length: 20 }, (_, index) => index % 2
      ? refundTokenReservation(db, id)
      : settleTokenReservation(db, id, { version: "test-v1", nanodollars: 20_000n })));
    expect(outcomes.every((outcome) => outcome.status === outcomes[0].status)).toBe(true);
    const completed = outcomes[0].status === "completed";
    expect(await db.prepare("SELECT balance::integer AS balance,fractional_spend_nano::integer AS remainder FROM app_accounts WHERE id='account'").first())
      .toEqual({ balance: completed ? 997 : 999, remainder: 840 });
    expect(await db.prepare("SELECT used::integer AS used FROM app_agents WHERE id='key'").first()).toEqual({ used: completed ? 3 : 1 });
  }, 30_000);
  test("concurrent extensions cannot reserve more than the available paid and included balance", async () => {
    await db.prepare("INSERT INTO app_accounts(id,email,name,balance,paid_balance,reset_at,created_at) VALUES('extensions','extensions@example.com','Extensions',1000,700,'2026-10-20','2026-09-20')").run();
    await db.prepare("INSERT INTO app_agents(id,account_id,name,client,token_hash,prefix,created_at) VALUES('extension-key','extensions','Key','API','extension-hash','prefix','2026-09-20')").run();
    await db.prepare("INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at,metering_mode) VALUES('extension-request','extensions','extension-key',1,0,'pending','2026-09-20','tokens')").run();
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => extendTokenReservation(db, "extension-request", 276)));
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(3);
    expect(await db.prepare("SELECT balance::integer AS balance,paid_balance::integer AS paid_balance FROM app_accounts WHERE id='extensions'").first())
      .toEqual({ balance: 172, paid_balance: 172 });
    await refundTokenReservation(db, "extension-request");
    expect(await db.prepare("SELECT balance::integer AS balance,paid_balance::integer AS paid_balance FROM app_accounts WHERE id='extensions'").first())
      .toEqual({ balance: 1000, paid_balance: 700 });
    expect(await db.prepare("SELECT used::integer AS used FROM app_agents WHERE id='extension-key'").first()).toEqual({ used: 0 });
  }, 30_000);
});
