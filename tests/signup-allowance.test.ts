import { expect, test } from "bun:test";
import { database } from "./support/postgres";
import { provisionHostedAccount } from "../src/server/auth";
import type { AppEnv } from "../src/server/db";

test("preactivation sign-ins receive their allowance once after activation, never after exhaustion", async () => {
  const env: AppEnv = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "false" };
  const user = { id: "user_signup", email: "signup@example.test", firstName: "Test" };
  const id = await provisionHostedAccount(user, env);
  const account = () => env.APP_DB.prepare(
    "SELECT balance,signup_granted_at FROM app_accounts WHERE id=?",
  ).bind(id).first<{ balance: number; signup_granted_at: string | null }>();
  expect(await account()).toEqual({ balance: 0, signup_granted_at: null });

  env.APP_ACCOUNTS_ENABLED = "true";
  await Promise.all(Array.from({ length: 3 }, () => provisionHostedAccount(user, env)));
  const granted = await account();
  expect(granted?.balance).toBe(500000);
  expect(granted?.signup_granted_at).not.toBeNull();

  await env.APP_DB.prepare("UPDATE app_accounts SET balance=0 WHERE id=?").bind(id).run();
  await provisionHostedAccount(user, env);
  expect(await account()).toEqual({ ...granted!, balance: 0 });
});

test("parallel first hosted sign-ins create one account and one allowance", async () => {
  const env: AppEnv = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true" };
  const user = { id: "user_new", email: "new@example.test" };
  await Promise.all(Array.from({ length: 3 }, () => provisionHostedAccount(user, env)));
  expect(await env.APP_DB.prepare("SELECT COUNT(*) AS count,SUM(balance) AS balance FROM app_accounts").first())
    .toEqual({ count: 1, balance: 500000 });
});
