import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  analyticsParameters,
  analyticsTimestamp,
  analyticsTotals,
  measurement,
} from "../src/features/usage/analytics-data";
import { getSnapshot } from "../src/server/accounts";
import { provisionTestAccount } from "./support/account";
import { Usage } from "../src/features/usage/usage";
import { Activity } from "../src/features/usage/activity";
import { Credits } from "../src/features/billing/credits";
import { Plans } from "../src/features/billing/plans";
import { database } from "./support/postgres";

test("missing token or spend measurements never become a reported zero", () => {
  const row = {
    retailCostUsd: 0,
    missingRetailCost: 1,
    inputTokens: 120,
    missingInputTokens: 1,
    outputTokens: 9,
  };
  expect(measurement(row, "retailCostUsd")).toBeNull();
  expect(analyticsTotals(row).inputTokens).toBeNull();
  expect(analyticsTotals(row).outputTokens).toBe(9);
  expect(measurement({ retailCostUsd: "0" }, "retailCostUsd")).toBe(0);
  expect(measurement({}, "retailCostUsd")).toBeNull();
});

test("analytics ranges use UTC, stay inside retention, and stabilize minute precision", () => {
  expect(
    analyticsParameters(90, "daily", new Date("2026-09-20T12:34:59.123Z")),
  ).toEqual({
    from: "2026-06-23T00:00:00.000Z",
    to: "2026-09-20T12:34:00.000Z",
    interval: "day",
  });
  expect(analyticsTimestamp("2026-09-20 12:00:00")).toBe(
    "2026-09-20T12:00:00Z",
  );
});

test("hosted dashboard never scans the usage ledger and renders loading rather than zero", async () => {
  const db = database();
  await provisionTestAccount(
    new Request("http://localhost/login", {
      headers: { origin: "http://localhost" },
    }),
    { APP_DB: db, APP_ACCOUNTS_ENABLED: "true" },
  );
  const queries: string[] = [];
  const snapshot = await getSnapshot("local-demo", {
    APP_DB: {
      prepare(sql) {
        queries.push(sql);
        return db.prepare(sql);
      },
      batch: db.batch,
    },
  });
  expect(queries.some((sql) => sql.includes("app_usage"))).toBe(false);
  const queryClient = new QueryClient();
  const withQueries = (component: ReturnType<typeof createElement>) =>
    createElement(QueryClientProvider, { client: queryClient }, component);
  const usage = renderToStaticMarkup(
    withQueries(createElement(Usage, { snapshot })),
  );
  expect(usage).toContain("Loading usage");
  expect(usage).toContain("Estimated analytics");
  expect(usage).not.toContain("No usage in this range");
  const activity = renderToStaticMarkup(
    withQueries(createElement(Activity, { snapshot })),
  );
  expect(activity).toContain("Loading activity");
  expect(activity).toContain("not a complete request log");
  const billing = renderToStaticMarkup(
    createElement(Credits, { snapshot, navigate() {} }),
  );
  expect(billing).toContain("Available balance");
  expect(billing).toContain("$5.00");
  expect(billing).not.toContain("progressbar");
  const plans = renderToStaticMarkup(
    createElement(Plans, {
      snapshot,
      navigate() {},
    }),
  );
  expect(plans).toContain("Simple usage prices");
  expect(plans).toContain("$0.042");
  expect(plans).toContain("+$2.00 / 1,000");
  expect(plans).not.toContain("Upgrade to Max");
  expect(plans).not.toContain("Upgrade to Scale");
});
