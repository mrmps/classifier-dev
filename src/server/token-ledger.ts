import { parseCreditInteger, type AppDatabase } from "./db";
import type { TokenCharge } from "./token-pricing";

export const NANODOLLARS_PER_CREDIT = 10_000n;
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export interface TokenSettlement {
  status: "completed" | "refunded" | "review";
  chargedCredits: number;
  refundedCredits: number;
  actualNanodollars: bigint | null;
  rateVersion: string | null;
}
interface SettlementRow {
  status: TokenSettlement["status"];
  charged_credits: number;
  refunded_credits: number;
  actual_nano: string | null;
  rate_version: string | null;
}
function result(row: SettlementRow | null): TokenSettlement {
  if (!row) throw new Error("Token settlement did not return a result.");
  return {
    status: row.status,
    chargedCredits: parseCreditInteger(String(row.charged_credits)),
    refundedCredits: parseCreditInteger(String(row.refunded_credits)),
    actualNanodollars: row.actual_nano === null ? null : BigInt(row.actual_nano),
    rateVersion: row.rate_version,
  };
}
function tokenCount(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Token count must be a nonnegative safe integer or null.");
  return value;
}

/** Settles an existing bounded reservation; null cost holds it for review. */
export async function settleTokenReservation(
  db: AppDatabase,
  requestId: string,
  charge: TokenCharge | null,
  tokens?: { inputTokens: number | null; outputTokens: number | null },
): Promise<TokenSettlement> {
  if (charge && (charge.nanodollars < 0n || charge.nanodollars > POSTGRES_BIGINT_MAX)) {
    throw new Error("Token charge is outside the supported nonnegative bigint range.");
  }
  return result(await db.prepare(
    "SELECT * FROM settle_token_reservation(?,?::bigint,?,?::bigint,?::bigint)",
  ).bind(requestId, charge?.nanodollars.toString() ?? null, charge?.version ?? null,
    tokenCount(tokens?.inputTokens), tokenCount(tokens?.outputTokens)).first<SettlementRow>());
}

/** Returns the original included/paid reservation sources once, without spend. */
export async function refundTokenReservation(db: AppDatabase, requestId: string): Promise<TokenSettlement> {
  return result(await db.prepare("SELECT * FROM refund_token_reservation(?)").bind(requestId).first<SettlementRow>());
}
