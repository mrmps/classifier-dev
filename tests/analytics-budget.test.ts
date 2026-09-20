import { expect, test } from "bun:test";
import { readAccountAnalytics } from "../src/server/analytics/query";

const base = { APP_ACCOUNTS_ENABLED: "true", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CF_ANALYTICS_TOKEN: "fixture" };
test("hosted analytics fails closed before provider reads without its limiter", async () => {
  let reads = 0;
  await expect(readAccountAnalytics(base, "account_a", "summary", undefined, (async () => { reads++; return Response.json({ data: [] }); }) as typeof fetch)).rejects.toMatchObject({ status: 503 });
  expect(reads).toBe(0);
});
test("tenant and global budgets both precede the provider query", async () => {
  const names: string[] = [];
  let reads = 0;
  const LIMITER = { idFromName: (name: string) => { names.push(name); return name; }, get: () => ({ fetch: async () => Response.json({ limited: names.length === 2 }) }) } as unknown as DurableObjectNamespace;
  await expect(readAccountAnalytics({ ...base, LIMITER }, "account_a", "summary", undefined, (async () => { reads++; return Response.json({ data: [] }); }) as typeof fetch)).rejects.toMatchObject({ status: 429 });
  expect(names).toEqual(["account-analytics:account_a", "account-analytics:global"]);
  expect(reads).toBe(0);
});
