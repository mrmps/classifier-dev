import { neonDatabase, type AppDatabase } from "../src/server/db";

const eligible = `u.status='pending' AND u.reporting_status='not_ready'
  AND u.metering_mode='tokens' AND u.actual_nano IS NULL
  AND u.created_at::timestamptz < now()-interval '24 hours'
  AND NOT EXISTS(SELECT 1 FROM app_usage_settlements s WHERE s.request_id=u.id)`;

export async function reconcileTokenReservations(db: AppDatabase, refundId?: string) {
  const candidates = await db.prepare(`SELECT u.id,u.created_at,
    COALESCE(u.reserved_credits,u.credits) AS held_credits,
    COALESCE(u.reserved_paid_credits,u.paid_credits) AS held_paid_credits
    FROM app_usage u WHERE ${eligible} ORDER BY u.created_at LIMIT 100`).all<{
    id: string; created_at: string; held_credits: number; held_paid_credits: number;
  }>();
  if (!refundId) return { candidates: candidates.results, refunded: false };
  const result = await db.batch([
    db.prepare(`SELECT a.id FROM app_accounts a JOIN app_usage u ON u.account_id=a.id
      WHERE u.id=? FOR UPDATE OF a`).bind(refundId),
    db.prepare(`SELECT r.* FROM app_usage u
      CROSS JOIN LATERAL refund_token_reservation(u.id) r
      WHERE u.id=? AND ${eligible}`).bind(refundId),
  ]);
  return { candidates: candidates.results, refunded: result[1].results.length === 1 };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--refund" || !args[1])) {
    throw new Error("Usage: bun scripts/reconcile-token-reservations.ts [--refund REQUEST_ID]. Without arguments, only previews. An explicit refund waives any unknown charge for that request.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  console.log(JSON.stringify(await reconcileTokenReservations(neonDatabase(process.env.DATABASE_URL), args[1]), null, 2));
}
