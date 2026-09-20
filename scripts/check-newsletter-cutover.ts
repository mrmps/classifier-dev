import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { NEWSLETTER_CUTOVER, NEWSLETTER_ACTIVATED } from "./consolidate-newsletter";

export async function checkNewsletterCutover(url: string, schema?: string, activate = false) {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await drizzle(pool).transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL TIME ZONE 'UTC'`);
      if (schema) await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(schema)}`);
      await tx.execute(sql`LOCK TABLE subscriber IN ACCESS EXCLUSIVE MODE`);
      const result = await tx.execute<{ name: string; sha256: string }>(sql`
        SELECT name,sha256 FROM app_schema_migrations
        WHERE name IN (${NEWSLETTER_CUTOVER}, ${NEWSLETTER_ACTIVATED})
      `);
      const copied = result.rows.find(row => row.name === NEWSLETTER_CUTOVER);
      const activated = result.rows.find(row => row.name === NEWSLETTER_ACTIVATED);
      if (!copied || !/^[a-f0-9]{64}$/.test(copied.sha256)) {
        throw new Error("Newsletter cutover is not verified. Freeze, copy and verify subscribers before deploying.");
      }
      // Once activated, new signups and preference changes are legitimate.
      // The immutable activation receipt records the snapshot that went live.
      if (activated) {
        if (activated.sha256 !== copied.sha256) throw new Error("Newsletter activation receipt conflicts with the copy.");
        return;
      }
      const snapshot = await tx.execute<{ payload: string }>(sql`
        SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id), '[]'::jsonb)::text AS payload FROM subscriber s
      `);
      if (createHash("sha256").update(snapshot.rows[0].payload).digest("hex") !== copied.sha256) {
        throw new Error("Newsletter destination differs from its verified snapshot.");
      }
      const guard = await tx.execute(sql`SELECT 1 FROM pg_trigger
        WHERE tgrelid='subscriber'::regclass AND tgname='subscriber_cutover_pending' AND tgenabled='A'`);
      if (guard.rows.length !== 1) throw new Error("Newsletter destination is not frozen for deployment.");
      if (activate) {
        await tx.execute(sql`INSERT INTO app_schema_migrations(name,sha256) VALUES (${NEWSLETTER_ACTIVATED},${copied.sha256})`);
        await tx.execute(sql`DROP TRIGGER subscriber_cutover_pending ON subscriber`);
      }
    });
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL.");
  await checkNewsletterCutover(process.env.DATABASE_URL, undefined, process.argv.includes("--activate"));
  console.log("Newsletter cutover verified.");
}
