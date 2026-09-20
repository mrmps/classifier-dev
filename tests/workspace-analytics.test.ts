import { expect, test } from "bun:test";
import { database } from "./support/postgres";
import { readWorkspaceAnalytics } from "../src/server/analytics/workspace";
import type { AppEnv } from "../src/server/db";

test("analytics authorize the explicitly requested workspace and reject non-members before fetching", async () => {
  const db = database();
  const env: AppEnv = { APP_DB: db, CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CF_ANALYTICS_TOKEN: "test" };
  for (const id of ["person", "team", "unrelated"]) {
    await db.prepare("INSERT INTO app_accounts(id,email,name,reset_at,created_at) VALUES(?,?,?,'later','now')").bind(id, `${id}@example.invalid`, id).run();
    await db.prepare("INSERT INTO app_workspaces(account_id,kind,mode,created_at) VALUES(?,'personal','hosted','now')").bind(id).run();
  }
  await db.prepare("INSERT INTO app_memberships(identity_account_id,workspace_id,role,joined_at) VALUES('person','person','owner','now')").run();
  let calls = 0;
  const fetcher = (async (_url, init) => {
    calls++;
    expect(init?.body).toContain("index1 = 'person'");
    expect(init?.body).not.toContain("index1 = 'team'");
    return Response.json({ data: [] });
  }) as typeof fetch;
  await readWorkspaceAnalytics("person", { workspaceId: "person", kind: "summary", params: {} }, env, fetcher);
  expect(calls).toBe(1);
  await expect(readWorkspaceAnalytics("person", { workspaceId: "unrelated", kind: "summary", params: {} }, env, fetcher)).rejects.toThrow("do not have access");
  for (const params of ["x", [], { interval: 1 }]) {
    await expect(readWorkspaceAnalytics("person", { workspaceId: "person", kind: "summary", params } as never, env, fetcher)).rejects.toThrow("Invalid analytics query");
  }
  expect(calls).toBe(1);
});
