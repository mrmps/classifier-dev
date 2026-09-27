import { afterEach, beforeEach, expect, test } from "bun:test";
import { database } from "./support/postgres";
import { type AutumnEnv } from "../src/server/autumn";
import { maybeAutoTopUp, sweepAutoTopUps } from "../src/server/auto-top-up";
import { reconcileAutumnCustomer } from "../src/server/billing-sync";

const originalFetch = globalThis.fetch;
let env: AutumnEnv;
beforeEach(async () => {
  env = {
    APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", AUTUMN_SECRET_KEY: "test-provider-key",
    AUTUMN_PRO_PLAN_ID: "pro", AUTUMN_SCALE_PLAN_ID: "scale", AUTUMN_TOPUP_PLAN_ID: "top_up",
  };
  await env.APP_DB.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at,auto_top_up_enabled,auto_top_up_amount_cents,auto_top_up_threshold_cents,auto_top_up_cap_cents) VALUES('a','a@example.test','Test',100000,'2026-01-01','2026-01-01',1,1000,500,3000)").run();
  await env.APP_DB.prepare("INSERT INTO app_workspaces(account_id,kind,mode,created_at) VALUES('a','personal','hosted','2026-01-01')").run();
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
});
afterEach(() => { globalThis.fetch = originalFetch; });

/** The account starts with $1.00 (100,000 credits), threshold $5, amount $10, cap $30. */

function topUpInvoice(id: string, cents: number, refunded = 0) {
  return { customer_id: "workspace_a", entity_id: null, status: "paid", currency: "usd",
    amount_paid: cents / 100, total: cents / 100, refunded_amount: refunded / 100, stripe_id: id,
    items: [{ plan_id: "top_up", feature_id: "credits", amount: cents / 100, quantity: cents * 1000, period_start: null, period_end: null }] };
}

function provider(handlers: { attach?: (body: Record<string, unknown>) => unknown; invoices?: () => unknown; calls?: string[] }) {
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = JSON.parse(String(init?.body));
    handlers.calls?.push(path);
    if (path.endsWith("billing.attach")) return Response.json(handlers.attach ? handlers.attach(body) : { customer_id: body.customer_id });
    if (path.endsWith("customers.get")) return Response.json({ id: body.customer_id, subscriptions: [] });
    if (path.endsWith("invoices.list")) return Response.json(handlers.invoices ? handlers.invoices() : { list: [] });
    throw new Error(`Unexpected provider call: ${path}`);
  }) as typeof fetch;
}

test("a low balance charges the saved card once and credits only the verified invoice", async () => {
  const attached: Record<string, unknown>[] = [];
  provider({
    attach: (body) => {
      attached.push(body);
      return { customer_id: "workspace_a", invoice: { status: "paid", stripe_id: "topup_inv_1", total: 10, currency: "usd" } };
    },
    invoices: () => ({ list: [topUpInvoice("topup_inv_1", 1000)] }),
  });
  expect(await maybeAutoTopUp(env, "a")).toBe(true);
  expect(attached).toEqual([{
    customer_id: "workspace_a", plan_id: "top_up", redirect_mode: "never",
    feature_quantities: [{ feature_id: "credits", quantity: 1_000_000 }],
  }]);
  const account = await env.APP_DB.prepare("SELECT balance,paid_balance FROM app_accounts WHERE id='a'").first();
  expect(account).toEqual({ balance: 1_100_000, paid_balance: 1_000_000 });
  const transaction = await env.APP_DB.prepare("SELECT kind,amount_cents,credits FROM app_transactions").first();
  expect(transaction).toEqual({ kind: "auto_top_up", amount_cents: 1000, credits: 1_000_000 });
  expect((await env.APP_DB.prepare("SELECT status,invoice_id FROM app_auto_topup_attempts").first()))
    .toEqual({ status: "charged", invoice_id: "topup_inv_1" });
  // The webhook path delivering the same invoice later must not grant again.
  await reconcileAutumnCustomer(env, "workspace_a");
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(1_100_000);
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_transactions").first())?.count).toBe(1);
});

