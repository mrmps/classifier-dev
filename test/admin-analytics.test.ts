import { expect, test } from "bun:test";
import { timeline, change, timestamp } from "../src/features/admin/analytics";
import { adminFixture } from "./admin-fixture";
import { dashboard } from "../src/admin";

test("sparse series use equal UTC intervals, zero traffic, and missing latency", () => {
  const d = adminFixture();
  d.series = [d.series[0]];
  d.performance = [d.performance[0]];
  const points = timeline(d, "24h");
  expect(points).toHaveLength(25);
  expect(points[0].requests).toBe(900);
  expect(points[1].requests).toBe(0);
  expect(points[1].latency).toBeNull();
  expect(points[1].cost).toBeNull();
  expect(timestamp(points[1].time) - timestamp(points[0].time)).toBe(3600000);
});
test("server error rate excludes rejections and has no value with no accepted traffic", () => {
  const d = adminFixture(),
    t = d.series[0].t;
  d.outcomes = [
    { t, status: "200", requests: 9 },
    { t, status: "502", requests: 3 },
    { t, status: "429", requests: 100000 },
  ];
  const points = timeline(d, "24h");
  expect(points[0].errorRate).toBe(25);
  expect(points[0].rejected).toBe(100000);
  expect(points[1].errorRate).toBeNull();
});
test("comparisons do not invent infinity or growth without a baseline", () => {
  expect(change(10, 0)).toBe("No prior traffic");
  expect(change(0, 0)).toBe("No change");
  expect(change(12, 8)).toBe("+50.0% vs previous period");
  expect(change(0, 10)).toBe("-100.0% vs previous period");
});
test("all ranges include partial boundary buckets without compressing idle time", () => {
  expect(timeline(adminFixture(), "7d")).toHaveLength(29);
  expect(timeline(adminFixture(), "30d")).toHaveLength(31);
  expect(timestamp("2026-09-20 20:00:00")).toBe(
    timestamp("2026-09-20T20:00:00Z"),
  );
});
test("bootstrap escapes telemetry before putting it into an HTML attribute", () => {
  const d = adminFixture();
  d.byAgent = [{ agent: '"><script>alert(1)</script>', requests: 1 }];
  const html = dashboard("24h", d, "nonce");
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html.match(/<script/g)).toHaveLength(1);
  expect(html).toContain('data-admin="{&quot;range&quot;');
});

import { Database } from "bun:sqlite";
import { adminResponse } from "../src/admin";
import type { Env } from "../src/index";

test("analytics queries separate current and previous windows and exclude quota latency", async () => {
  const realFetch = globalThis.fetch;
  const db = new Database(":memory:");
  const now = 2000000000;
  db.exec(`CREATE TABLE classifier_events (timestamp INTEGER, _sample_interval REAL,
    index1 TEXT DEFAULT 'caller', ${Array.from({ length: 20 }, (_, i) => `blob${i + 1} TEXT DEFAULT ''`).join(",")},
    ${Array.from({ length: 20 }, (_, i) => `double${i + 1} REAL DEFAULT 0`).join(",")})`);
  db.exec("CREATE TABLE classifier_chat_events AS SELECT * FROM classifier_events WHERE 0");
  db.exec(`INSERT INTO classifier_events(timestamp,_sample_interval,blob4,double1,double2,double3) VALUES
    (${now - 3600},9,'200',6,100,.01), (${now - 3600},3,'502',0,500,0),
    (${now - 3600},100000,'429',0,1,0), (${now - 30 * 3600},2,'200',4,200,.02),
    (${now - 55 * 3600},999,'200',1,100,.01)`);
  globalThis.fetch = (async (_url, init) => {
    const query = String(init?.body)
      .replace(
        /toStartOfInterval\(timestamp, INTERVAL '(\d+)' (HOUR|DAY)\)/g,
        (_, v, unit) =>
          `CAST(timestamp / ${Number(v) * (unit === "DAY" ? 86400 : 3600)} AS INTEGER)*${Number(v) * (unit === "DAY" ? 86400 : 3600)}`,
      )
      .replace(/toDateTime\(now\(\)\) - INTERVAL '(\d+)' HOUR/g, (_, v) =>
        String(now - Number(v) * 3600),
      );
    return Response.json({ data: db.query(query).all() });
  }) as typeof fetch;
  try {
    const env = {
      ADMIN_PASSWORD: "test",
      ADMIN_SIGNING_KEY: "test-key",
    } as Env;
    const login = (await adminResponse(
      new Request("https://classifier.dev/admin", {
        method: "POST",
        headers: { origin: "https://classifier.dev" },
        body: new URLSearchParams({ password: "test" }),
      }),
      env,
      "admin",
      "test",
    ))!;
    const cookie = login.headers.getSetCookie()[0].split(";")[0];
    const res = (await adminResponse(
      new Request("https://classifier.dev/admin", { headers: { cookie } }),
      env,
      "admin",
      "test",
    ))!;
    const html = await res.text();
    const escaped = html.match(/data-admin="([^"]+)"/)![1];
    const { data } = JSON.parse(
      escaped
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&"),
    );
    expect(data.unavailable).toEqual([]);
    expect(data.totals[0].requests).toBe(100012);
    expect(data.previous[0].requests).toBe(2);
    expect(data.previous[0].classifications).toBe(8);
    expect(data.performance[0].avg_ms).toBe(200);
    expect(data.performance[0].batch_size).toBe(4.5);
    expect(
      data.outcomes.find((r: { status: string }) => r.status === "429")
        .requests,
    ).toBe(100000);
  } finally {
    globalThis.fetch = realFetch;
    db.close();
  }
});
