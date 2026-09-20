import { afterEach, beforeEach, expect, test } from "bun:test";
import { Webhook } from "svix";
import { database } from "./support/postgres";
import { hashToken } from "../src/server/db";
import { authorizeAndReserve, completeReservation } from "../src/server/usage";
import { billingReturnUrl, createAutumnCheckout, createAutumnPortal, type AutumnEnv } from "../src/server/autumn";
import { autumnWebhook } from "../src/http/autumn-webhook";
import { reconcileAutumnCustomer, syncAutumnAccounts } from "../src/server/billing-sync";

const originalFetch = globalThis.fetch;
let env: AutumnEnv;
const secret = `whsec_${btoa("01234567890123456789012345678901")}`;
beforeEach(async () => {
  env = { APP_DB: database(), AUTUMN_SECRET_KEY: "test-provider-key", AUTUMN_WEBHOOK_SECRET: secret, AUTUMN_PRO_PLAN_ID: "pro" };
  await env.APP_DB.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at) VALUES('a','a@example.test','Test',500000,'2026-01-01','2026-01-01')").run();
  await env.APP_DB.prepare("INSERT INTO app_workspaces(account_id,kind,mode,created_at) VALUES('a','personal','hosted','2026-01-01')").run();
});
afterEach(() => { globalThis.fetch = originalFetch; });
function provider(fn: (path: string, body: Record<string, unknown>) => unknown) {
  globalThis.fetch = (async (input, init) => {
    expect(new Headers(init?.headers).get("x-api-version")).toBe("2.4.0");
    return Response.json(fn(new URL(String(input)).pathname, JSON.parse(String(init?.body))));
  }) as typeof fetch;
}
function signed(id: string, customerId = "workspace_a", when = new Date()) {
  const body = JSON.stringify({ type: "billing.updated", data: { customer_id: customerId, plan_changes: [{ subscription: { status: "active" } }] } });
  return new Request("https://classifier.dev/webhooks/autumn", { method: "POST", body, headers: {
    "svix-id": id, "svix-timestamp": String(Math.floor(when.getTime() / 1000)),
    "svix-signature": new Webhook(secret).sign(id, when, body),
  } });
}
test("checkout uses stable workspace identity and enables nothing before payment", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  provider((path, body) => {
    expect(body.customer_id).toBe("workspace_a");
    if (path.endsWith("get_or_create")) return { id: body.customer_id };
    if (path.endsWith("customers.get")) return { id: body.customer_id, subscriptions: [] };
    expect(body.enable_plan_immediately).toBe(false);
    expect(body.plan_id).toBe("pro");
    return { customer_id: body.customer_id, payment_url: "https://checkout.stripe.com/example" };
  });
  expect((await createAutumnCheckout(env, "a", "https://classifier.dev/app/plans")).url).toContain("checkout.stripe.com");
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(500000);
});
test("portal rejects hostile redirects", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  provider((path, body) => path.endsWith("get_or_create") ? { id: body.customer_id } : { customer_id: body.customer_id, url: "https://stripe.com.evil.test/" });
  await expect(createAutumnPortal(env, "a", "https://classifier.dev/app/plans")).rejects.toThrow();
});
test("webhooks verify signatures and expiry before querying the provider", async () => {
  globalThis.fetch = (() => { throw new Error("Must not fetch"); }) as typeof fetch;
  expect((await autumnWebhook(new Request("https://classifier.dev/webhooks/autumn", { method: "POST", body: "{}" }), env)).status).toBe(400);
  expect((await autumnWebhook(signed("stale", "workspace_a", new Date(0)), env)).status).toBe(400);
});
test("canonical state wins over webhook payload; duplicate events do not refetch or grant money", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  let calls = 0;
  provider(() => { calls++; return { id: "workspace_a", subscriptions: [] }; });
  expect((await autumnWebhook(signed("event1"), env)).status).toBe(204);
  expect((await autumnWebhook(signed("event1"), env)).status).toBe(204);
  expect(calls).toBe(1);
  const state = await env.APP_DB.prepare("SELECT snapshot,reconciliation_required FROM app_autumn_customers WHERE account_id='a'").first();
  expect(state?.snapshot).toEqual({ id: "workspace_a", subscriptions: [] });
  expect(state?.reconciliation_required).toBe(false);
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(500000);
});
test("provider failure remains retryable; unmapped customers cannot affect wallets", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  globalThis.fetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
  expect((await autumnWebhook(signed("retry"), env)).status).toBe(503);
  expect((await env.APP_DB.prepare("SELECT processed_at FROM app_autumn_events WHERE id='retry'").first())?.processed_at).toBeNull();
  provider(() => ({ id: "workspace_a", subscriptions: [] }));
  expect((await autumnWebhook(signed("retry"), env)).status).toBe(204);
  expect((await autumnWebhook(signed("unknown", "other_customer"), env)).status).toBe(204);
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(500000);
});