test("no charge above the threshold, when disabled, or during a billing hold", async () => {
  const calls: string[] = [];
  provider({ calls });
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=600000 WHERE id='a'").run();
  expect(await maybeAutoTopUp(env, "a")).toBe(false);
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=100000,auto_top_up_enabled=0 WHERE id='a'").run();
  expect(await maybeAutoTopUp(env, "a")).toBe(false);
  await env.APP_DB.prepare("UPDATE app_accounts SET auto_top_up_enabled=1,billing_hold=TRUE WHERE id='a'").run();
  expect(await maybeAutoTopUp(env, "a")).toBe(false);
  expect(calls).toEqual([]);
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_auto_topup_attempts").first())?.count).toBe(0);
});

test("the calendar-month cap counts pending and charged attempts and refuses the charge that would exceed it", async () => {
  const month = new Date().toISOString().slice(0, 7);
  await env.APP_DB.prepare("INSERT INTO app_auto_topup_attempts(id,account_id,month,amount_cents,status,created_at) VALUES('old1','a',?,1000,'charged','2026-01-01'),('old2','a',?,1000,'charged','2026-01-02')")
    .bind(month, month).run();
  const calls: string[] = [];
  provider({ calls, attach: (body) => ({ customer_id: body.customer_id, invoice: { status: "paid", stripe_id: "topup_inv_2", total: 10, currency: "usd" } }),
    invoices: () => ({ list: [topUpInvoice("topup_inv_2", 1000)] }) });
  // $20 of $30 used: one more $10 charge fits exactly.
  expect(await maybeAutoTopUp(env, "a")).toBe(true);
  // $30 of $30 used: the next attempt must not be claimed, even at low balance.
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=0 WHERE id='a'").run();
  expect(await maybeAutoTopUp(env, "a")).toBe(false);
  expect(calls.filter((path) => path.endsWith("billing.attach")).length).toBe(1);
  // A failed attempt never consumes the budget of a month it did not charge.
  const failed = await env.APP_DB.prepare("SELECT COALESCE(SUM(amount_cents),0) AS used FROM app_auto_topup_attempts WHERE month=? AND status IN ('pending','charged')").bind(month).first();
  expect(failed?.used).toBe(3000);
});

test("a pending claim is single-flight and a declined card cools down for an hour", async () => {
  provider({ attach: (body) => ({ customer_id: body.customer_id,
    invoice: { status: "open", stripe_id: "topup_open_1", total: 10, currency: "usd" },
    required_action: { code: "payment_method_required", reason: "No payment method found" } }) });
  expect(await maybeAutoTopUp(env, "a")).toBe(false);
  expect(await env.APP_DB.prepare("SELECT status,reason FROM app_auto_topup_attempts").first())
    .toEqual({ status: "failed", reason: "payment_method_required" });
  // The failure cooldown blocks an immediate retry.
  expect(await maybeAutoTopUp(env, "a")).toBe(false);
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_auto_topup_attempts").first())?.count).toBe(1);
  // An in-flight pending claim blocks a second concurrent charge.
  await env.APP_DB.prepare("UPDATE app_auto_topup_attempts SET status='pending',created_at=?").bind(new Date().toISOString()).run();
  expect(await maybeAutoTopUp(env, "a")).toBe(false);
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_auto_topup_attempts").first())?.count).toBe(1);
});

