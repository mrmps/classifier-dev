import { expect, test } from "bun:test";
import { database } from "./support/postgres";
import { hashToken, type AppEnv } from "../src/server/db";
import { requireApiAccount } from "../src/server/account-access";
import { accountReadRoutes } from "../src/http/account";

async function setup() {
  const env: AppEnv = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", LIMITER: {
    idFromName: (name: string) => name,
    get: () => ({ fetch: async () => Response.json({ limited: false }) }),
  } as unknown as DurableObjectNamespace };
  for (const id of ["a", "b", "local-demo"]) {
    await env.APP_DB.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at) VALUES(?,?,?,?,?,?)")
      .bind(id, `${id}@example.com`, id, id === "a" ? 123456 : 999999, "2026-10-01", "2026-09-01").run();
    await env.APP_DB.prepare("INSERT INTO app_agents(id,account_id,name,client,token_hash,prefix,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(`key_${id}`, id, id, "API", await hashToken(`classifier_agent_${id}`), "prefix", "2026-09-01").run();
  }
  return env;
}
const request = (key = "a", path = "/v1/account/balance", host = "https://classifier.dev") =>
  new Request(host + path, { headers: { Authorization: `Bearer classifier_agent_${key}` } });

test("verified keys see only their own exact available balance and reservations", async () => {
  const env = await setup();
  await env.APP_DB.prepare("INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at) VALUES('hold','a','key_a',1,100,'pending','2026-09-01')").run();
  expect(await requireApiAccount(request(), env)).toBe("a");
  expect(await (await accountReadRoutes(request(), env))?.json()).toEqual({ currency: "USD", available: "1.23456", reserved: "0.00100", exact: true });
  expect(await (await accountReadRoutes(request("b"), env))?.json()).toEqual({ currency: "USD", available: "9.99999", reserved: "0.00000", exact: true });
  await expect(accountReadRoutes(request("a", "/v1/account/balance?account_id=b"), env)).rejects.toThrow("query parameters");
});

test("paused, revoked, malformed and unknown credentials cannot read account data", async () => {
  const env = await setup();
  for (const status of ["paused", "revoked"]) {
    await env.APP_DB.prepare("UPDATE app_agents SET status=? WHERE id='key_a'").bind(status).run();
    await expect(requireApiAccount(request(), env)).rejects.toThrow("revoked");
  }
  await expect(requireApiAccount(request("unknown"), env)).rejects.toThrow("Invalid");
  await expect(requireApiAccount(new Request("https://classifier.dev/v1/account/balance"), env)).rejects.toThrow("Provide");
});

test("the production feature gate applies identically on every hostname", async () => {
  const env = await setup();
  await expect(requireApiAccount(request(), { ...env, APP_ACCOUNTS_ENABLED: "false" })).rejects.toThrow("not enabled");
  expect(await requireApiAccount(request("local-demo"), env)).toBe("local-demo");
});

test("analytics SQL tenant is derived from key and revoked keys never query AE", async () => {
  const env = { ...await setup(), CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CF_ANALYTICS_TOKEN: "secret" };
  let calls = 0;
  const fetcher = (async (_url, init) => {
    calls++;
    expect(init?.body).toContain("index1 = 'a'");
    return Response.json({ data: [] });
  }) as typeof fetch;
  expect((await accountReadRoutes(request("a", "/v1/account/usage/summary"), env, fetcher))?.status).toBe(200);
  await env.APP_DB.prepare("UPDATE app_agents SET status='revoked' WHERE id='key_a'").run();
  await expect(accountReadRoutes(request("a", "/v1/account/activity"), env, fetcher)).rejects.toThrow("revoked");
  expect(calls).toBe(1);
});