test("paid period grants exactly once across distinct events; unpaid and refunded invoices never grant", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  const start = Date.now() - 60_000, end = Date.now() + 86400_000;
  let paid = false, refunded = 0;
  provider((path) => path.endsWith("customers.get") ? { id: "workspace_a", subscriptions: [{
    id: "sub_1", plan_id: "pro", status: "active", past_due: false, current_period_start: start, current_period_end: end,
  }] } : { list: [{ customer_id: "workspace_a", entity_id: null, status: paid ? "paid" : "open", currency: "usd", amount_paid: 20, total: 20,
    refunded_amount: refunded, stripe_id: "invoice_1", items: [{ plan_id: "pro", feature_id: null, amount: 20, period_start: start, period_end: end }],
  }], next_cursor: null });
  await expect(reconcileAutumnCustomer(env, "workspace_a")).rejects.toThrow("paid invoice");
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(500000);
  paid = true; refunded = 20;
  await expect(reconcileAutumnCustomer(env, "workspace_a")).rejects.toThrow("paid invoice");
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(500000);
  refunded = 0;
  await env.APP_DB.prepare("INSERT INTO app_agents(id,account_id,name,client,token_hash,prefix,created_at) VALUES('key','a','test','test','hash','prefix','2026-01-01')").run();
  await env.APP_DB.prepare("INSERT INTO app_usage(id,account_id,agent_id,items,credits,status,created_at) VALUES('pending','a','key',1,1,'pending','2026-01-01')").run();
  expect((await autumnWebhook(signed("paid-event"), env)).status).toBe(503);
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(500000);
  await env.APP_DB.prepare("UPDATE app_usage SET status='success' WHERE id='pending'").run();
  expect((await autumnWebhook(signed("paid-event"), env)).status).toBe(204);
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=balance-42 WHERE id='a'").run();
  expect((await autumnWebhook(signed("different-paid-event"), env)).status).toBe(204);
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(1999958);
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_transactions").first())?.count).toBe(1);
  refunded = 20;
  await reconcileAutumnCustomer(env, "workspace_a");
  expect(await env.APP_DB.prepare("SELECT balance,billing_hold FROM app_accounts WHERE id='a'").first()).toEqual({ balance: 0, billing_hold: true });
  refunded = 0;
  await reconcileAutumnCustomer(env, "workspace_a");
  expect((await env.APP_DB.prepare("SELECT billing_hold FROM app_accounts WHERE id='a'").first())?.billing_hold).toBe(true);
});

test("billing return origin is server-configured and rejects unsafe origins", () => {
  expect(billingReturnUrl(env)).toBe("https://classifier.dev/app/plans");
  expect(billingReturnUrl({ ...env, APP_ORIGIN: "https://preview.example.test" })).toBe("https://preview.example.test/app/plans");
  for (const APP_ORIGIN of ["http://example.test", "https://user@example.test", "https://example.test/path", "https://example.test/?next=evil"]) {
    expect(() => billingReturnUrl({ ...env, APP_ORIGIN })).toThrow();
  }
});

test("canceling and resuming an existing paid period updates its schedule without refilling credits", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  const start = Date.now() - 60_000, end = Date.now() + 86400_000;
  let canceledAt: number | null = null;
  provider((path) => path.endsWith("customers.get") ? { id: "workspace_a", subscriptions: [{
    id: "sub_1", plan_id: "pro", status: "active", past_due: false, canceled_at: canceledAt,
    current_period_start: start, current_period_end: end,
  }] } : { list: [{ customer_id: "workspace_a", entity_id: null, status: "paid", currency: "usd", amount_paid: 20, total: 20,
    refunded_amount: 0, stripe_id: "invoice_1", items: [{ plan_id: "pro", feature_id: null, amount: 20, period_start: start, period_end: end }],
  }] });
  await reconcileAutumnCustomer(env, "workspace_a");
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=balance-42 WHERE id='a'").run();
  canceledAt = Date.now();
  await reconcileAutumnCustomer(env, "workspace_a");
  expect(await env.APP_DB.prepare("SELECT billing_plan,balance,cancel_at_period_end,scheduled_plan FROM app_accounts WHERE id='a'").first())
    .toEqual({ billing_plan: "pro", balance: 1999958, cancel_at_period_end: 1, scheduled_plan: "free" });
  canceledAt = null;
  await reconcileAutumnCustomer(env, "workspace_a");
  expect(await env.APP_DB.prepare("SELECT balance,cancel_at_period_end,scheduled_plan FROM app_accounts WHERE id='a'").first())
    .toEqual({ balance: 1999958, cancel_at_period_end: 0, scheduled_plan: null });
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_autumn_grants").first())?.count).toBe(1);
});

