import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Set DATABASE_URL to the target Neon/Postgres database.");
const client = new Pool({ connectionString: url, max: 1 });
const database = drizzle(client);
const directory = new URL("../migrations/postgres/", import.meta.url);
try {
  await database.transaction(async (transaction) => {
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
