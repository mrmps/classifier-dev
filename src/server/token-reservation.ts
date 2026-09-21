import { AppError, type AppDatabase } from "./db";
import { JEV_ACCOUNT_MODEL, type ModelTokenUsage } from "../cost";
import type { TokenRateCard } from "./token-pricing";

/** Provider context limits, not token estimates. Unknown models cannot spend. */
export function providerCallBound(card: TokenRateCard, provider: ModelTokenUsage["provider"], model: string, maxOutput: number): number {
  // Each bound is the model's own context window, so a single call can never
  // reserve more than that model could physically consume.
  const inputLimit = provider === "typesafe" && model === JEV_ACCOUNT_MODEL ? 65_536
    : provider === "beam" && model === "jev/laya" ? 512
    : provider === "beam" && model === "jev/kev" ? 8_192
    : provider === "openrouter" && model === "google/gemini-3.8-flash" ? 1_048_576 : null;
  const rate = card.models.find((row) => row.provider === provider && row.model === model);
  if (inputLimit === null || !rate || !Number.isSafeInteger(maxOutput) || maxOutput < 0 || maxOutput > 65_536)
    throw new AppError(503, "This model is not configured for account billing.");
  const inputRate = rate.inputNanodollars > rate.cachedInputNanodollars ? rate.inputNanodollars : rate.cachedInputNanodollars;
  const nano = BigInt(inputLimit) * inputRate + BigInt(maxOutput) * rate.outputNanodollars;
  const credits = Number((nano + 9999n) / 10000n);
  if (!Number.isSafeInteger(credits)) throw new AppError(503, "Provider reservation exceeds supported limits.");
  return credits;
}

/** Atomic extension: account row lock serializes simultaneous keys/requests. */
export async function extendTokenReservation(db: AppDatabase, requestId: string, credits: number): Promise<void> {
  if (!Number.isSafeInteger(credits) || credits < 0) throw new AppError(400, "Invalid reservation extension.");
  const result = await db.prepare(`WITH locked AS (
    SELECT a.id,a.balance,a.paid_balance FROM app_accounts a
    JOIN app_usage u ON u.account_id=a.id WHERE u.id=? AND NOT a.billing_hold FOR UPDATE OF a
  ), held AS (
    UPDATE app_usage u SET reserved_credits=COALESCE(u.reserved_credits,u.credits)+?,
      reserved_paid_credits=COALESCE(u.reserved_paid_credits,u.paid_credits)+GREATEST(0,?-(a.balance-a.paid_balance))
    FROM locked a WHERE u.id=? AND u.account_id=a.id AND u.status='pending' AND u.metering_mode='tokens'
      AND a.balance>=? AND EXISTS(SELECT 1 FROM app_agents k WHERE k.id=u.agent_id AND k.status IN ('pending','connected'))
    RETURNING u.account_id,u.agent_id,GREATEST(0,?-(a.balance-a.paid_balance)) AS paid
  ), debited AS (
    UPDATE app_accounts a SET balance=a.balance-?,paid_balance=a.paid_balance-h.paid FROM held h
    WHERE a.id=h.account_id RETURNING a.id
  ) UPDATE app_agents k SET used=k.used+? FROM held h,debited d
    WHERE k.id=h.agent_id AND d.id=h.account_id RETURNING k.id`)
    .bind(requestId, credits, credits, requestId, credits, credits, credits, credits).first();
  if (!result) throw new AppError(402, "Insufficient available balance for the provider reservation, or the key is inactive.");
}