test.each(["current_period_start", "current_period_end"])("a missing %s stays retryable instead of completing identity reconciliation", async (missing) => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  provider(() => ({ id: "workspace_a", subscriptions: [{
    id: "sub_1", plan_id: "pro", status: "active", past_due: false,
    current_period_start: Date.now() - 60_000, current_period_end: Date.now() + 86400_000, [missing]: null,
  }] }));
  await expect(reconcileAutumnCustomer(env, "workspace_a")).rejects.toThrow("billing period");
});

test("cancellation removes only expired plan allowance, never signup or purchased funds", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  provider(() => ({ id: "workspace_a", subscriptions: [] }));
  await reconcileAutumnCustomer(env, "workspace_a");
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(500000);
  await env.APP_DB.prepare("UPDATE app_accounts SET billing_plan='pro',balance=1000000,paid_balance=123 WHERE id='a'").run();
  await reconcileAutumnCustomer(env, "workspace_a");
  expect(await env.APP_DB.prepare("SELECT balance,billing_plan FROM app_accounts WHERE id='a'").first()).toEqual({ balance: 123, billing_plan: "free" });
});

test("scheduled reconciliation respects a global daily provider call budget", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  const day = new Date().toISOString().slice(0,10);
  await env.APP_DB.prepare("INSERT INTO app_autumn_sync_budget(day,calls) VALUES(?,58)").bind(day).run();
  let calls = 0;
  provider(() => { calls++; return { id: "workspace_a", subscriptions: [] }; });
  expect((await syncAutumnAccounts(env)).synced).toBe(1);
  expect((await syncAutumnAccounts(env)).synced).toBe(0);
  expect(calls).toBe(1);
  expect((await env.APP_DB.prepare("SELECT calls FROM app_autumn_sync_budget WHERE day=?").bind(day).first())?.calls).toBe(60);
});

function paidProvider(state: { pastDue?: boolean; refunded?: number }, start: number, end: number) {
  provider((path) => path.endsWith("customers.get") ? { id: "workspace_a", subscriptions: [{
    id: "sub_1", plan_id: "pro", status: "active", past_due: state.pastDue ?? false,
    current_period_start: start, current_period_end: end,
  }] } : { list: [{ customer_id: "workspace_a", entity_id: null, status: "paid", currency: "usd", amount_paid: 20, total: 20,
    refunded_amount: state.refunded ?? 0, stripe_id: "invoice_1", items: [{ plan_id: "pro", feature_id: null, amount: 20, period_start: start, period_end: end }],
  }] });
}

test("overdue payment flags cannot erase an allowance backed by the current paid invoice", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  const state = { pastDue: false };
  paidProvider(state, Date.now() - 60_000, Date.now() + 86400_000);
  await reconcileAutumnCustomer(env, "workspace_a");
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=balance-42 WHERE id='a'").run();
  state.pastDue = true;
  await reconcileAutumnCustomer(env, "workspace_a");
  expect(await env.APP_DB.prepare("SELECT balance,billing_plan FROM app_accounts WHERE id='a'").first())
    .toEqual({ balance: 1999958, billing_plan: "pro" });
  state.pastDue = false;
  await reconcileAutumnCustomer(env, "workspace_a");
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(1999958);
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_transactions").first())?.count).toBe(1);
});

