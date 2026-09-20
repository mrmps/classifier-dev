import { beforeEach, expect, test } from "bun:test";
import { billingSnapshot } from "../src/server/billing";
import type { AppEnv } from "../src/server/db";
import { provisionTestAccount } from "./support/account";
import { database } from "./support/postgres";

let env: AppEnv;

beforeEach(async () => {
  env = {
    APP_DB: database(),
    APP_ACCOUNTS_ENABLED: "true",
    API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters",
  };
  await provisionTestAccount(new Request("http://localhost"), env);
});

test("billing uses provider mode only when hosted checkout is configured", async () => {
  expect((await billingSnapshot("local-demo", env)).mode).toBe("unconfigured");
  expect(
    (
      await billingSnapshot("local-demo", {
        ...env,
        AUTUMN_SECRET_KEY: "am_sk_test",
        AUTUMN_PRO_PLAN_ID: "pro",
      })
    ).mode,
  ).toBe("autumn");
});

test("stored transactions are always confirmed provider records", async () => {
  await env.APP_DB.prepare(
    "INSERT INTO app_transactions(id,account_id,idempotency_key,kind,amount_cents,credits,created_at,plan_id) VALUES('tx','local-demo','event','subscription',2000,200000,'2026-01-01T00:00:00.000Z','pro')",
  ).run();
  const billing = await billingSnapshot("local-demo", env);
  expect(billing.transactions).toHaveLength(1);
  expect(billing.transactions[0].status).toBe("confirmed");
});
