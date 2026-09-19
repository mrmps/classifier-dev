/**
 * Operator notifications: one private email after a sign-in, one after a new paid Pro subscription.
 * The Stripe endpoint is exercised with real HMAC signatures over the real body bytes, and the outbox
 * through the fixture's storage and alarms, so nothing here is a stand-in for the code under test.
 */
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { OWNER, ORIGIN, PRO_PRODUCT, WEBHOOK_SECRET, setup, stripeSignature } from "./workos-fixture";

afterEach(() => mock.restore());

test("long verified email addresses sign in without overflowing the notification subject", async () => {
  const s = setup();
  s.workos.user.email = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(60)}`;
  expect(s.workos.user.email).toHaveLength(253);
  await s.signIn();
  await s.runAlarms();
  expect(s.resend.requests[0].body.subject).toBe("classifier.dev: account signed in");
  expect(s.resend.requests[0].body.text).toContain(s.workos.user.email);
});

const SUBSCRIPTION = "sub_1PaidLive", CUSTOMER = "cus_PaidLive", INVOICE = "in_1PaidLive";
type Data = Record<string, any>;
/** The shape a current live invoice.paid actually has: the subscription and the product hang off `parent`/`pricing`. */
const modernLine = (over: Data = {}) => ({
  id: "il_1", object: "line_item", amount: 2000, currency: "usd",
  pricing: {type: "price_details", price_details: {product: PRO_PRODUCT, price: "price_1Pro"}},
  parent: {type: "subscription_item_details", subscription_item_details: {subscription: SUBSCRIPTION, subscription_item: "si_1"}},
  ...over,
});
/** The older schema Stripe still sends on pinned API versions: `invoice.subscription`, `line.price.product`. */
const legacyLine = (over: Data = {}) => ({id: "il_1", object: "line_item", amount: 2000, currency: "usd", price: {id: "price_1Pro", object: "price", product: PRO_PRODUCT}, ...over});

const invoice = (over: Data = {}) => ({
  id: INVOICE, object: "invoice", status: "paid", billing_reason: "subscription_create",
  amount_paid: 2000, amount_due: 2000, currency: "usd", customer: CUSTOMER, customer_email: "buyer@example.com",
  parent: {type: "subscription_details", subscription_details: {subscription: SUBSCRIPTION, metadata: {}}},
  lines: {object: "list", data: [modernLine()]},
  ...over,
});
const event = (over: Data = {}, invoiceOver: Data = {}) => ({
  id: "evt_1Live", object: "event", api_version: "2026-04-22.dahlia", created: 1758300000,
  livemode: true, type: "invoice.paid", data: {object: invoice(invoiceOver)}, ...over,
});
const legacy = () => event({}, {parent: undefined, subscription: SUBSCRIPTION, lines: {object: "list", data: [legacyLine()]}});

const outbox = (s: ReturnType<typeof setup>, id: string) => s.data.get(`${id}outbox`) as Data | undefined;
const sent = (s: ReturnType<typeof setup>) => s.resend.requests.map(r => r.body);

test("replayed invoices show the original payment time", async () => {
  const s = setup();
  const paidAt = 1750000000;
  await s.stripe(event({}, {status_transitions: {paid_at: paidAt}}));
  await s.runAlarms();
  expect(s.resend.requests[0].body.text).toContain(`Paid:          ${new Date(paidAt * 1000).toISOString()}`);
});

test("an accepted email survives a failed sent-marker write with one provider delivery", async () => {
  const s = setup();
  await s.stripe(event());
  s.storageFailure.sent = true;
  await expect(s.runAlarms()).rejects.toThrow("storage unavailable after send");
  expect(s.alarms.size).toBe(1);
  expect(s.resend.accepted.size).toBe(1);
  s.storageFailure.sent = false;
  s.restart();
  await s.runAlarms(Date.now() + 60_000);
  expect(s.resend.requests).toHaveLength(2);
  expect(s.resend.accepted.size).toBe(1);
  expect(s.resend.requests[1].body).toEqual(s.resend.requests[0].body);
  expect(outbox(s, `notify:pro:${SUBSCRIPTION}`)).toEqual({key: `notify:pro:${SUBSCRIPTION}`, sent: true});
  expect(s.alarms.size).toBe(0);
});

test("missing recipient configuration keeps a durable job until repaired", async () => {
  const s = setup();
  delete s.env.REPORT_TO;
  await s.stripe(event());
  await s.runAlarms();
  expect(s.resend.requests).toHaveLength(0);
  expect(s.alarms.size).toBe(1);
  s.env.REPORT_TO = OWNER;
  await s.runAlarms(Date.now() + 60_000);
  expect(s.resend.requests[0].body.to).toEqual([OWNER]);
  expect(s.alarms.size).toBe(0);
});

test("a live paid subscription invoice notifies the operator once, from the outbox rather than the request", async () => {
  const s = setup();
  const response = await s.stripe(event());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({received: true});
  // Nothing was emailed while Stripe was waiting; the record and its alarm are what the 200 promises.
  expect(s.resend.requests).toHaveLength(0);
  expect(outbox(s, `notify:pro:${SUBSCRIPTION}`)).toMatchObject({key: `notify:pro:${SUBSCRIPTION}`, attempts: 0});
  expect(await s.runAlarms()).toBe(1);
  expect(s.resend.requests).toHaveLength(1);
  const {headers, body} = s.resend.requests[0];
  expect(headers.get("Idempotency-Key")).toBe(`notify:pro:${SUBSCRIPTION}`);
  expect(headers.get("authorization")).toBe("Bearer re_test_key");
  expect(body).toMatchObject({from: "classifier.dev <onboarding@resend.dev>", to: [OWNER], reply_to: "contact@classifier.dev"});
  expect(body.subject).toBe("classifier.dev: new paid Pro subscription (20.00 USD)");
  expect(body.text).toContain("not a renewal");
  expect(body.text).toContain("buyer@example.com");
  expect(body.text).toContain("20.00 USD");
  for (const id of [SUBSCRIPTION, CUSTOMER, INVOICE]) expect(body.text).toContain(id);
  // The message carries billing identity and nothing else; the delivered payload is discarded from storage.
  expect(body.text).not.toContain("classifier_pro_");
  expect(body.text).not.toContain(OWNER);
  expect(JSON.stringify([...s.data.values()])).not.toContain(OWNER);
  expect(outbox(s, `notify:pro:${SUBSCRIPTION}`)).toEqual({key: `notify:pro:${SUBSCRIPTION}`, sent: true});
  expect(s.alarms.size).toBe(0);
});

test("the older invoice schema is understood too", async () => {
  const s = setup();
  expect((await s.stripe(legacy())).status).toBe(200);
  expect(await s.runAlarms()).toBe(1);
  expect(sent(s)[0].text).toContain(SUBSCRIPTION);
});

test("forged, missing, malformed, stale and future signatures are refused and queue nothing", async () => {
  const time = spyOn(Date, "now").mockReturnValue(1758300000000);
  const s = setup();
  const seconds = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(event());
  const good = await stripeSignature(body, {timestamp: seconds});
  const other = await stripeSignature(body, {timestamp: seconds, secret: "whsec_someone_elses_secret"});
  const forged = await stripeSignature(JSON.stringify(event({id: "evt_other"})), {timestamp: seconds});
  const headers = [
    null,                                                     // no Stripe-Signature at all
    "",                                                       // an empty one
    `t=${seconds}`,                                           // no v1
    `v1=${good.v1}`,                                          // no timestamp
    `t=not-a-number,v1=${good.v1}`,                           // an unusable timestamp
    `t=${seconds},v1=zz${good.v1.slice(2)}`,                  // not hex
    `t=${seconds},v1=${good.v1.slice(0, 63)}`,                // truncated
    `t=${seconds},v1=${other.v1}`,                            // another secret
    `t=${seconds},v1=${forged.v1}`,                           // a signature for a different body
    `t=${seconds - 301},v1=${(await stripeSignature(body, {timestamp: seconds - 301})).v1}`,  // stale
    `t=${seconds + 301},v1=${(await stripeSignature(body, {timestamp: seconds + 301})).v1}`,  // future
  ];
  for (const header of headers) {
    const response = await s.stripe(null, {body, header});
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain(WEBHOOK_SECRET);
    expect(text).not.toContain(PRO_PRODUCT);
  }
  expect(s.data.size).toBe(0);
  expect(s.alarms.size).toBe(0);
  // Inside the tolerance, and with a rotation's second signature present, the same body is accepted.
  expect((await s.stripe(null, {body, header: `t=${seconds - 299},v1=${(await stripeSignature(body, {timestamp: seconds - 299})).v1}`})).status).toBe(200);
  time.mockReturnValue(1758300000000);
  s.data.clear();
  expect((await s.stripe(null, {body, header: `t=${seconds},v1=${other.v1},v1=${good.v1}`})).status).toBe(200);
  expect(await s.runAlarms()).toBe(1);
});

test("only a live, paid, first-payment invoice for the Pro product notifies", async () => {
  const s = setup();
  const ignored: Data[] = [
    event({livemode: false}),                                                   // test mode
    event({type: "invoice.payment_succeeded"}),                                 // a neighbouring event
    event({type: "checkout.session.completed"}),                                // a redirect, which never grants anything
    event({}, {billing_reason: "subscription_cycle"}),                          // a renewal
    event({}, {billing_reason: "subscription_update"}),
    event({}, {status: "open"}),                                                // not paid
    event({}, {amount_paid: 0}),
    event({}, {amount_paid: -2000}),
    event({}, {amount_paid: 20.5}),
    event({}, {amount_paid: "2000"}),
    event({}, {parent: undefined}),                                             // no subscription anywhere
    event({}, {customer: undefined}),
    event({}, {currency: undefined}),
    event({}, {lines: {object: "list", data: []}}),
    event({}, {lines: {object: "list", data: [modernLine({pricing: {type: "price_details", price_details: {product: "prod_other_thing"}}})]}}),
    event({}, {lines: {object: "list", data: [legacyLine({price: {product: "prod_other_thing"}})]}}),
    event({}, {lines: {object: "list", data: [modernLine({amount: 0})]}}),      // a zero line for the product
    event({}, {lines: {object: "list", data: [modernLine({parent: {type: "subscription_item_details", subscription_item_details: {subscription: "sub_somebody_else"}}})]}}),
  ];
  for (const ignore of ignored) {
    const response = await s.stripe(ignore);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({received: true});
  }
  expect(s.data.size).toBe(0);
  expect(await s.runAlarms()).toBe(0);
  expect(s.resend.requests).toHaveLength(0);
  // Expanded objects stand in for IDs wherever Stripe documents one, and are read the same way.
  const expanded = event({}, {
    customer: {id: CUSTOMER, object: "customer"},
    parent: {type: "subscription_details", subscription_details: {subscription: {id: SUBSCRIPTION, object: "subscription"}}},
    lines: {object: "list", data: [modernLine({pricing: {type: "price_details", price_details: {product: {id: PRO_PRODUCT, object: "product"}}}})]},
  });
  expect((await s.stripe(expanded)).status).toBe(200);
  expect(await s.runAlarms()).toBe(1);
  expect(sent(s)[0].text).toContain(CUSTOMER);
});

test("an invoice without a usable customer email says so rather than inventing one", async () => {
  const s = setup();
  expect((await s.stripe(event({}, {customer_email: null}))).status).toBe(200);
  await s.runAlarms();
  expect(sent(s)[0].text).toContain("Email unavailable");
});

test("redelivered and concurrent copies of one event send exactly one email", async () => {
  const s = setup();
  const copies = [s.stripe(event()), s.stripe(event({id: "evt_second_delivery"})), s.stripe(event({id: "evt_third_delivery"}, {id: "in_second_attempt"}))];
  for (const response of await Promise.all(copies)) expect(response.status).toBe(200);
  expect(await s.runAlarms()).toBe(1);
  expect(s.resend.requests).toHaveLength(1);
  // A redelivery long after Resend's 24-hour idempotency window is stopped by our own sent marker.
  const time = spyOn(Date, "now").mockReturnValue(Date.now() + 25 * 3600_000);
  expect((await s.stripe(event({id: "evt_much_later"}))).status).toBe(200);
  expect(await s.runAlarms()).toBe(0);
  expect(s.resend.requests).toHaveLength(1);
  time.mockRestore();
});

test("a restart loses nothing: the alarm still sends, and the sent marker still holds", async () => {
  const s = setup();
  expect((await s.stripe(event())).status).toBe(200);
  s.restart();
  expect(await s.runAlarms()).toBe(1);
  expect(s.resend.requests).toHaveLength(1);
  s.restart();
  expect((await s.stripe(event({id: "evt_after_restart"}))).status).toBe(200);
  expect(await s.runAlarms()).toBe(0);
  expect(s.resend.requests).toHaveLength(1);
  expect(outbox(s, `notify:pro:${SUBSCRIPTION}`)).toEqual({key: `notify:pro:${SUBSCRIPTION}`, sent: true});
});

test("a refused or unreachable Resend is retried with a bounded backoff, never dropped", async () => {
  const start = 1758300000000;
  const time = spyOn(Date, "now").mockReturnValue(start);
  const s = setup();
  const id = `notify:pro:${SUBSCRIPTION}`;
  expect((await s.stripe(event())).status).toBe(200);
  const failures: [() => void, number][] = [
    [() => {s.resend.status = 500;}, 30_000],            // refused
    [() => {s.resend.status = 200; s.resend.id = null;}, 60_000],  // accepted, but naming no email
    [() => {s.resend.id = "email_test_01"; s.resend.unreachable = true;}, 120_000],  // no answer at all
    [() => {s.resend.unreachable = false; delete s.env.RESEND_API_KEY;}, 240_000],   // and a missing key
    [() => {delete s.env.RESEND_API_KEY; delete s.env.REPORT_TO;}, 480_000],
  ];
  let attempts = 0, now = start;
  for (const [breakIt, delay] of failures) {
    breakIt();
    time.mockReturnValue(now);
    expect(await s.runAlarms()).toBe(1);
    attempts++;
    expect(outbox(s, id)).toMatchObject({attempts});
    expect(outbox(s, id)!.sent).toBeUndefined();
    expect(s.alarms.get(id)).toBe(now + delay);
    now += delay;
  }
  // The delay is capped so a long outage keeps trying hourly rather than drifting away.
  for (let i = 0; i < 10; i++) {
    time.mockReturnValue(now);
    await s.runAlarms();
    now = s.alarms.get(id)!;
  }
  expect(s.alarms.get(id)! - Date.now()).toBe(3_600_000);
  // Repairing the environment delivers the message that was waiting all along.
  s.env.REPORT_TO = OWNER; s.env.RESEND_API_KEY = "re_test_key";
  time.mockReturnValue(now);
  expect(await s.runAlarms()).toBe(1);
  expect(sent(s).at(-1)).toMatchObject({to: [OWNER]});
  expect(outbox(s, id)).toEqual({key: id, sent: true});
  expect(s.alarms.size).toBe(0);
});

test("a retry after an unknown result repeats the key and the body exactly", async () => {
  const s = setup();
  expect((await s.stripe(event())).status).toBe(200);
  s.resend.unreachable = true;
  await s.runAlarms();
  s.resend.unreachable = false;
  s.env.REPORT_TO = "changed-owner@example.com";
  await s.runAlarms(Date.now() + 60_000);
  expect(s.resend.requests).toHaveLength(2);
  expect(s.resend.requests[1].body).toEqual(s.resend.requests[0].body);
  expect(s.resend.requests[1].headers.get("Idempotency-Key")).toBe(s.resend.requests[0].headers.get("Idempotency-Key"));
  // And once accepted it stops: the third alarm finds the marker, not a message.
  expect(await s.runAlarms(Date.now() + 120_000)).toBe(0);
  expect(s.resend.requests).toHaveLength(2);
});

test("a storage failure asks Stripe to retry rather than claiming the event was handled", async () => {
  const s = setup();
  const namespace = s.env.BILLING!;
  s.env.BILLING = {idFromName: (x: string) => x, get: () => ({fetch: async () => {throw new Error("storage unavailable");}})} as unknown as DurableObjectNamespace;
  const response = await s.stripe(event());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("storage unavailable");
  s.env.BILLING = namespace;
  expect((await s.stripe(event())).status).toBe(200);
});

test("the webhook needs no Origin, while browser mutations still do", async () => {
  const s = setup(), cookie = await s.signIn();
  expect((await s.stripe(event())).status).toBe(200);
  expect((await s.call("key", {method: "POST", cookie, body: "{}"})).status).toBe(403);
  expect((await s.call("key", {method: "POST", cookie, origin: ORIGIN, body: "{}"})).status).toBe(200);
  // A webhook posted at another origin is still not this site's webhook.
  const foreign = await import("../src/billing").then(m => m.handleBilling(new Request("https://evil.example/v1/billing/stripe-webhook", {method: "POST", body: "{}"}), s.env));
  expect(foreign!.status).toBe(403);
});

test("an oversized body, a missing body, the wrong method and missing configuration are refused", async () => {
  const s = setup();
  // Signed or not, a body past the bound is refused while it streams, before anything is parsed.
  const oversized = JSON.stringify({padding: "x".repeat(256 * 1024)});
  expect((await s.stripe(null, {body: oversized})).status).toBe(413);
  expect((await s.stripe(null, {body: oversized, header: null})).status).toBe(413);
  expect((await s.stripe(null, {body: "not json"})).status).toBe(400);
  expect((await s.stripe(null, {body: "[1,2,3]"})).status).toBe(400);
  expect((await s.call("stripe-webhook", {method: "POST"})).status).toBe(400);
  for (const method of ["GET", "HEAD"]) expect((await s.call("stripe-webhook", {method})).status).toBe(405);
  for (const missing of ["STRIPE_WEBHOOK_SECRET", "STRIPE_PRO_PRODUCT_ID"] as const) {
    const s2 = setup();
    delete s2.env[missing];
    const response = await s2.stripe(event());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(missing);
  }
  expect(s.data.size).toBe(0);
  // A large event under the bound is read whole and handled normally.
  expect((await s.stripe(event({padding: "x".repeat(200_000)}))).status).toBe(200);
  expect(await s.runAlarms()).toBe(1);
});

test("a completed sign-in emails once; refreshes, account reads and sign-outs add nothing", async () => {
  const s = setup();
  const cookie = await s.signIn();
  const sessionId = s.workos.sessions[0].id;
  expect(s.resend.requests).toHaveLength(0);
  expect(outbox(s, `notify:login:${sessionId}`)).toMatchObject({key: `notify:login:${sessionId}`, attempts: 0});
  expect(await s.runAlarms()).toBe(1);
  const {headers, body} = s.resend.requests[0];
  expect(headers.get("Idempotency-Key")).toBe(`notify:login:${sessionId}`);
  expect(body.to).toEqual([OWNER]);
  // The address exactly as the provider gave it, not the normalized one the billing ID is derived from.
  expect(body.subject).toBe("classifier.dev: account signed in");
  expect(body.text).toContain(sessionId);
  expect(body.text).toContain(new Date(Date.now()).toISOString().slice(0, 13));
  expect(body.text).not.toContain("classifier_pro_");
  for (const action of ["account", "key", "account", "logout"]) await s.request(action, cookie);
  expect(await s.runAlarms()).toBe(0);
  expect(s.resend.requests).toHaveLength(1);
});

test("a refreshed session is not a new sign-in", async () => {
  const s = setup();
  s.workos.tokenTtl = -60;
  const expired = await s.signIn();
  s.workos.tokenTtl = 300;
  const refreshed = await s.request("account", expired);
  expect(refreshed.status).toBe(200);
  expect([...s.data.keys()].filter(k => k.startsWith("notify:")).length).toBe(1);
  expect(await s.runAlarms()).toBe(1);
  expect(s.resend.requests).toHaveLength(1);
  expect(await s.runAlarms()).toBe(0);
});

test("a callback that does not finish in a signed-in account notifies nobody", async () => {
  const s = setup();
  s.workos.user.email_verified = false;
  const started = await s.login();
  expect((await s.callback(started.code, started.state, started.cookie)).status).toBe(403);
  const replayed = await s.login();
  expect((await s.callback(replayed.code, "wrong-state", replayed.cookie)).status).toBe(400);
  s.workos.exchangeStatus = 500;
  const failed = await s.login();
  expect((await s.callback(failed.code, failed.state, failed.cookie)).status).toBe(503);
  expect([...s.data.keys()].filter(k => k.startsWith("notify:"))).toEqual([]);
  expect(await s.runAlarms()).toBe(0);
});

test("a Resend outage cannot delay or fail a sign-in", async () => {
  const s = setup();
  s.resend.unreachable = true;
  const started = await s.login();
  const response = await s.callback(started.code, started.state, started.cookie);
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe(`${ORIGIN}/pro`);
  // No email network was touched while the browser waited.
  expect(s.resend.requests).toHaveLength(0);
  expect((await s.request("account", (response.headers.getSetCookie().find(c => c.startsWith("classifier_auth="))!).split(";")[0])).status).toBe(200);
  await s.runAlarms();
  expect(s.resend.requests).toHaveLength(1);
});
