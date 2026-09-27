import { afterEach, beforeEach, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { database } from "./support/postgres";
import { getAutumnCustomer, type AutumnEnv } from "../src/server/autumn";
import { reconcileAutumnCustomer } from "../src/server/billing-sync";
import { billingSnapshot } from "../src/server/billing";
import { Credits } from "../src/features/billing/credits";
import type { AppSnapshot } from "../src/server/contracts";

const originalFetch = globalThis.fetch;
let env: AutumnEnv;
beforeEach(async () => {
  env = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", AUTUMN_SECRET_KEY: "test-provider-key", AUTUMN_PRO_PLAN_ID: "pro", AUTUMN_TOPUP_PLAN_ID: "top_up" };
  await env.APP_DB.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at) VALUES('a','a@example.test','Test',500000,'2026-01-01','2026-01-01')").run();
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
});
afterEach(() => { globalThis.fetch = originalFetch; });

function provider(paymentMethod: unknown) {
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = JSON.parse(String(init?.body));
    if (path.endsWith("customers.get")) {
      expect(body.expand).toEqual(["payment_method"]);
      return Response.json({ id: body.customer_id, subscriptions: [], payment_method: paymentMethod });
    }
    return Response.json({ list: [] });
  }) as typeof fetch;
}

const card = { id: "pm_1", type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } };

test("the saved card summary is parsed defensively and only display fields survive", async () => {
  provider(card);
  expect((await getAutumnCustomer(env, "workspace_a")).paymentMethod)
    .toEqual({ type: "card", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 });
  provider({ id: "pm_2", type: "sepa_debit" });
  expect((await getAutumnCustomer(env, "workspace_a")).paymentMethod).toEqual({ type: "other" });
  provider(null);
  expect((await getAutumnCustomer(env, "workspace_a")).paymentMethod).toEqual({ type: "none" });
  // A hostile brand or last4 can never reach the page as text.
  provider({ type: "card", card: { brand: "<img src=x>", last4: "4242", exp_month: 1, exp_year: 2030 } });
  expect((await getAutumnCustomer(env, "workspace_a")).paymentMethod).toEqual({ type: "other" });
  provider({ type: "card", card: { brand: "visa", last4: "42424", exp_month: 1, exp_year: 2030 } });
  expect((await getAutumnCustomer(env, "workspace_a")).paymentMethod).toEqual({ type: "other" });
});

test("reconciliation caches the card on file and the billing snapshot serves it without a provider call", async () => {
  expect((await billingSnapshot("a", env)).paymentMethod).toBeNull();
  provider(card);
  await reconcileAutumnCustomer(env, "workspace_a");
  globalThis.fetch = (() => { throw new Error("The dashboard must not call the provider"); }) as typeof fetch;
  expect((await billingSnapshot("a", env)).paymentMethod)
    .toEqual({ type: "card", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 });
  provider(null);
  await reconcileAutumnCustomer(env, "workspace_a");
  expect((await billingSnapshot("a", env)).paymentMethod).toEqual({ type: "none" });
});

function credits(paymentMethod: AppSnapshot["billing"]["paymentMethod"]) {
  const snapshot = {
    account: { id: "a", name: "Test", email: "a@example.test" },
    organizations: { active: { id: "a", role: "owner" }, identity: { email: "a@example.test" } },
    credits: { balance: 500000, included: 500000, bonus: 0, resetAt: "2026-01-01" },
    billing: {
      availableCredits: 500000, paidCredits: 0, includedCredits: 500000, plan: "free",
      scheduledPlan: null, cancelAtPeriodEnd: false, complimentaryUntil: null, mode: "autumn",
      payAsYouGo: true, paymentMethod,
      autoTopUp: { enabled: false, amountCents: 1000, thresholdCents: 500, capCents: 5000, monthUsedCents: 0, lastFailure: null },
      transactions: [],
    },
  } as unknown as AppSnapshot;
  return renderToStaticMarkup(createElement(Credits, { snapshot, navigate() {} }));
}

test("the billing page shows the card on file and gates auto recharge until one exists", () => {
  const withCard = credits({ type: "card", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 });
  expect(withCard).toContain("Visa");
  expect(withCard).toContain("···· 4242");
  expect(withCard).toContain("valid until 12/2030");
  expect(withCard).not.toContain("Add payment method");
  const withoutCard = credits({ type: "none" });
  expect(withoutCard).toContain("No payment method on file");
  expect(withoutCard).toContain("Add payment method");
  expect(withoutCard).toContain("Set up");
  // Unknown state (never reconciled) neither blocks nor claims a card exists.
  const unknown = credits(null);
  expect(unknown).not.toContain("Add payment method");
  expect(unknown).toContain("Manage payments and invoices");
});
