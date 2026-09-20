import { describe, expect, test } from "bun:test";
import { accountAnalyticsSql, readAccountAnalytics } from "../src/server/analytics/query";
import { writeAccountAnalytics } from "../src/server/analytics/write";
import { accountAnalytics } from "../src/http/account";
import type { AccountAnalyticsEvent } from "../src/server/analytics/contracts";

const event: AccountAnalyticsEvent = { accountId: "account_a", requestId: "request1", source: "API", tier: "fast", status: "success",
  items: 3, inputTokens: 100, outputTokens: null, providerCostUsd: 0.01, retailCostUsd: 0.01, latencyMs: 200 };
const now = new Date("2026-09-20T00:00:00Z");
const env = { CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), CF_ANALYTICS_TOKEN: "private" };
describe("account analytics", () => {
  test("one bounded event, missing measurements explicit, content off by default", () => {
    const points: any[] = [];
    expect(writeAccountAnalytics({ ACCOUNT_AE: { writeDataPoint: (p) => points.push(p) } }, { ...event, content: { password: "secret" } })).toBe(true);
    expect(points).toHaveLength(1);
    expect(points[0].indexes).toEqual(["account_a"]);
    expect(points[0].blobs[8]).toBe("");
    expect(points[0].doubles[10]).toBe(1);
  });
  test("content is redacted and remains below AE byte budget", () => {
    let point: any;
    writeAccountAnalytics({ ACCOUNT_ANALYTICS_CONTENT_ENABLED: "true", ACCOUNT_AE: { writeDataPoint: (p) => { point = p; } } },
      { ...event, content: { password: "secret", text: "Bearer topsecret", huge: Array(20).fill("😀".repeat(2000)) } });
    expect(new TextEncoder().encode(point.blobs.join("")).length).toBeLessThan(16384);
    expect(JSON.stringify(point)).not.toContain("topsecret");
    expect(point.doubles[13]).toBe(1);
  });
  test("writer never breaks inference and rejects invalid tenant indexes", () => {
    expect(writeAccountAnalytics({ ACCOUNT_AE: { writeDataPoint() { throw Error("offline"); } } }, event)).toBe(false);
    expect(writeAccountAnalytics({ ACCOUNT_AE: { writeDataPoint() { throw Error("must not call"); } } }, { ...event, accountId: "a".repeat(97) })).toBe(false);
  });
  test("queries always scope tenant and weight sampled sums and means", () => {
    const sql = accountAnalyticsSql("account_a", "summary", new URLSearchParams("source=api&status=success"), now);
    expect(sql).toContain("index1 = 'account_a'");
    expect(sql).toContain("SUM(_sample_interval * double3) AS inputTokens");
    expect(sql).toContain("SUM(_sample_interval * double8) / SUM(_sample_interval)");
    expect(sql).toContain("blob5 = 'API'");
    expect(accountAnalyticsSql("account_b", "activity", new URLSearchParams(), now)).not.toContain("account_a");
  });
  test("rejects injection, unknown/duplicate filters and excessive time ranges", () => {
    for (const filter of ["key_id=x%27+OR+1%3D1", "sql=SELECT", "tier=fast&tier=smart", "from=2020-01-01", "interval=hour&from=2026-08-01"])
      expect(() => accountAnalyticsSql("account_a", "timeseries", new URLSearchParams(filter), now)).toThrow();
    expect(() => accountAnalyticsSql("x' OR 1=1", "summary", new URLSearchParams(), now)).toThrow();
  });
  test("bounded activity and charts", () => {
    expect(accountAnalyticsSql("account_a", "activity", new URLSearchParams(), now)).toContain("LIMIT 100");
    expect(accountAnalyticsSql("account_a", "timeseries", new URLSearchParams(), now)).toContain("LIMIT 745");
    expect(accountAnalyticsSql("account_a", "breakdown", new URLSearchParams("group_by=model"), now)).toContain("blob7 AS dimension");
  });
  test("upstream failure is unavailable, never fake zero usage", async () => {
    await expect(readAccountAnalytics(env, "account_a", "summary", undefined, (async () => new Response("no", { status: 500 })) as typeof fetch)).rejects.toThrow("temporarily unavailable");
    await expect(readAccountAnalytics({}, "account_a", "summary")).rejects.toThrow("not configured");
  });
  test("HTTP auth executes before fetching, payload exposes freshness and sampling", async () => {
    let authorized = false;
    const response = await accountAnalytics(new Request("https://example.com/v1/account/usage/summary"), env,
      async () => { authorized = true; return "account_a"; }, (async (_url, init) => {
        expect(authorized).toBe(true);
        expect(init?.body).toContain("index1 = 'account_a'");
        return Response.json({ data: [{ requests: 10000, sampleInterval: 10, latestEventAt: "2026-09-19 00:00:00" }] });
      }) as typeof fetch);
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect((await response?.json()).meta).toMatchObject({ sampled: true, exact: false, retentionDays: 90 });
  });
  test("unauthorized requests cannot reach Cloudflare", async () => {
    await expect(accountAnalytics(new Request("https://example.com/v1/account/activity"), env, async () => { throw Error("forbidden"); },
      (async () => { throw Error("should never fetch"); }) as typeof fetch)).rejects.toThrow("forbidden");
  });
});
