import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  getOrganizationContext,
  getDashboardOrganizationContext,
  performOrganizationAction,
  resolveWorkspace,
} from "../src/server/organizations";
import { provisionHostedAccount } from "../src/server/auth";
import type { AppEnv } from "../src/server/db";
import { performWorkspaceAction } from "../src/server/workspace-actions";
import { readWorkspaceAnalytics } from "../src/server/analytics/workspace";
import { database } from "./support/postgres";

let env: AppEnv;
const originalFetch = globalThis.fetch;
let calls: Array<{ path: string; method: string; body: any }>;
let organizations: any[], memberships: any[], invitations: any[];
let failMembership = false;
const roles = [
  {
    slug: "owner",
    permissions: ["classifier:workspace:manage", "classifier:workspace:own"],
  },
  { slug: "admin", permissions: ["classifier:workspace:manage"] },
  { slug: "member", permissions: [] },
  { slug: "custom-manager", permissions: ["classifier:workspace:manage"] },
];
const users = ["owner", "member", "outsider"].map((name) => ({
  id: `user_${name}`,
  email: `${name}@example.com`,
  email_verified: true,
  first_name: name,
  last_name: null,
}));
const list = (data: any[]) =>
  Response.json({
    object: "list",
    data,
    list_metadata: { before: null, after: null },
  });
