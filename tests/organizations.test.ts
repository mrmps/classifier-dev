import { beforeEach, expect, test } from "bun:test";
import { database } from "./support/postgres";
import { demoLogin } from "../src/server/auth";
import {
  getOrganizationContext,
  performOrganizationAction,
  resolveWorkspace,
  assertWorkspaceMutation,
  isDemoWorkspace,
} from "../src/server/organizations";
import { getSnapshot } from "../src/server/accounts";
import { performAction } from "../src/server/agents";
import { authorizeAndReserve, completeReservation } from "../src/server/usage";
import type { AppEnv } from "../src/server/db";
let env: AppEnv;
beforeEach(async () => {
  env = { APP_DB: database(), APP_DEMO: "true", API_KEY_ENCRYPTION_KEY: "test-only-key-encryption-secret-32-characters" };
  await demoLogin(
    new Request("http://localhost/auth/demo", {
      method: "POST",
      headers: { Origin: "http://localhost" },
    }),
    env,
  );
});
const create = (name = "Research team") =>
  performOrganizationAction(
    "local-demo",
    undefined,
    { type: "create", name },
    env,
  );
async function addIdentity(id: string, workspaceId: string, role = "member") {
  const timestamp = new Date().toISOString();
  await env.APP_DB.prepare(
    "INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at,period_start) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(id, `${id}@example.com`, id, 0, timestamp, timestamp, timestamp)
    .run();
  await env.APP_DB.prepare(
    "INSERT INTO app_memberships(identity_account_id,workspace_id,role,joined_at) VALUES(?,?,?,?)",
  )
    .bind(id, workspaceId, role, timestamp)
    .run();
}
test("personal account survives org creation; keys and usage stay scoped", async () => {
  const personal = await performAction(
    "local-demo",
    { type: "create-key", name: "Personal script" },
    env,
  );
  const first = await create();
  const second = await create("Another team");
  expect(first.active.role).toBe("owner");
  expect(first.active.kind).toBe("organization");
  expect(first.identity.id).toBe("local-demo");
  expect(first.members).toHaveLength(1);
  const personalBalance = (await getSnapshot("local-demo", env)).credits.balance;
  expect((await getSnapshot(first.active.id, env)).credits.balance).toBe(0);
  expect((await getSnapshot(second.active.id, env)).credits.balance).toBe(0);
  // A team must subscribe before it can spend; the personal grant stays personal.
  await performAction(first.active.id, {
    type: "billing-subscribe", plan: "pro", idempotencyKey: "team-plan",
  }, env);
  expect((await getSnapshot("local-demo", env)).credits.balance).toBe(personalBalance);
  const key = await performAction(
    first.active.id,
    { type: "create-key", name: "Team script" },
    env,
  );
  const reservation = (await authorizeAndReserve(
    new Request("http://localhost/v1/classify", {
      headers: { Authorization: `Bearer ${key.secret}` },
    }),
    env,
    3,
  ))!;
  await completeReservation(reservation, env, true);
  expect((await getSnapshot(first.active.id, env)).usageTotals.items).toBe(3);
  expect((await getSnapshot(second.active.id, env)).keys).toHaveLength(0);
  expect((await getSnapshot("local-demo", env)).keys[0].id).toBe(
    personal.agentId!,
  );
  await expect(
    performAction(
      second.active.id,
      { type: "revoke-key", keyId: key.agentId! },
      env,
    ),
  ).rejects.toThrow();
  expect((await getSnapshot(first.active.id, env)).keys[0].status).toBe(
    "connected",
  );
});
test("forged workspace and demo prefixes never grant access", async () => {
  const team = await create();
  await addIdentity("outsider", team.active.id);
  await env.APP_DB.prepare(
    "DELETE FROM app_memberships WHERE identity_account_id=?",
  )
    .bind("outsider")
    .run();
  await expect(
    resolveWorkspace("outsider", team.active.id, env),
  ).rejects.toThrow("access");
  await expect(
    resolveWorkspace("local-demo", "demo-org:forged", env),
  ).rejects.toThrow("access");
  expect(await isDemoWorkspace("demo-org:forged", env)).toBe(false);
});
test("pending invitations are local records, seat-limited and revocable", async () => {
  const team = await create();
  await expect(
    performOrganizationAction(
      "local-demo",
      team.active.id,
      { type: "invite", email: "friend@example.com", role: "member" },
      env,
    ),
  ).rejects.toThrow("seats");
  await env.APP_DB.prepare(
    "UPDATE app_accounts SET billing_plan='pro' WHERE id=?",
  )
    .bind(team.active.id)
    .run();
  const pending = await performOrganizationAction(
    "local-demo",
    team.active.id,
    { type: "invite", email: "friend@example.com", role: "member" },
    env,
  );
  expect(pending.invitations[0].status).toBe("prepared");
  expect(pending.members).toHaveLength(1);
  await expect(
    performOrganizationAction(
      "local-demo",
      team.active.id,
      { type: "invite", email: "FRIEND@example.com", role: "member" },
      env,
    ),
  ).rejects.toThrow("already exists");
  await performOrganizationAction(
    "local-demo",
    team.active.id,
    { type: "invite", email: "second@example.com", role: "admin" },
    env,
  );
  await expect(
    performOrganizationAction(
      "local-demo",
      team.active.id,
      { type: "invite", email: "third@example.com", role: "member" },
      env,
    ),
  ).rejects.toThrow("seats");
  const result = await performOrganizationAction(
    "local-demo",
    team.active.id,
    { type: "revoke-invite", invitationId: pending.invitations[0].id },
    env,
  );
  expect(result.invitations).toHaveLength(1);
});
test("last owner protected; removal blocks membership without disrupting workspace keys", async () => {
  const team = await create();
  for (const action of [
    { type: "set-role", accountId: "local-demo", role: "member" },
    { type: "remove-member", accountId: "local-demo" },
  ])
    await expect(
      performOrganizationAction("local-demo", team.active.id, action, env),
    ).rejects.toThrow("last owner");
  await addIdentity("colleague", team.active.id);
  await performAction(
    team.active.id,
    { type: "create-key", name: "Shared" },
    env,
  );
  await performOrganizationAction(
    "local-demo",
    team.active.id,
    { type: "set-role", accountId: "colleague", role: "admin" },
    env,
  );
  const result = await performOrganizationAction(
    "local-demo",
    team.active.id,
    { type: "remove-member", accountId: "colleague" },
    env,
  );
  expect(result.members).toHaveLength(1);
  expect((await getSnapshot(team.active.id, env)).keys[0].status).toBe(
    "pending",
  );
  await expect(
    resolveWorkspace("colleague", team.active.id, env),
  ).rejects.toThrow("access");
});
test("roles gate mutations and hosted organization management fails closed", async () => {
  expect(() => assertWorkspaceMutation("owner", undefined)).toThrow(
    "Invalid account action",
  );
  expect(() => assertWorkspaceMutation("member", "create-key")).toThrow();
  expect(() => assertWorkspaceMutation("admin", "billing-top-up")).toThrow();
  expect(() => assertWorkspaceMutation("member", "refresh")).not.toThrow();
  const team = await create();
  await addIdentity("other-owner", team.active.id, "owner");
  await env.APP_DB.prepare(
    "UPDATE app_memberships SET role='member' WHERE identity_account_id='local-demo' AND workspace_id=?",
  )
    .bind(team.active.id)
    .run();
  await expect(
    performOrganizationAction(
      "local-demo",
      team.active.id,
      { type: "rename", name: "Forged" },
      env,
    ),
  ).rejects.toThrow("role");
  await expect(
    performOrganizationAction(
      "local-demo",
      undefined,
      { type: "create", name: "Remote" },
      { ...env, APP_DEMO: "false" },
    ),
  ).rejects.toThrow("not configured");
  expect(
    (await getOrganizationContext("local-demo", undefined, env)).identity.name,
  ).toBe("Your workspace");
});

test("persisted demo workspace credentials stay blocked on hosted origins", async () => {
  const team = await create();
  const key = await performAction(
    team.active.id,
    { type: "create-key", name: "Local key" },
    env,
  );
  const hosted = { ...env, APP_DEMO: "false", APP_ACCOUNTS_ENABLED: "true" };
  await expect(
    authorizeAndReserve(
      new Request("https://classifier.dev/v1/classify", {
        headers: { Authorization: `Bearer ${key.secret}` },
      }),
      hosted,
      1,
    ),
  ).rejects.toThrow();
  expect((await getSnapshot(team.active.id, env)).usageTotals.items).toBe(0);
});

test("dashboard mutations enforce current membership and personal profile scope", async () => {
  const { performWorkspaceAction } =
    await import("../src/server/workspace-actions");
  const team = await create("Organization name");
  const key = await performWorkspaceAction(
    "local-demo",
    team.active.id,
    { type: "create-key", name: "Shared" },
    env,
  );
  await addIdentity("other-owner", team.active.id, "owner");
  await env.APP_DB.prepare(
    "UPDATE app_memberships SET role='member' WHERE identity_account_id='local-demo' AND workspace_id=?",
  )
    .bind(team.active.id)
    .run();
  for (const action of [
    { type: "create-key", name: "Denied" },
    { type: "enroll", client: "Claude Code", name: "Denied" },
    { type: "pause", agentId: key.agentId! },
    { type: "revoke-key", keyId: key.agentId! },
  ] as import("../src/server/contracts").AppAction[]) {
    await expect(
      performWorkspaceAction("local-demo", team.active.id, action, env),
    ).rejects.toThrow("Only workspace owners and admins");
  }
  const renamed = await performWorkspaceAction(
    "local-demo",
    team.active.id,
    { type: "set-name", name: "Personal name" },
    env,
  );
  expect(renamed.snapshot.organizations.identity.name).toBe("Personal name");
  expect(renamed.snapshot.account.name).toBe("Organization name");
  expect(renamed.snapshot.keys).toHaveLength(1);
  await env.APP_DB.prepare(
    "UPDATE app_memberships SET role='admin' WHERE identity_account_id='local-demo' AND workspace_id=?",
  )
    .bind(team.active.id)
    .run();
  await expect(
    performWorkspaceAction(
      "local-demo",
      team.active.id,
      { type: "billing-top-up", amountCents: 1000 },
      env,
    ),
  ).rejects.toThrow("Only workspace owners");
  await performWorkspaceAction(
    "local-demo",
    team.active.id,
    { type: "pause", agentId: key.agentId! },
    env,
  );
  expect((await getSnapshot(team.active.id, env)).keys[0].status).toBe(
    "paused",
  );
  await env.APP_DB.prepare(
    "DELETE FROM app_memberships WHERE identity_account_id='local-demo' AND workspace_id=?",
  )
    .bind(team.active.id)
    .run();
  await expect(
    performWorkspaceAction(
      "local-demo",
      team.active.id,
      { type: "refresh" },
      env,
    ),
  ).rejects.toThrow("access");
});

test("dashboard rejects cross-workspace key and agent mutation IDs", async () => {
  const { performWorkspaceAction } =
    await import("../src/server/workspace-actions");
  const first = await create("First");
  const second = await create("Second");
  const key = await performWorkspaceAction(
    "local-demo",
    first.active.id,
    { type: "create-key", name: "First only" },
    env,
  );
  for (const action of [
    { type: "pause", agentId: key.agentId! },
    { type: "resume", agentId: key.agentId! },
    { type: "revoke", agentId: key.agentId! },
    { type: "revoke-key", keyId: key.agentId! },
  ] as import("../src/server/contracts").AppAction[]) {
    await expect(
      performWorkspaceAction("local-demo", second.active.id, action, env),
    ).rejects.toThrow("not found");
  }
  const untouched = await getSnapshot(first.active.id, env);
  expect(untouched.keys[0].status).toBe("pending");
  expect((await getSnapshot(second.active.id, env)).keys).toHaveLength(0);
});

test("invitations cannot be revoked from another workspace and DB protects the final owner", async () => {
  const first = await create("First");
  const second = await create("Second");
  await env.APP_DB.prepare(
    "UPDATE app_accounts SET billing_plan='pro' WHERE id=?",
  )
    .bind(first.active.id)
    .run();
  const invited = await performOrganizationAction(
    "local-demo",
    first.active.id,
    { type: "invite", email: "teammate@example.com", role: "member" },
    env,
  );
  await expect(
    performOrganizationAction(
      "local-demo",
      second.active.id,
      { type: "revoke-invite", invitationId: invited.invitations[0].id },
      env,
    ),
  ).rejects.toThrow("not found");
  expect(
    (await getOrganizationContext("local-demo", first.active.id, env))
      .invitations,
  ).toHaveLength(1);
  await expect(
    (async () =>
      env.APP_DB.prepare(
        "DELETE FROM app_memberships WHERE identity_account_id='local-demo' AND workspace_id=?",
      )
        .bind(first.active.id)
        .run())(),
  ).rejects.toThrow("last owner");
  await expect(
    (async () =>
      env.APP_DB.prepare(
        "UPDATE app_memberships SET role='member' WHERE identity_account_id='local-demo' AND workspace_id=?",
      )
        .bind(first.active.id)
        .run())(),
  ).rejects.toThrow("last owner");
});
