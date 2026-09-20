import { FREE_ALLOWANCE_CREDITS } from "../../src/lib/billing";
import { now, type AppEnv } from "../../src/server/db";

/** Test-only account fixture. Runtime authentication always goes through WorkOS. */
export async function provisionTestAccount(
  _request: Request,
  env: AppEnv,
  accountId = "local-demo",
): Promise<string> {
  const timestamp = now();
  await env.APP_DB.prepare(
    "INSERT INTO app_accounts(id,email,name,reset_at,created_at,period_start,balance,signup_granted_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  )
    .bind(
      accountId,
      "test@example.com",
      "Test workspace",
      new Date(Date.now() + 30 * 86400000).toISOString(),
      timestamp,
      timestamp,
      FREE_ALLOWANCE_CREDITS,
      timestamp,
    )
    .run();
  return accountId;
}
