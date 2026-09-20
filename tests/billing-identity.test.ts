import { afterEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { database } from "./support/postgres";
import { billingCustomerId } from "../src/billing-identity";
import { provisionHostedAccount } from "../src/server/auth";
import { linkPersonalBilling } from "../src/server/billing-identity";
import { createAutumnCheckout, type AutumnEnv } from "../src/server/autumn";
import { resolveWorkspace } from "../src/server/organizations";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const user = { id: "existing", email: "existing@example.test", emailVerified: true };
const signingKey = "existing-production-identity-key";
const customerId = createHmac("sha256", signingKey).update(user.email).digest("hex");
const periodStart = Date.now() - 60_000, periodEnd = Date.now() + 86_400_000;
const subscription = { id: "existing-sub", plan_id: "pro", status: "active", past_due: false, current_period_start: periodStart, current_period_end: periodEnd };
const invoice = { customer_id: customerId, entity_id: null, status: "paid", currency: "usd", amount_paid: 20, total: 20, refunded_amount: 0,
  stripe_id: "existing-invoice", items: [{ plan_id: "pro", feature_id: null, amount: 20, period_start: periodStart, period_end: periodEnd }] };

async function fixture() {
  const env: AutumnEnv = { APP_DB: database(), APP_ACCOUNTS_ENABLED: "true", BILLING_SIGNING_KEY: signingKey, AUTUMN_SECRET_KEY: "fixture", AUTUMN_PRO_PLAN_ID: "pro" };
  const id = await provisionHostedAccount(user, env);
  await resolveWorkspace(id, undefined, env);
  return { env, id };
}
function provider(paid: boolean) {
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname, body = JSON.parse(String(init?.body));
    calls.push(path);
    expect(body.customer_id).toBe(customerId);
    if (path.endsWith("customers.get_or_create") || path.endsWith("customers.get"))
      return Response.json({ id: customerId, subscriptions: paid ? [subscription] : [] });
    if (path.endsWith("invoices.list")) return Response.json({ list: [invoice], next_cursor: null });
    if (path.endsWith("billing.open_customer_portal")) return Response.json({ customer_id: customerId, url: "https://billing.stripe.com/existing-subscription" });
    if (path.endsWith("billing.attach")) return Response.json({ customer_id: customerId, payment_url: "https://checkout.stripe.com/new-subscription" });
    throw new Error(`Unexpected provider call: ${path}`);
  }) as typeof fetch;
  return calls;
}

test("the shared identity exactly preserves legacy HMAC and normalizes the verified email", async () => {
  expect(await billingCustomerId(" Existing@Example.Test ", signingKey)).toBe(customerId);
});

test("an existing subscriber recovers Pro and the paid period once, then checkout opens the existing portal", async () => {
  const { env, id } = await fixture();
  const calls = provider(true);
  await linkPersonalBilling(user, env);
  expect(await env.APP_DB.prepare("SELECT billing_plan,balance FROM app_accounts WHERE id=?").bind(id).first())
    .toEqual({ billing_plan: "pro", balance: 2000000 });
  expect((await env.APP_DB.prepare("SELECT customer_id FROM app_autumn_customers WHERE account_id=?").bind(id).first())?.customer_id).toBe(customerId);
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=balance-42 WHERE id=?").bind(id).run();
  const previousCalls = calls.length;
  await linkPersonalBilling(user, env);
  expect(calls.length).toBe(previousCalls);
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id=?").bind(id).first())?.balance).toBe(1999958);
  expect(await createAutumnCheckout(env, id, "https://classifier.dev/app/plans")).toEqual({ url: "https://billing.stripe.com/existing-subscription" });
  expect(calls.some((path) => path.endsWith("billing.attach"))).toBe(false);
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_autumn_grants").first())?.count).toBe(1);
});

test("a signed-in non-paying customer keeps the same billing identity and receives the free allowance once", async () => {
  const { env, id } = await fixture();
  provider(false);
  await Promise.all(Array.from({ length: 3 }, () => linkPersonalBilling(user, env)));
  await env.APP_DB.prepare("UPDATE app_accounts SET balance=balance-42 WHERE id=?").bind(id).run();
  await provisionHostedAccount(user, env);
  await linkPersonalBilling(user, env);
  expect(await env.APP_DB.prepare("SELECT billing_plan,balance FROM app_accounts WHERE id=?").bind(id).first()).toEqual({ billing_plan: "free", balance: 499958 });
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_autumn_customers").first())?.count).toBe(1);
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_autumn_grants").first())?.count).toBe(0);
  expect((await createAutumnCheckout(env, id, "https://classifier.dev/app/plans")).url).toContain("checkout.stripe.com");
});