test("refund webhooks retry until pending reservations settle and included funds are removed", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  const state = { refunded: 0 };
  paidProvider(state, Date.now() - 60_000, Date.now() + 86400_000);
  await reconcileAutumnCustomer(env, "workspace_a");
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=balance+123,paid_balance=123 WHERE id='a'").run();
  await env.APP_DB.prepare("INSERT INTO app_agents(id,account_id,name,client,token_hash,prefix,created_at) VALUES('key','a','test','test','hash','prefix','2026-01-01')").run();
  const token = "classifier_agent_refund_test";
  await env.APP_DB.prepare("UPDATE app_agents SET token_hash=? WHERE id='key'").bind(await hashToken(token)).run();
  const reservation = await authorizeAndReserve(new Request("https://classifier.dev/v1/classify", {
    headers: { Authorization: `Bearer ${token}` },
  }), { ...env, APP_ACCOUNTS_ENABLED: "true" }, 1);
  state.refunded = 20;
  expect((await autumnWebhook(signed("refund-pending"), env)).status).toBe(503);
  expect((await env.APP_DB.prepare("SELECT billing_hold FROM app_accounts WHERE id='a'").first())?.billing_hold).toBe(true);
  expect((await env.APP_DB.prepare("SELECT processed_at FROM app_autumn_events WHERE id='refund-pending'").first())?.processed_at).toBeNull();
  await completeReservation(reservation!, env, false);
  expect((await autumnWebhook(signed("refund-pending"), env)).status).toBe(204);
  expect(await env.APP_DB.prepare("SELECT balance,paid_balance,billing_hold FROM app_accounts WHERE id='a'").first())
    .toEqual({ balance: 123, paid_balance: 123, billing_hold: true });
  expect((await env.APP_DB.prepare("SELECT reconciliation_required FROM app_autumn_customers WHERE account_id='a'").first())?.reconciliation_required).toBe(false);
});

test("failing customers rotate out of the repair queue so other payments can reconcile", async () => {
  for (let i = 0; i < 11; i++) {
    await env.APP_DB.prepare("INSERT INTO app_accounts(id,email,name,balance,reset_at,created_at) VALUES(?,?,'Test',0,'2026-01-01','2026-01-01')")
      .bind(`queue_${i}`, `queue_${i}@example.test`).run();
    await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES(?,?)").bind(`queue_${i}`, `customer_${i}`).run();
    await env.APP_DB.prepare("UPDATE app_autumn_customers SET synced_at=? WHERE account_id=?")
      .bind(new Date(2026, 0, i + 1).toISOString(), `queue_${i}`).run();
  }
  const attempted = new Set<string>();
  globalThis.fetch = (async (_input, init) => {
    attempted.add(JSON.parse(String(init?.body)).customer_id);
    return new Response(null, { status: 503 });
  }) as typeof fetch;
  expect((await syncAutumnAccounts(env)).failed).toBe(10);
  expect((await syncAutumnAccounts(env)).failed).toBe(10);
  expect(attempted.size).toBe(11);
});

test("an overdue subscription without a paid invoice cannot grant credits", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  provider((path) => path.endsWith("customers.get") ? { id: "workspace_a", subscriptions: [{
    id: "sub", plan_id: "pro", status: "active", past_due: true,
    current_period_start: Date.now() - 60_000, current_period_end: Date.now() + 86400_000,
  }] } : { list: [] });
  await expect(reconcileAutumnCustomer(env, "workspace_a")).rejects.toThrow("paid invoice");
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(500000);
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_transactions").first())?.count).toBe(0);
});

test("a stale refund cannot mutate a held wallet after a newer sync starts", async () => {
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES('a','workspace_a')").run();
  const state = { refunded: 0 };
  paidProvider(state, Date.now() - 60_000, Date.now() + 86400_000);
  await reconcileAutumnCustomer(env, "workspace_a");
  await env.APP_DB.prepare("UPDATE app_accounts SET billing_hold=TRUE WHERE id='a'").run();
  state.refunded = 20;
  const fetchPaid = globalThis.fetch;
  let release!: () => void, arrived!: () => void;
  const waiting = new Promise<void>((resolve) => { arrived = resolve; });
  const paused = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith("invoices.list")) { arrived(); await paused; }
    return fetchPaid(input, init);
  }) as typeof fetch;
  const stale = reconcileAutumnCustomer(env, "workspace_a").catch((error: Error) => error);
  await waiting;
  globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
  await expect(reconcileAutumnCustomer(env, "workspace_a")).rejects.toThrow();
  release();
  expect(await stale).toBeInstanceOf(Error);
  expect(String(await stale)).toContain("newer sync");
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id='a'").first())?.balance).toBe(2000000);
  expect((await env.APP_DB.prepare("SELECT revoked_at FROM app_autumn_grants WHERE invoice_id='invoice_1'").first())?.revoked_at).toBeNull();
  expect((await env.APP_DB.prepare("SELECT reconciliation_required FROM app_autumn_customers WHERE account_id='a'").first())?.reconciliation_required).toBe(true);
});
