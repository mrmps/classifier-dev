import { PGlite } from "@electric-sql/pglite";
import { afterAll } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { postgresDatabase, parseCreditInteger, type AppDatabase } from "../../src/server/db";

// PGlite executes the actual PostgreSQL schema and SQL, including constraints,
// triggers, transactions, and RETURNING. Each test database has an isolated schema.
const postgres = new PGlite({ parsers: { 20: parseCreditInteger, 1700: parseCreditInteger } });
const migrationDirectory = new URL("../../migrations/postgres/", import.meta.url);

export function database(): AppDatabase {
  const schema = `test_${crypto.randomUUID().replaceAll("-", "")}`;
  const ready = postgres.transaction(async (transaction) => {
    await transaction.exec(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}`);
    for (const filename of readdirSync(migrationDirectory).filter((file) => file.endsWith(".sql")).sort()) {
      await transaction.exec(readFileSync(new URL(filename, migrationDirectory), "utf8"));
    }
  });
  afterAll(async () => {
    await ready;
    await postgres.exec(`DROP SCHEMA ${schema} CASCADE`);
  });
  return postgresDatabase(async (queries) => {
    await ready;
    return postgres.transaction(async (transaction) => {
      await transaction.exec(`SET LOCAL search_path TO ${schema}`);
      const results = [];
      for (const query of queries) {
        const result = await transaction.query<Record<string, unknown>>(query.sql, query.params);
        results.push({ results: result.rows, meta: { changes: result.affectedRows ?? 0 } });
      }
      return results;
    });
  });
}
