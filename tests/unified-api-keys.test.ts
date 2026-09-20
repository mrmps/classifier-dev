import { beforeEach, expect, test } from "bun:test";
import { database } from "./support/postgres";
import { provisionTestAccount } from "./support/account";
import { ensureDefaultKey } from "../src/server/api-keys";
import { performAction } from "../src/server/agents";
import { performWorkspaceAction } from "../src/server/workspace-actions";
import { getSnapshot } from "../src/server/accounts";
import { authorizeAndReserve, completeReservation } from "../src/server/usage";
import type { AppEnv } from "../src/server/db";
let env: AppEnv;
beforeEach(async () => {
  env = {
    APP_DB: database(),
    APP_ACCOUNTS_ENABLED: "true",
    API_KEY_ENCRYPTION_KEY: "test-only-encryption-secret-with-32-characters",
  };
  await provisionTestAccount(
    new Request("http://localhost/auth/demo", {
      headers: { Origin: "http://localhost" },
    }),
    env,
  );
});
test("parallel provisioning creates one Default; revocation never recreates it", async () => {
  await Promise.all(
    Array.from({ length: 3 }, () => ensureDefaultKey("local-demo", env)),
  );
  const snapshot = await getSnapshot("local-demo", env);
  expect(snapshot.keys).toHaveLength(1);
  expect(snapshot.keys[0].name).toBe("Default");
  const id = snapshot.keys[0].id;
  const result = await performWorkspaceAction(
    "local-demo",
    undefined,
    { type: "reveal-key", keyId: id },
    env,
  );
  expect(result.secret).toStartWith("classifier_agent_");
  expect(JSON.stringify(result.snapshot)).not.toContain(result.secret!);
  const stored = await env.APP_DB.prepare(
    "SELECT token_hash,encrypted_secret FROM app_agents WHERE id=?",
  )
    .bind(id)
    .first<{ token_hash: string; encrypted_secret: string }>();
  expect(stored!.encrypted_secret).not.toContain(result.secret!);
  expect(stored!.token_hash).not.toBe(result.secret!);
  await performAction("local-demo", { type: "revoke-key", keyId: id }, env);
  await ensureDefaultKey("local-demo", env);
  expect((await getSnapshot("local-demo", env)).keys).toHaveLength(1);
  await expect(
    performAction("local-demo", { type: "reveal-key", keyId: id }, env),
  ).rejects.toThrow("Active API key not found");
});
test("rotation invalidates the old token, retains usage, and rejects stale rotations", async () => {
  const key = await performAction(
    "local-demo",
    { type: "create-key", name: "Research" },
    env,
  );
  const request = (secret: string) =>
    new Request("http://localhost/v1/classify", {
      headers: { Authorization: `Bearer ${secret}` },
    });
  const reservation = (await authorizeAndReserve(
    request(key.secret!),
    env,
    3,
  ))!;
  await completeReservation(reservation, env, true);
  const prefix = key.snapshot.keys[0].prefix;
  const rotated = await performAction(
    "local-demo",
    { type: "rotate-key", keyId: key.agentId!, prefix },
    env,
  );
  expect(rotated.secret).not.toBe(key.secret);
  await expect(
    authorizeAndReserve(request(key.secret!), env, 1),
  ).rejects.toThrow("Invalid agent credential");
  expect(
    (await authorizeAndReserve(request(rotated.secret!), env, 1))?.agentId,
  ).toBe(key.agentId!);
  expect(rotated.snapshot.agents[0].used).toBe(3);
  expect(
    await env.APP_DB.prepare(
      "SELECT agent_id FROM app_usage WHERE account_id='local-demo' LIMIT 1",
    ).first(),
  ).toEqual({ agent_id: key.agentId! });
  await expect(
    performAction(
      "local-demo",
      { type: "rotate-key", keyId: key.agentId!, prefix },
      env,
    ),
  ).rejects.toThrow("changed or was revoked");
  const revealed = await performAction(
    "local-demo",
    { type: "reveal-key", keyId: key.agentId! },
    env,
  );
  expect(revealed.secret).toBe(rotated.secret!);
  await performAction(
    "local-demo",
    { type: "rename-key", keyId: key.agentId!, name: "Production" },
    env,
  );
  expect(
    await env.APP_DB.prepare(
      "SELECT a.name FROM app_usage u JOIN app_agents a ON a.id=u.agent_id WHERE u.account_id='local-demo' LIMIT 1",
    ).first(),
  ).toEqual({ name: "Production" });
});
test("key reveal and mutations require membership and management permissions", async () => {
  const key = await performWorkspaceAction(
    "local-demo",
    undefined,
    { type: "create-key", name: "Private" },
    env,
  );
  await env.APP_DB.prepare(
    "INSERT INTO app_accounts(id,email,name,reset_at,created_at,period_start) VALUES('member','member@example.test','Member','2030-01-01','2026-01-01','2026-01-01')",
  ).run();
  await env.APP_DB.prepare(
    "INSERT INTO app_memberships(identity_account_id,workspace_id,role,joined_at) VALUES('member','local-demo','member','2026-01-01')",
  ).run();
  for (const action of [
    { type: "reveal-key", keyId: key.agentId! },
    {
      type: "rotate-key",
      keyId: key.agentId!,
      prefix: key.snapshot.keys[0].prefix,
    },
    { type: "rename-key", keyId: key.agentId!, name: "No" },
  ] as const) {
    await expect(
      performWorkspaceAction("member", "local-demo", action, env),
    ).rejects.toThrow("do not have access");
  }
  await expect(
    performAction("member", { type: "reveal-key", keyId: key.agentId! }, env),
  ).rejects.toThrow();
});
test("refresh provisions an uninitialized workspace once", async () => {
  const first = await performWorkspaceAction(
    "local-demo",
    undefined,
    { type: "refresh" },
    env,
  );
  expect(first.snapshot.keys).toHaveLength(1);
  expect(first.snapshot.keys[0].name).toBe("Default");
  const second = await performWorkspaceAction(
    "local-demo",
    undefined,
    { type: "refresh" },
    env,
  );
  expect(second.snapshot.keys[0].id).toBe(first.snapshot.keys[0].id);
});
