import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { migratePostgres } from "../scripts/migrate-postgres";
import { consolidateNewsletter } from "../scripts/consolidate-newsletter";
import { checkNewsletterCutover } from "../scripts/check-newsletter-cutover";
import { app_usage } from "../drizzle/schema";
import { neonDatabase } from "../src/server/db";

const url = process.env.NEON_MIGRATION_TEST_URL;
describe.skipIf(!url)("production Drizzle/Neon migration transport", () => {
  const schema = `migration_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const sourceSchema = `${schema}_source`;
  const conflictSchema = `${schema}_conflict`;
  const files = mkdtempSync(join(tmpdir(), "classifier-migration-test-"));
  const directory = pathToFileURL(`${files}/`);
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  async function sourceScript(file: string) {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO "${sourceSchema}"`);
      await client.query(readFileSync(new URL(`../scripts/${file}`, import.meta.url), "utf8"));
    } finally {
      await client.query("RESET search_path");
      client.release();
    }
  }
  beforeAll(async () => {
    pool = new Pool({ connectionString: url!, max: 2 });
    db = drizzle(pool);
    await db.execute(sql`CREATE SCHEMA ${sql.identifier(schema)}`);
    await db.execute(sql`CREATE SCHEMA ${sql.identifier(sourceSchema)}`);
    await db.execute(sql`CREATE SCHEMA ${sql.identifier(conflictSchema)}`);
  }, 30_000);
  afterAll(async () => {
    if (db) {
      await db.execute(sql`DROP SCHEMA ${sql.identifier(schema)} CASCADE`);
      await db.execute(sql`DROP SCHEMA ${sql.identifier(sourceSchema)} CASCADE`);
      await db.execute(sql`DROP SCHEMA ${sql.identifier(conflictSchema)} CASCADE`);
      await pool.end();
    }
    rmSync(files, { recursive: true, force: true });
  }, 30_000);
  test("all real multi-statement migrations apply once, even with concurrent runners", async () => {
    await Promise.all([migratePostgres(url!, undefined, schema), migratePostgres(url!, undefined, schema)]);
    const result = await db.execute(sql`SELECT name FROM ${sql.identifier(schema)}.app_schema_migrations`);
    const migrations = readdirSync(new URL("../migrations/postgres/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort();
    expect(result.rows.map((row) => row.name).sort()).toEqual(migrations);
    const functions = await db.execute(sql`SELECT proname FROM pg_proc WHERE pronamespace=${schema}::regnamespace`);
    expect(functions.rows.map((row) => row.proname)).toContain("settle_token_reservation");
    await expect(checkNewsletterCutover(url!, schema)).rejects.toThrow("not verified");
  }, 30_000);
  test("a failed multi-statement file rolls back its DDL and migration history", async () => {
    writeFileSync(join(files, "9998_failure.sql"), "CREATE TABLE must_rollback(id integer); DO $$ BEGIN RAISE EXCEPTION 'intentional test failure'; END $$;");
    await expect(migratePostgres(url!, directory, schema)).rejects.toThrow();
    const tables = await db.execute(sql`SELECT to_regclass(${`${schema}.must_rollback`}) AS value`);
    expect(tables.rows[0].value).toBeNull();
    const history = await db.execute(sql`SELECT name FROM ${sql.identifier(schema)}.app_schema_migrations WHERE name='9998_failure.sql'`);
    expect(history.rows).toHaveLength(0);
    rmSync(join(files, "9998_failure.sql"));
  }, 30_000);
  test("changed applied checksums are rejected without changing the database", async () => {
    writeFileSync(join(files, "0001_accounts.sql"), "SELECT 1;");
    await expect(migratePostgres(url!, directory, schema)).rejects.toThrow("has changed");
    rmSync(join(files, "0001_accounts.sql"));
  }, 30_000);
  test("typed Drizzle bigint reads preserve values above Number.MAX_SAFE_INTEGER", async () => {
    const accountDb = neonDatabase(url!);
    expect(await accountDb.prepare("SELECT 42::bigint AS value").first()).toEqual({ value: 42 });
    expect((await accountDb.batch([accountDb.prepare("SELECT SUM(v) AS value FROM (VALUES (20::bigint),(22::bigint)) AS t(v)")]))[0].results).toEqual([{ value: 42 }]);
    await expect(accountDb.prepare("SELECT 9007199254740993::bigint AS value").first()).rejects.toThrow("safe range");
    const value = 9007199254740993n;
    const result = await db.select({ value: sql`9007199254740993::bigint`.mapWith(app_usage.actual_nano) }).from(sql`(SELECT 1) AS proof`);
    expect(result[0].value).toBe(value);
  }, 30_000);
  test("subscriber copy preserves all fields, is repeatable, and advances identities", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(sourceSchema)}`);
      await tx.execute(sql.raw(readFileSync(new URL("../migrations/postgres/0007_newsletter.sql", import.meta.url), "utf8")));
      await tx.execute(sql`INSERT INTO subscriber(id,email,source,wants,created_at,confirmed_at,unsubscribed_at) OVERRIDING SYSTEM VALUE
        VALUES (9007199254740993,'opted-out@example.invalid','legacy',ARRAY['private','trained'],
          '2025-01-01 01:02:03.123456+00','2025-01-02 01:02:03.123456+00','2025-01-03 01:02:03.123456+00'),
          (2,'unconfirmed@example.invalid','site','{}','2025-01-01',NULL,NULL)`);
    });
    const options = { sourceSchema, destinationSchema: schema };
    await expect(consolidateNewsletter(url!, url!, options)).rejects.toThrow("Freeze source");
    await sourceScript("newsletter-freeze.sql");
    const first = await consolidateNewsletter(url!, url!, options);
    expect(first.copied).toBe(2);
    await checkNewsletterCutover(url!, schema);
    expect(await consolidateNewsletter(url!, url!, options)).toEqual(first);
    await expect(Promise.resolve(db.execute(sql`UPDATE ${sql.identifier(schema)}.subscriber SET source=source`))).rejects.toThrow();
    // Simulate an out-of-band admin edit: the pre-deploy gate must detect a
    // stale receipt even if somebody bypasses the write guard.
    await db.execute(sql`ALTER TABLE ${sql.identifier(schema)}.subscriber DISABLE TRIGGER subscriber_cutover_pending`);
    await db.execute(sql`UPDATE ${sql.identifier(schema)}.subscriber SET source='changed' WHERE id=2`);
    await expect(checkNewsletterCutover(url!, schema)).rejects.toThrow("differs from its verified snapshot");
    await db.execute(sql`UPDATE ${sql.identifier(schema)}.subscriber SET source='site' WHERE id=2`);
    await expect(checkNewsletterCutover(url!, schema)).rejects.toThrow("not frozen");
    await db.execute(sql`ALTER TABLE ${sql.identifier(schema)}.subscriber ENABLE ALWAYS TRIGGER subscriber_cutover_pending`);
    await checkNewsletterCutover(url!, schema, true);
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(schema)}`);
      const next = await tx.execute<{ id: string }>(sql`INSERT INTO subscriber(email) VALUES ('new@example.invalid') RETURNING id`);
      expect(BigInt(next.rows[0].id)).toBeGreaterThan(9007199254740993n);
    });
    await checkNewsletterCutover(url!, schema);
    await checkNewsletterCutover(url!, schema, true); // idempotent after activation
    await expect(consolidateNewsletter(url!, url!, options)).rejects.toThrow("already active");
  }, 30_000);
  test("conflicts abort the entire copy instead of overwriting consent", async () => {
    // The preceding test added a new destination-only row: exact verification
    // must reject it even though every source row is still identical.
    await expect(consolidateNewsletter(url!, url!, { sourceSchema, destinationSchema: schema, verifyOnly: true })).rejects.toThrow("verification failed");
    await migratePostgres(url!, undefined, conflictSchema);
    await db.execute(sql`INSERT INTO ${sql.identifier(conflictSchema)}.subscriber(id,email,source,wants,created_at)
      OVERRIDING SYSTEM VALUE VALUES (2,'unconfirmed@example.invalid','site',ARRAY['api'],'2025-01-01')`);
    await sourceScript("newsletter-unfreeze.sql");
    await db.execute(sql`INSERT INTO ${sql.identifier(sourceSchema)}.subscriber(email) VALUES ('must-not-copy@example.invalid')`);
    await sourceScript("newsletter-freeze.sql");
    await expect(consolidateNewsletter(url!, url!, { sourceSchema, destinationSchema: conflictSchema })).rejects.toThrow("verification failed");
    await expect(checkNewsletterCutover(url!, conflictSchema)).rejects.toThrow("not verified");
    const result = await db.execute(sql`SELECT count(*)::integer AS count FROM ${sql.identifier(conflictSchema)}.subscriber WHERE email='must-not-copy@example.invalid'`);
    expect(result.rows[0].count).toBe(0);
  }, 30_000);
  test("cutover freeze rejects writes without changing rows and can be reversed", async () => {
    await sourceScript("newsletter-unfreeze.sql");
    for (const file of ["newsletter-freeze.sql", "newsletter-unfreeze.sql"]) {
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "${sourceSchema}"`);
        await client.query(readFileSync(new URL(`../scripts/${file}`, import.meta.url), "utf8"));
        if (file.includes("unfreeze")) {
          expect((await client.query("UPDATE subscriber SET source=source")).rowCount).toBe(3);
        } else {
          await expect(client.query("UPDATE subscriber SET source=source")).rejects.toThrow("Newsletter storage moved");
          await expect(client.query("TRUNCATE subscriber")).rejects.toThrow("Newsletter storage moved");
        }
        expect((await client.query("SELECT count(*)::integer AS count FROM subscriber")).rows[0].count).toBe(3);
      } finally {
        await client.query("RESET search_path");
        client.release();
      }
    }
  }, 30_000);
});
