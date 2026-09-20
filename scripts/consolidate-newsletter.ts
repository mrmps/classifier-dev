import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";

export const NEWSLETTER_CUTOVER = "data:newsletter-consolidation-v1";

/** Copy exact PostgreSQL values; never round IDs or timestamps through JS. */
export async function consolidateNewsletter(
  sourceUrl: string,
  destinationUrl: string,
  options: { sourceSchema?: string; destinationSchema?: string; verifyOnly?: boolean } = {},
) {
  const sourcePool = new Pool({ connectionString: sourceUrl, max: 1 });
  const destinationPool = new Pool({ connectionString: destinationUrl, max: 1 });
  try {
    const source = drizzle(sourcePool);
    const destination = drizzle(destinationPool);
    const payload = await source.transaction(async (tx) => {
      if (options.sourceSchema) await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(options.sourceSchema)}`);
      if (!options.verifyOnly) {
        const frozen = await tx.execute<{ frozen: boolean }>(sql`
          SELECT EXISTS(SELECT 1 FROM pg_trigger
            WHERE tgrelid='subscriber'::regclass AND tgname='subscriber_moved'
              AND tgenabled IN ('O','A')) AS frozen
        `);
        if (!frozen.rows[0].frozen) throw new Error("Freeze source subscriber writes before copying.");
      }
      const result = await tx.execute<{ payload: string }>(sql`
        SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id), '[]'::jsonb)::text AS payload
        FROM subscriber s
      `);
      return result.rows[0].payload;
    }, { isolationLevel: "repeatable read", accessMode: "read only" });

    const counts = await destination.transaction(async (tx) => {
      if (options.destinationSchema) await tx.execute(sql`SET LOCAL search_path TO ${sql.identifier(options.destinationSchema)}`);
      // Serialize against confirmations and other imports until verification commits.
      await tx.execute(sql`LOCK TABLE subscriber IN ACCESS EXCLUSIVE MODE`);
      if (!options.verifyOnly) {
        await tx.execute(sql`
          INSERT INTO subscriber(id,email,source,wants,created_at,confirmed_at,unsubscribed_at)
          OVERRIDING SYSTEM VALUE
          SELECT id,email,source,wants,created_at,confirmed_at,unsubscribed_at
          FROM jsonb_populate_recordset(NULL::subscriber, ${payload}::jsonb)
          ON CONFLICT DO NOTHING
        `);
      }
      const difference = await tx.execute<{ mismatches: number }>(sql`
        SELECT count(*)::integer AS mismatches
        FROM jsonb_populate_recordset(NULL::subscriber, ${payload}::jsonb) s
        FULL OUTER JOIN subscriber d ON d.id=s.id
        WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(d)
      `);
      if (difference.rows[0].mismatches) {
        throw new Error(`Subscriber verification failed: ${difference.rows[0].mismatches} missing or conflicting rows. No rows committed.`);
      }
      if (!options.verifyOnly) {
        // Explicit identity inserts do not advance the sequence. Never move it back.
        await tx.execute(sql`
          SELECT setval(pg_get_serial_sequence('subscriber', 'id'), greatest(
            coalesce((SELECT max(id) FROM subscriber), 1),
            (SELECT last_value FROM pg_sequences
              WHERE schemaname=current_schema() AND sequencename='subscriber_id_seq')
          ), true)
        `);
        // Written in the same transaction as the verified copy. Deployment
        // requires this marker, so an empty/new destination cannot go live.
        await tx.execute(sql`
          INSERT INTO app_schema_migrations(name,sha256)
          VALUES (${NEWSLETTER_CUTOVER}, ${createHash("sha256").update(payload).digest("hex")})
          ON CONFLICT (name) DO NOTHING
        `);
      }
      const result = await tx.execute<{ copied: number; destination: number }>(sql`
        SELECT jsonb_array_length(${payload}::jsonb) AS copied,
          (SELECT count(*)::integer FROM subscriber) AS destination
      `);
      return result.rows[0];
    });
    return { ...counts, sourceSha256: createHash("sha256").update(payload).digest("hex") };
  } finally {
    await Promise.all([sourcePool.end(), destinationPool.end()]);
  }
}

if (import.meta.main) {
  const source = process.env.SOURCE_DATABASE_URL;
  const destination = process.env.DATABASE_URL;
  if (!source || !destination) throw new Error("Set SOURCE_DATABASE_URL and DATABASE_URL.");
  try {
    console.log(await consolidateNewsletter(source, destination, {
      verifyOnly: process.argv.includes("--verify-only"),
    }));
  } catch {
    // Driver errors can include SQL parameters containing every email address.
    console.error("Subscriber transfer or verification failed. Source data is intact; verify the destination before retrying.");
    process.exitCode = 1;
  }
}
