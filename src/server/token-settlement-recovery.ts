import type { AppDatabase } from "./db";
import type { TokenCharge } from "./token-pricing";

export async function queueTokenSettlement(db: AppDatabase, requestId: string, intent: {
  refund: boolean;
  charge: TokenCharge | null;
  inputTokens: number | null;
  outputTokens: number | null;
  escalations: number;
}): Promise<void> {
  await db.prepare(`INSERT INTO app_usage_settlements
    (request_id,refund,charge_nano,rate_version,input_tokens,output_tokens,escalations)
    VALUES(?,?,?::bigint,?,?::bigint,?::bigint,?) ON CONFLICT(request_id) DO NOTHING`)
    .bind(requestId, intent.refund, intent.charge?.nanodollars.toString() ?? null,
      intent.charge?.version ?? null, intent.inputTokens, intent.outputTokens, intent.escalations).run();
}

export async function applyTokenSettlement(db: AppDatabase, requestId: string): Promise<void> {
  const row = await db.prepare("SELECT * FROM app_usage_settlements WHERE request_id=?").bind(requestId).first<{
    refund: boolean; charge_nano: number | null; rate_version: string | null;
    input_tokens: number | null; output_tokens: number | null; escalations: number;
  }>();
  if (!row) return;
  await db.batch([
    row.refund
      ? db.prepare("SELECT * FROM refund_token_reservation(?)").bind(requestId)
      : db.prepare("SELECT * FROM settle_token_reservation(?,?::bigint,?,?::bigint,?::bigint)")
        .bind(requestId, row.charge_nano, row.rate_version, row.input_tokens, row.output_tokens),
    db.prepare("UPDATE app_usage SET escalations=? WHERE id=? AND status='completed'").bind(row.escalations, requestId),
    db.prepare("DELETE FROM app_usage_settlements WHERE request_id=?").bind(requestId),
  ]);
}

export async function recoverTokenSettlements(db: AppDatabase): Promise<void> {
  const { results } = await db.prepare("SELECT request_id FROM app_usage_settlements ORDER BY created_at LIMIT 100").all<{ request_id: string }>();
  let failed = 0;
  for (const row of results) {
    try { await applyTokenSettlement(db, row.request_id); }
    catch { failed++; }
  }
  if (failed) throw new Error(`${failed} token settlements remain queued for recovery.`);
}
