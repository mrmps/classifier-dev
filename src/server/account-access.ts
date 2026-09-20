import { AppError, hashToken, type AppEnv } from "./db";

/** Returns only the account attached to a verified, currently usable API key. */
export async function requireApiAccount(
  request: Request,
  env: AppEnv,
): Promise<string> {
  if (env.APP_ACCOUNTS_ENABLED !== "true")
    throw new AppError(
      503,
      "Account credentials are not enabled for this deployment.",
    );
  const match = /^Bearer\s+(classifier_agent_[A-Za-z0-9_-]+)$/i.exec(
    request.headers.get("authorization") ?? "",
  );
  if (!match) throw new AppError(401, "Provide an account API key.");
  const key = await env.APP_DB.prepare(
    "SELECT account_id FROM app_agents WHERE token_hash=? AND status IN ('pending','connected')",
  )
    .bind(await hashToken(match[1]))
    .first<{ account_id: string }>();
  if (!key) throw new AppError(401, "Invalid, paused, or revoked API key.");
  return key.account_id;
}

function dollars(credits: number): string {
  if (!Number.isSafeInteger(credits) || credits < 0)
    throw new AppError(503, "Balance is unavailable.");
  const value = BigInt(credits);
  return `${value / 100000n}.${(value % 100000n).toString().padStart(5, "0")}`;
}

export async function readAccountBalance(accountId: string, env: AppEnv) {
  // One statement gives a consistent snapshot of spendable funds and open holds.
  const row = await env.APP_DB.prepare(
    "SELECT balance,COALESCE((SELECT SUM(COALESCE(reserved_credits,credits)) FROM app_usage WHERE account_id=a.id AND status='pending'),0) AS reserved FROM app_accounts a WHERE id=?",
  )
    .bind(accountId)
    .first<{ balance: number; reserved: number }>();
  if (!row) throw new AppError(404, "Account not found.");
  return {
    currency: "USD",
    available: dollars(row.balance),
    reserved: dollars(row.reserved),
    exact: true,
  };
}