function member(user: string, org: string, role: string) {
  return {
    object: "organization_membership",
    id: `om_${memberships.length}`,
    organization_id: org,
    organization_name: organizations.find((o) => o.id === org)?.name,
    user_id: `user_${user}`,
    status: "active",
    role: { slug: role },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    custom_attributes: {},
  };
}
beforeEach(async () => {
  env = {
    APP_DB: database(),
    WORKOS_API_KEY: "sk_test_fixture",
    WORKOS_CLIENT_ID: "client_fixture",
  };
  calls = [];
  organizations = [];
  memberships = [];
  invitations = [];
  failMembership = false;
  for (const user of users)
    await provisionHostedAccount({ id: user.id, email: user.email }, env);
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.hostname !== "api.workos.com")
      throw new Error("Unexpected network call");
    const path = url.pathname,
      method = init?.method ?? "GET",
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (path === "/organizations" && method === "POST") {
      const org = {
        id: `org_${organizations.length}`,
        name: body.name,
        object: "organization",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        domains: [],
      };
      organizations.push(org);
      return Response.json(org);
    }
    if (path.endsWith("/roles"))
      return list(
        roles.map((r) => ({ ...r, object: "role", type: "EnvironmentRole" })),
      );
    if (path.startsWith("/organizations/")) {
      const id = path.split("/")[2];
      if (method === "DELETE") {
        organizations = organizations.filter((o) => o.id !== id);
        return new Response(null, { status: 204 });
      }
      const org = organizations.find((o) => o.id === id);
      if (body?.name) {
        org.name = body.name;
        memberships
          .filter((m) => m.organization_id === id)
          .forEach((m) => (m.organization_name = body.name));
      }
      return Response.json(org);
    }
    if (path === "/user_management/organization_memberships") {
      if (method === "POST") {
        if (failMembership)
          return Response.json(
            { message: "fixture unavailable" },
            { status: 503 },
          );
        const m = member(
          body.user_id.slice(5),
          body.organization_id,
          body.role_slug,
        );
        memberships.push(m);
        return Response.json(m);
      }
      return list(
        memberships.filter(
          (m) =>
            (!url.searchParams.get("user_id") ||
              m.user_id === url.searchParams.get("user_id")) &&
            (!url.searchParams.get("organization_id") ||
              m.organization_id === url.searchParams.get("organization_id")) &&
            m.status === "active",
        ),
      );
    }
    if (path.startsWith("/user_management/organization_memberships/")) {
      const id = path.split("/")[3];
      const m = memberships.find((m) => m.id === id);
      if (method === "DELETE") {
        memberships = memberships.filter((m) => m.id !== id);
        return new Response(null, { status: 204 });
      }
      m.role = { slug: body.role_slug };
      return Response.json(m);
    }
    if (path.startsWith("/user_management/users/"))
      return Response.json(users.find((u) => u.id === path.split("/")[3]));
    if (path === "/user_management/invitations") {
      if (method === "POST") {
        const invite = {
          id: `inv_${invitations.length}`,
          ...body,
          state: "pending",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          token: "must-not-leak",
          accept_invitation_url: "https://secret.test",
        };
        invitations.push(invite);
        return Response.json(invite);
      }
      return list(
        invitations.filter(
          (i) => i.organization_id === url.searchParams.get("organization_id"),
        ),
      );
    }
    if (path.startsWith("/user_management/invitations/")) {
      const invite = invitations.find((i) => i.id === path.split("/")[3]);
      if (path.endsWith("/revoke")) invite.state = "revoked";
      return Response.json(invite);
    }
    throw new Error(`Unhandled ${method} ${path}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const action = (
  workspace: string | undefined,
  input: unknown,
  user = "owner",
) => performOrganizationAction(`workos:user_${user}`, workspace, input, env);
async function create() {
  return (await action(undefined, { type: "create", name: " Acme " })).active
    .id;
}
async function paid(id: string) {
  await env.APP_DB.prepare(
    "UPDATE app_accounts SET billing_plan='pro' WHERE id=?",
  )
    .bind(id)
    .run();
}

test("creation selects an owned organization with separate funds and billing", async () => {
  const id = await create();
  const ctx = await getOrganizationContext("workos:user_owner", id, env);
  expect(ctx.active).toEqual({
    id,
    name: "Acme",
    kind: "organization",
    role: "owner",
  });
  expect(ctx.workspaces).toHaveLength(2);
  expect(
    await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id=?")
      .bind(id)
      .first(),
  ).toEqual({ balance: 0 });
  expect(
    await env.APP_DB.prepare(
      "SELECT customer_id FROM app_autumn_customers WHERE account_id=?",
    )
      .bind(id)
      .first(),
  ).toEqual({ customer_id: "org_0" });
  expect(await create()).not.toBe(id); // same owner's billing email can own multiple workspaces
});
test("membership failure cleans up the uncommitted organization", async () => {
  failMembership = true;
  await expect(create()).rejects.toThrow();
  expect(organizations).toHaveLength(0);
  expect(
    (
      await env.APP_DB.prepare(
        "SELECT * FROM app_workspaces WHERE kind='organization'",
      ).all()
    ).results,
  ).toHaveLength(0);
});
test("invitations are emailed with the intended role, normalized and revocable", async () => {
  const id = await create();
  await paid(id);
  const result = await action(id, {
    type: "invite",
    email: "Member@Example.com",
    role: "admin",
  });
  expect(
    calls.find(
      (c) => c.path === "/user_management/invitations" && c.method === "POST",
    )?.body,
  ).toEqual({
    email: "member@example.com",
    organization_id: "org_0",
    inviter_user_id: "user_owner",
    role_slug: "admin",
  });
  expect(result.invitations[0].status).toBe("pending");
  expect(JSON.stringify(result)).not.toContain("must-not-leak");
  await expect(
    action(id, { type: "invite", email: "member@example.com", role: "member" }),
  ).rejects.toThrow("already pending");
  expect(
    (await action(id, { type: "revoke-invite", invitationId: "inv_0" }))
      .invitations,
  ).toHaveLength(0);
});
test("accepted memberships appear immediately and removed users lose access", async () => {
  const id = await create();
  memberships.push(member("member", "org_0", "member"));
  expect(
    (
      await getOrganizationContext("workos:user_member", undefined, env)
    ).workspaces.map((w) => w.id),
  ).toContain(id);
  expect((await resolveWorkspace("workos:user_member", id, env)).role).toBe(
    "member",
  );
  await expect(
    action(
      id,
      { type: "invite", email: "x@example.com", role: "member" },
      "member",
    ),
  ).rejects.toThrow("Only owners and admins");
  await action(id, { type: "remove-member", accountId: "workos:user_member" });
  await expect(resolveWorkspace("workos:user_member", id, env)).rejects.toThrow(
    "do not have access",
  );
  expect(
    (await getDashboardOrganizationContext("workos:user_member", id, env))
      .active.kind,
  ).toBe("personal");
});
test("cross-tenant switching, invitations and member mutations are rejected", async () => {
  const id = await create();
  await paid(id);
  await expect(
    action(id, { type: "switch", workspaceId: id }, "outsider"),
  ).rejects.toThrow("do not have access");
  invitations.push({
    id: "inv_other",
    organization_id: "org_other",
    state: "pending",
  });
  await expect(
    action(id, { type: "revoke-invite", invitationId: "inv_other" }),
  ).rejects.toThrow("not found");
  await expect(
    action(id, {
      type: "set-role",
      accountId: "workos:user_outsider",
      role: "owner",
    }),
  ).rejects.toThrow("not found");
});
test("custom permissions work and owner actions stay owner-only", async () => {
  const id = await create();
  memberships.push(member("member", "org_0", "custom-manager"));
  expect((await resolveWorkspace("workos:user_member", id, env)).role).toBe(
    "admin",
  );
  expect(
    (await action(id, { type: "rename", name: "Renamed" }, "member")).active
      .name,
  ).toBe("Renamed");
  await expect(
    action(
      id,
      { type: "remove-member", accountId: "workos:user_owner" },
      "member",
    ),
  ).rejects.toThrow("Only owners");
  await action(id, {
    type: "set-role",
    accountId: "workos:user_member",
    role: "owner",
  });
  expect((await resolveWorkspace("workos:user_member", id, env)).role).toBe(
    "owner",
  );
});
test("last owner cannot be removed or demoted", async () => {
  const id = await create();
  for (const input of [
    { type: "remove-member", accountId: "workos:user_owner" },
    { type: "set-role", accountId: "workos:user_owner", role: "member" },
  ])
    await expect(action(id, input)).rejects.toThrow("last owner");
});
test("seat limits, expired invitations and concurrent changes are handled", async () => {
  const id = await create();
  await expect(
    action(id, { type: "invite", email: "member@example.com", role: "member" }),
  ).rejects.toThrow("All seats");
  await paid(id);
  invitations.push({
    id: "expired",
    organization_id: "org_0",
    state: "pending",
    expires_at: "2000-01-01",
  });
  const outcomes = await Promise.allSettled(
    ["a", "b"].map((email) =>
      action(id, {
        type: "invite",
        email: `${email}@example.com`,
        role: "member",
      }),
    ),
  );
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
  expect(
    (
      await env.APP_DB.prepare(
        "SELECT * FROM app_organization_operations",
      ).all()
    ).results,
  ).toHaveLength(0);
});
test("invalid actions never reach WorkOS", async () => {
  for (const input of [
    { type: "create", name: " " },
    { type: "invite", email: "no", role: "owner" },
    { type: "set-role", accountId: "x", role: "root" },
  ])
    await expect(action(undefined, input)).rejects.toThrow(
      "Invalid organization action",
    );
  expect(calls).toHaveLength(0);
});

test("member analytics remain scoped and secrets and billing require management", async () => {
  const id = await create();
  memberships.push(member("member", "org_0", "member"));
  const memberId = "workos:user_member";
  let calls = 0;
  await readWorkspaceAnalytics(
    memberId,
    { workspaceId: id, kind: "summary", params: {} },
    {
      ...env,
      CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
      CF_ANALYTICS_TOKEN: "test",
    },
    (async (_url, init) => {
      calls++;
      expect(init?.body).toContain("index1 = 'workos:org_0'");
      return Response.json({ data: [] });
    }) as typeof fetch,
  );
  expect(calls).toBe(1);
  for (const input of [
    { type: "reveal-key", keyId: "key_other" },
    { type: "create-key", name: "No" },
    { type: "billing-checkout" },
  ])
    await expect(
      performWorkspaceAction(memberId, id, input as never, env),
    ).rejects.toThrow("Only workspace owners and admins");
});
