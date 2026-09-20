import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { readFileSync, readdirSync } from "node:fs";
import { postgresDatabase, type AppEnv } from "../src/server/db";
import { authorizeAndReserve, completeReservation } from "../src/server/usage";
import { hashToken } from "../src/server/db";

// Opt-in native PostgreSQL proof: separate connections contend for the same rows.
// The portable application suite uses PGlite and cannot simulate this contention.
const url = process.env.POSTGRES_TEST_URL;
describe.skipIf(!url)("PostgreSQL concurrent account reservations", () => {
  const schema = `classifier_test_${crypto.randomUUID().replaceAll("-", "")}`;
  let sql: SQL;
  let env: AppEnv;
  const token = "classifier_agent_concurrency";
  const request = () => new Request("https://classifier.dev/v1/classify", { headers: { authorization: `Bearer ${token}` } });

  beforeAll(async () => {
    sql = new SQL(url!, { max: 12 });
    await sql.begin(async (transaction) => {
      await transaction.unsafe(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`).simple();
      const directory = new URL("../migrations/postgres/", import.meta.url);
      for (const filename of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
        await transaction.unsafe(readFileSync(new URL(filename, directory), "utf8")).simple();
      }
    });
    env = {
      APP_ACCOUNTS_ENABLED: "true",
      APP_DB: postgresDatabase(async (queries, transaction) => sql.begin(
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
      )),
    };
    await env.APP_DB.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at,period_start) VALUES('customer','test@example.com','Concurrent customer',10,?,?,?)")
      .bind(new Date(Date.now() + 86400000).toISOString(), new Date().toISOString(), new Date().toISOString()).run();
    await env.APP_DB.prepare("INSERT INTO app_workspaces(account_id,kind,mode,created_at) VALUES('customer','personal','hosted',?)")
      .bind(new Date().toISOString()).run();
    await env.APP_DB.prepare("INSERT INTO app_agents(id,account_id,name,client,token_hash,prefix,created_at) VALUES('key','customer','Key','API',?,'classifier_agent',?)")
      .bind(await hashToken(token), new Date().toISOString()).run();
  }, 30_000);

  afterAll(async () => {
    if (sql) {
      await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await sql.close();
    }
  }, 30_000);

  test("concurrent debit cannot overspend, duplicate refunds restore funds exactly once", async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => authorizeAndReserve(request(), env, 3)));
    const accepted = attempts.flatMap((attempt) => attempt.status === "fulfilled" && attempt.value ? [attempt.value] : []);
    expect(accepted).toHaveLength(3);
    for (const attempt of attempts) {
      if (attempt.status === "rejected") expect(attempt.reason.status).toBe(403);
    }
    expect(await env.APP_DB.prepare("SELECT balance::integer AS balance FROM app_accounts WHERE id='customer'").first()).toEqual({ balance: 1 });
    await Promise.all(Array.from({ length: 12 }, () => completeReservation(accepted[0], env, false)));
    expect(await env.APP_DB.prepare("SELECT balance::integer AS balance FROM app_accounts WHERE id='customer'").first()).toEqual({ balance: 4 });
    expect(await env.APP_DB.prepare("SELECT used::integer AS used FROM app_agents WHERE id='key'").first()).toEqual({ used: 6 });
    await completeReservation(accepted[0], env, true);
    expect(await env.APP_DB.prepare("SELECT status FROM app_usage WHERE id=?").bind(accepted[0].id).first()).toEqual({ status: "refunded" });
  }, 30_000);

  test("failed transaction rolls back preceding account writes", async () => {
    const before = await env.APP_DB.prepare("SELECT balance::integer AS balance FROM app_accounts WHERE id='customer'").first();
    await expect(env.APP_DB.batch([
      env.APP_DB.prepare("UPDATE app_accounts SET balance=balance+99 WHERE id='customer'"),
      env.APP_DB.prepare("INSERT INTO app_sessions(token_hash,account_id,expires_at) VALUES('broken','missing','tomorrow')"),
    ])).rejects.toThrow();
    expect(await env.APP_DB.prepare("SELECT balance::integer AS balance FROM app_accounts WHERE id='customer'").first()).toEqual(before);
  }, 30_000);
});
