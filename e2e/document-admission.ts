import assert from "node:assert/strict";
import { SQL } from "bun";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { postgresDatabase, hashToken, type AppEnv } from "../src/server/db";
import { authorizeAndReserve } from "../src/server/usage";
import { refundTokenReservation } from "../src/server/token-ledger";

// Failure contract: different concurrent document IDs must not overdraw; the
// same admission ID must debit once even when recovery reads race. Refunds
// restore one hold. Real PostgreSQL connections, migrations and production SQL.
assert.ok(process.env.POSTGRES_TEST_URL, "Set POSTGRES_TEST_URL to a local test database.");
const sql = new SQL(process.env.POSTGRES_TEST_URL!, { max: 20 });
const schema = `document_admission_${crypto.randomUUID().replaceAll("-", "")}`;
const token = "classifier_agent_document_admission_fixture";
const env = { APP_ACCOUNTS_ENABLED: "true", APP_DB: postgresDatabase(async (queries, transaction) =>
  sql.begin(transaction ? "ISOLATION LEVEL SERIALIZABLE" : "ISOLATION LEVEL READ COMMITTED", async connection => {
    await connection.unsafe(`SET LOCAL search_path TO ${schema}`);
    const results = [];
    for (const query of queries) {
      const rows = await connection.unsafe(query.sql, query.params);
      results.push({ results: Array.from(rows), meta: { changes: rows.count } });
    }
    return results;
  })) } as AppEnv;
const report: unknown[] = [];
try {
  await sql.unsafe(`CREATE SCHEMA ${schema}`);
  await sql.begin(async connection => {
    await connection.unsafe(`SET LOCAL search_path TO ${schema}`);
    for (const file of (await readdir("migrations/postgres")).filter(p => p.endsWith(".sql")).sort())
      await connection.unsafe(await readFile(`migrations/postgres/${file}`, "utf8")).simple();
  });
  await env.APP_DB.prepare("INSERT INTO app_accounts(id,email,name,balance,paid_balance,reset_at,created_at,period_start) VALUES('fixture','fixture@example.com','Fixture',100,100,now()+interval '1 day',now(),now())").run();
  await env.APP_DB.prepare("INSERT INTO app_agents(id,account_id,name,client,status,token_hash,prefix,created_at) VALUES('fixture','fixture','Fixture','API','connected',?,'fixture',now())")
    .bind(await hashToken(token)).run();
  const reserve = (id: string) => authorizeAndReserve(new Request("http://fixture/", {
    headers: { authorization: `Bearer ${token}` },
  }), env, 60, 1, { meteringMode: "tokens", reservationId: id });
  for (const sameId of [false, true]) {
    const shared = crypto.randomUUID();
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => reserve(sameId ? shared : crypto.randomUUID())));
    const accepted = attempts.flatMap(a => a.status === "fulfilled" && a.value ? [a.value] : []);
    assert.equal(new Set(accepted.map(a => a.id)).size, 1);
    if (sameId) assert.equal(accepted.length, 20, JSON.stringify(attempts.filter(a => a.status === "rejected").map(a => String(a.reason))));
    else assert.equal(accepted.length, 1);
    const account = await env.APP_DB.prepare("SELECT balance::integer AS balance,paid_balance::integer AS paid FROM app_accounts WHERE id='fixture'").first();
    assert.deepEqual(account, { balance: 40, paid: 40 });
    const agent = await env.APP_DB.prepare("SELECT used::integer AS used FROM app_agents WHERE id='fixture'").first();
    assert.deepEqual(agent, { used: 60 });
    await Promise.all(Array.from({ length: 5 }, () => refundTokenReservation(env.APP_DB, accepted[0].id)));
    assert.deepEqual(await env.APP_DB.prepare("SELECT balance::integer AS balance FROM app_accounts WHERE id='fixture'").first(), { balance: 100 });
    report.push({ sameId, attempts: 20, accepted: accepted.length, distinctHolds: 1, account, agent, refundedBalance: 100 });
  }
  await mkdir("captures", { recursive: true });
  await writeFile("captures/document-admission.json", JSON.stringify({ runtime: "PostgreSQL concurrent connections", results: report }, null, 2));
  console.log("Document admission concurrency passed; captures/document-admission.json");
} finally {
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await sql.close();
}