test("unverified email cannot claim a customer or reach the provider", async () => {
  const { env } = await fixture();
  globalThis.fetch = (() => { throw new Error("Must not fetch"); }) as typeof fetch;
  await expect(linkPersonalBilling({ ...user, emailVerified: false }, env)).rejects.toThrow("Verify your email");
  expect((await env.APP_DB.prepare("SELECT COUNT(*) AS count FROM app_autumn_customers").first())?.count).toBe(0);
});

test("a second identity cannot claim the same customer", async () => {
  const { env, id } = await fixture();
  provider(true);
  await linkPersonalBilling(user, env);
  const other = { ...user, id: "other" };
  await provisionHostedAccount(other, env);
  await expect(linkPersonalBilling(other, env)).rejects.toThrow("already linked");
  expect((await env.APP_DB.prepare("SELECT account_id FROM app_autumn_customers WHERE customer_id=?").bind(customerId).first())?.account_id).toBe(id);
});

test("provider failure leaves a retryable claim and never enables a separate checkout", async () => {
  const { env, id } = await fixture();
  globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
  await expect(linkPersonalBilling(user, env)).rejects.toThrow("unavailable");
  await expect(createAutumnCheckout(env, id, "https://classifier.dev/app/plans")).rejects.toThrow("unavailable");
  provider(true);
  await linkPersonalBilling(user, env);
  expect((await env.APP_DB.prepare("SELECT billing_plan FROM app_accounts WHERE id=?").bind(id).first())?.billing_plan).toBe("pro");
});

test("an unlinked dashboard account cannot invent a new billing customer", async () => {
  const { env, id } = await fixture();
  const calls = provider(true);
  await expect(createAutumnCheckout(env, id, "https://classifier.dev/app/plans")).rejects.toThrow("Sign in again");
  expect(calls).toEqual([]);
});

test("linked users can sign in during a later provider outage without changing their customer", async () => {
  const { env, id } = await fixture();
  provider(true);
  await linkPersonalBilling(user, env);
  await env.APP_DB.prepare("UPDATE app_autumn_customers SET reconciliation_required=TRUE WHERE account_id=?").bind(id).run();
  globalThis.fetch = (() => { throw new Error("Must not fetch"); }) as typeof fetch;
  await linkPersonalBilling({ ...user, email: "changed@example.test" }, env);
  expect((await env.APP_DB.prepare("SELECT customer_id FROM app_autumn_customers WHERE account_id=?").bind(id).first())?.customer_id).toBe(customerId);
});

test("a pre-existing unrelated workspace mapping cannot hide an old subscription", async () => {
  const { env, id } = await fixture();
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES(?,?)").bind(id, `workspace_${id}`).run();
  globalThis.fetch = (() => { throw new Error("Must not fetch"); }) as typeof fetch;
  await expect(linkPersonalBilling(user, env)).rejects.toThrow("need reconciliation");
});

test.each(["active", "scheduled", "past_due"])("%s Pro subscriptions go to the existing portal", async (status) => {
  const { env, id } = await fixture();
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES(?,?)").bind(id, customerId).run();
  globalThis.fetch = (async (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("customers.get_or_create")) return Response.json({ id: customerId });
    if (path.endsWith("customers.get")) return Response.json({ id: customerId, subscriptions: [{ ...subscription, status }] });
    expect(path).toEndWith("billing.open_customer_portal");
    return Response.json({ customer_id: customerId, url: "https://billing.stripe.com/existing-subscription" });
  }) as typeof fetch;
  expect((await createAutumnCheckout(env, id, "https://classifier.dev/app/plans")).url).toContain("billing.stripe.com");
});

test.each(["expired", "canceled"])("a terminal %s Pro subscription permits a new checkout without granting credit", async (status) => {
  const { env, id } = await fixture();
  await env.APP_DB.prepare("INSERT INTO app_autumn_customers(account_id,customer_id) VALUES(?,?)").bind(id, customerId).run();
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("customers.get_or_create")) return Response.json({ id: customerId });
    if (path.endsWith("customers.get")) return Response.json({ id: customerId, subscriptions: [{ ...subscription, status, canceled_at: Date.now() - 60_000 }] });
    expect(path).toEndWith("billing.attach");
    expect(JSON.parse(String(init?.body)).enable_plan_immediately).toBe(false);
    return Response.json({ customer_id: customerId, payment_url: "https://checkout.stripe.com/new-subscription" });
  }) as typeof fetch;
  expect((await createAutumnCheckout(env, id, "https://classifier.dev/app/plans")).url).toContain("checkout.stripe.com");
  expect((await env.APP_DB.prepare("SELECT balance FROM app_accounts WHERE id=?").bind(id).first())?.balance).toBe(500000);
});
