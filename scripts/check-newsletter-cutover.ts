import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import { NEWSLETTER_CUTOVER } from "./consolidate-newsletter";

export async function checkNewsletterCutover(url: string, schema?: string) {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await drizzle(pool).transaction(async (tx) => {
      if (schema) await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(schema)}`);
      const result = await tx.execute(sql`
        SELECT 1 FROM app_schema_migrations
        WHERE name=${NEWSLETTER_CUTOVER} AND sha256 ~ '^[a-f0-9]{64}$'
      `);
      if (result.rows.length !== 1) throw new Error("Newsletter cutover is not verified. Freeze, copy and verify subscribers before deploying.");
    });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");
  await checkNewsletterCutover(process.env.DATABASE_URL);
  console.log("Verified newsletter cutover marker exists.");
}
