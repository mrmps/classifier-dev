// Run against an isolated WorkOS sandbox and an isolated PostgreSQL test database.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { WorkOS } from "@workos-inc/node";
import { postgresDatabase, parseCreditInteger } from "../src/server/db";
import { provisionHostedAccount } from "../src/server/auth";
import {
  performOrganizationAction,
  getOrganizationContext,
  resolveWorkspace,
} from "../src/server/organizations";
import assert from "node:assert/strict";
if (!process.env.WORKOS_API_KEY?.startsWith("sk_test_"))
  throw new Error("Sandbox key required");
const db = new PGlite({
  parsers: { 20: parseCreditInteger, 1700: parseCreditInteger },
});
for (const file of readdirSync("migrations/postgres")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db.exec(readFileSync(`migrations/postgres/${file}`, "utf8"));
const APP_DB = postgresDatabase(async (queries) =>
  db.transaction(async (tx) => {
    const results = [];
    for (const q of queries) {
      const result = await tx.query(q.sql, q.params);
      results.push({
        results: result.rows as Record<string, unknown>[],
        meta: { changes: result.affectedRows ?? 0 },
      });
    }
    return results;
  }),
);
const env = {
  APP_DB,
  WORKOS_API_KEY: process.env.WORKOS_API_KEY,
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID,
};
const client = new WorkOS(env.WORKOS_API_KEY);
const suffix = crypto.randomUUID();
const createdUsers: string[] = [],
  createdOrgs: string[] = [];
try {
  const owner = await client.userManagement.createUser({
    email: `classifier-owner-${suffix}@example.com`,
    emailVerified: true,
  });
  createdUsers.push(owner.id);
  const member = await client.userManagement.createUser({
    email: `classifier-member-${suffix}@example.com`,
    emailVerified: true,
  });
  createdUsers.push(member.id);
  const identity = await provisionHostedAccount(owner, env);
  await provisionHostedAccount(member, env);
  const ctx = await performOrganizationAction(
    identity,
    undefined,
    { type: "create", name: "Classifier organization smoke test" },
    env,
  );
  const id = ctx.active.id;
  createdOrgs.push(id.slice(7));
  assert.equal(ctx.active.role, "owner");
  await APP_DB.prepare("UPDATE app_accounts SET billing_plan='pro' WHERE id=?")
    .bind(id)
    .run();
  // WorkOS sandbox email delivery is simulated; these addresses are reserved test data.
  const invited = await performOrganizationAction(
    identity,
    id,
    { type: "invite", email: member.email, role: "member" },
    env,
  );
  assert.equal(invited.invitations.length, 1);
  await client.userManagement.acceptInvitation(invited.invitations[0].id, {
    userId: member.id,
  });
  const joined = await getOrganizationContext(`workos:${member.id}`, id, env);
  assert.equal(joined.active.role, "member");
  assert.equal(joined.members.length, 2);
  await assert.rejects(
    performOrganizationAction(
      `workos:${member.id}`,
      id,
      { type: "rename", name: "Forbidden" },
      env,
    ),
  );
  await performOrganizationAction(
    identity,
    id,
    { type: "set-role", accountId: `workos:${member.id}`, role: "admin" },
    env,
  );
  assert.equal(
    (await resolveWorkspace(`workos:${member.id}`, id, env)).role,
    "admin",
  );
  await performOrganizationAction(
    identity,
    id,
    { type: "remove-member", accountId: `workos:${member.id}` },
    env,
  );
  await assert.rejects(resolveWorkspace(`workos:${member.id}`, id, env));
  const pending = await performOrganizationAction(
    identity,
    id,
    { type: "invite", email: member.email, role: "member" },
    env,
  );
  await performOrganizationAction(
    identity,
    id,
    { type: "revoke-invite", invitationId: pending.invitations[0].id },
    env,
  );
  assert.equal(
    (await getOrganizationContext(identity, id, env)).invitations.length,
    0,
  );
  console.log(
    "PASS: live WorkOS create, invite, accept, permissions, role change, removal, revoke; isolated PostgreSQL billing mapping.",
  );
} finally {
  for (const id of createdOrgs)
    await client.organizations.deleteOrganization(id);
  for (const id of createdUsers) await client.userManagement.deleteUser(id);
  await db.close();
}
