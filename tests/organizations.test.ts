import { beforeEach, expect, test } from "bun:test";
import {
  getOrganizationContext,
  performOrganizationAction,
} from "../src/server/organizations";
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

test("account provisioning creates the same hosted workspace locally and remotely", async () => {
  const context = await getOrganizationContext("local-demo", undefined, env);
  expect(context.mode).toBe("unconfigured");
  expect(context.active.kind).toBe("personal");
});

test("unfinished organization mutations are unavailable in every environment", async () => {
  await expect(
    performOrganizationAction(
      "local-demo",
      undefined,
      { type: "create", name: "Acme" },
      env,
    ),
  ).rejects.toThrow("not available yet");
});