test("a provider timeout keeps the claim pending and reconciliation still credits a real invoice exactly once", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
  expect(await maybeAutoTopUp(env, "a")).toBe(false);
  const attempt = await env.APP_DB.prepare("SELECT id,status,reason FROM app_auto_topup_attempts").first<{ id: string; status: string; reason: string }>();
  expect(attempt?.status).toBe("pending");
  expect(attempt?.reason).toBe("provider_unavailable");
  // The charge actually went through: the invoice exists when reconciliation runs.
  await env.APP_DB.prepare("UPDATE app_auto_topup_attempts SET invoice_id='topup_inv_3'").run();
  provider({ invoices: () => ({ list: [topUpInvoice("topup_inv_3", 1000)] }) });
  await reconcileAutumnCustomer(env, "workspace_a");
  expect((await env.APP_DB.prepare("SELECT balance,paid_balance FROM app_accounts WHERE id='a'").first()))
    .toEqual({ balance: 1_100_000, paid_balance: 1_000_000 });
  expect((await env.APP_DB.prepare("SELECT status FROM app_auto_topup_attempts").first())?.status).toBe("charged");
  expect((await env.APP_DB.prepare("SELECT kind FROM app_transactions").first())?.kind).toBe("auto_top_up");
});

test("a manual top-up invoice credits purchased funds once and a refund removes them once", async () => {
  const state = { refunded: 0 };
  provider({ invoices: () => ({ list: [topUpInvoice("manual_inv_1", 2500, state.refunded)] }) });
  await reconcileAutumnCustomer(env, "workspace_a");
  await reconcileAutumnCustomer(env, "workspace_a");
  expect(await env.APP_DB.prepare("SELECT balance,paid_balance FROM app_accounts WHERE id='a'").first())
    .toEqual({ balance: 2_600_000, paid_balance: 2_500_000 });
  expect((await env.APP_DB.prepare("SELECT kind,plan_id FROM app_transactions").first())).toEqual({ kind: "top_up", plan_id: null });
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=balance-600000 WHERE id='a'").run();
  state.refunded = 2500;
  await reconcileAutumnCustomer(env, "workspace_a");
  await reconcileAutumnCustomer(env, "workspace_a");
  // Already consumed usage is not reverse-charged; the balance may go negative.
  expect(await env.APP_DB.prepare("SELECT balance,paid_balance FROM app_accounts WHERE id='a'").first())
    .toEqual({ balance: -500_000, paid_balance: 0 });
  expect((await env.APP_DB.prepare("SELECT revoked_at FROM app_autumn_topups WHERE invoice_id='manual_inv_1'").first())?.revoked_at).not.toBeNull();
});

test("a malformed top-up invoice stays retryable instead of granting", async () => {
  const invoice = topUpInvoice("bad_inv_1", 1000);
  invoice.items[0].quantity = 999_999;
  provider({ invoices: () => ({ list: [invoice] }) });
  await expect(reconcileAutumnCustomer(env, "workspace_a")).rejects.toThrow("manual reconciliation");
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(100000);
  expect((await env.APP_DB.prepare("SELECT reconciliation_required FROM app_autumn_customers WHERE account_id='a'").first())?.reconciliation_required).toBe(true);
});

test("the scheduled sweep charges only enabled accounts below their threshold", async () => {
  await env.APP_DB.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at,auto_top_up_enabled) VALUES('b','b@example.test','Rich',90000000,'2026-01-01','2026-01-01',1)").run();
  await env.APP_DB.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at) VALUES('c','c@example.test','Off',0,'2026-01-01','2026-01-01')").run();
  const attached: Record<string, unknown>[] = [];
  provider({ attach: (body) => { attached.push(body); return { customer_id: body.customer_id,
      invoice: { status: "paid", stripe_id: "sweep_inv_1", total: 10, currency: "usd" } }; },
    invoices: () => ({ list: [topUpInvoice("sweep_inv_1", 1000)] }) });
  expect((await sweepAutoTopUps(env)).attempted).toBe(1);
  expect(attached.length).toBe(1);
  expect((await env.APP_DB.prepare("SELECT account_id FROM app_auto_topup_attempts").first())?.account_id).toBe("a");
});

test("nothing is charged when pay-as-you-go is not configured", async () => {
  const calls: string[] = [];
  provider({ calls });
  expect(await maybeAutoTopUp({ ...env, AUTUMN_TOPUP_PLAN_ID: undefined }, "a")).toBe(false);
  expect((await sweepAutoTopUps({ ...env, AUTUMN_TOPUP_PLAN_ID: undefined })).attempted).toBe(0);
  expect(calls).toEqual([]);
});
