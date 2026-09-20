import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";

export async function migratePostgres(
  url: string,
  directory: URL = new URL("../migrations/postgres/", import.meta.url),
  schema?: string,
) {
  // Fail before connecting, without letting driver errors repeat credentials.
  let connection: URL;
  try { connection = new URL(url); }
  catch { throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL."); }
  if (!["postgres:", "postgresql:"].includes(connection.protocol)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL.");
  }
  // Migrations need a direct endpoint; runtime HTTP queries retain pooling.
  connection.hostname = connection.hostname.replace(/-pooler(?=\.)/, "");
  const client = new Pool({ connectionString: connection.toString(), max: 1 });
  const database = drizzle(client);
  try {
  await database.transaction(async (transaction) => {
    if (schema) await transaction.execute(sql`SET LOCAL search_path TO ${sql.identifier(schema)}`);
    // One runner owns the migration history until all files have committed.
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(820916240)`);
    await transaction.execute(sql`CREATE TABLE IF NOT EXISTS app_schema_migrations (
      name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = await transaction.execute<{ name: string; sha256: string }>(
      sql`SELECT name,sha256 FROM app_schema_migrations`,
    );
    const known = new Map(applied.rows.map((row) => [row.name, row.sha256]));
    for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
      const contents = readFileSync(new URL(name, directory), "utf8");
      const checksum = createHash("sha256").update(contents).digest("hex");
      if (known.has(name)) {
        if (known.get(name) !== checksum) throw new Error(`Applied migration ${name} has changed.`);
        continue;
      }
      await transaction.execute(sql.raw(contents));
      await transaction.execute(
        sql`INSERT INTO app_schema_migrations(name,sha256) VALUES(${name},${checksum})`,
      );
      console.log(`Applied ${name}`);
    }
  });
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL to the target Neon/Postgres database.");
  await migratePostgres(url);
}
