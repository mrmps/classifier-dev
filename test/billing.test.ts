import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { authenticatePro, BillingAccount, handleBilling, type BillingEnv } from "../src/billing";

afterEach(() => mock.restore());
function setup() {
  const data = new Map<string, unknown>();
  const instances = new Map<string, BillingAccount>();
  let sent = "", status = {active: true, pastDue: false, expires: null as number | null}, calls = 0, fail = false;
  const env: BillingEnv = {
    BILLING_SIGNING_KEY: "test-billing-secret", AUTUMN_SECRET_KEY: "test-autumn", RESEND_API_KEY: "test-resend", NEWSLETTER_FROM: "test@example.com",
    LIMITER: {idFromName: (x: string) => x, get: () => ({fetch: async () => Response.json({limited: false})})} as unknown as DurableObjectNamespace,
  };
  env.BILLING = {idFromName: (x: string) => x, get: (id: string) => {
    if (!instances.has(id)) instances.set(id, new BillingAccount({storage: {
      get: async (key: string) => structuredClone(data.get(id + key)),
      put: async (key: string, value: unknown) => {data.set(id + key, structuredClone(value));},
      transaction: async (callback: (storage: unknown) => Promise<unknown>) => callback({
        get: async (key: string) => structuredClone(data.get(id + key)),
        put: async (key: string, value: unknown) => {data.set(id + key, structuredClone(value));},
      }),
    }} as unknown as DurableObjectState, env));
    return instances.get(id);
  }} as unknown as DurableObjectNamespace;
  spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    const input = JSON.parse(options?.body as string);
    if (String(url).includes("resend.com")) {sent = input.text; return Response.json({id: "email_123"});}
    if (fail) return Response.json({error: "PRIVATE PROVIDER DETAILS"}, {status: 500});
    if (String(url).endsWith("customers.get_or_create")) return Response.json({id: input.customer_id});
    if (String(url).endsWith("customers.get")) {
      calls++;
      return Response.json({subscriptions: status.active ? [{plan_id: "pro", status: "active", past_due: status.pastDue, expires_at: status.expires, canceled_at: 123}] : []});
    }
    if (String(url).endsWith("billing.attach")) {
      expect(input.redirect_mode).toBe("always"); expect(input.plan_id).toBe("pro");
      return Response.json({payment_url: "https://checkout.stripe.com/session"});
    }
    return Response.json({url: "https://billing.stripe.com/session"});
  });
  const request = (action: string, input?: unknown, cookie?: string, origin = "https://classifier.dev") => handleBilling(new Request(`https://classifier.dev/v1/billing/${action}`, {
    method: action === "account" ? "GET" : "POST", headers: {Origin: origin, ...(cookie ? {Cookie: cookie} : {})}, ...(input ? {body: JSON.stringify(input)} : {}),
  }), env).then(response => response!);
  const token = () => /#token=([a-f0-9.]+)/.exec(sent)![1];
  const signIn = async () => {
    expect((await request("login", {email: "Customer@example.com"})).status).toBe(200);
    const response = await request("session", {token: token()});
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie")!.split(";")[0];
  };
  return {env, request, token, signIn, data, status, get calls() {return calls;}, set fail(value: boolean) {fail = value;}};
}

test("login tokens are single use under concurrency; cookies are secured and provider identity stays opaque", async () => {
  const s = setup();
  await s.request("login", {email: "Customer@example.com"});
  const token = s.token();
  expect(token).toMatch(/^[a-f0-9]{64}\.[a-f0-9]{64}$/);
  const responses = await Promise.all([s.request("session", {token}), s.request("session", {token})]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 401]);
  const cookie = responses.find(r => r.status === 200)!.headers.get("set-cookie")!;
  expect(cookie).toContain("HttpOnly; Secure; SameSite=Strict");
  expect(cookie).toContain("Path=/v1/billing");
  expect(JSON.stringify([...s.data.values()])).not.toContain(token.split(".")[1]);
});

test("API keys rotate immediately, only hashes persist, logout revokes the session", async () => {
  const s = setup(), cookie = await s.signIn();
  const first = await (await s.request("key", undefined, cookie)).json() as {key: string};
  const auth = (key: string) => authenticatePro(new Request("https://classifier.dev/v1/classify", {headers: {Authorization: `Bearer ${key}`}}), s.env);
  expect(await auth(first.key)).toMatchObject({active: true});
  const second = await (await s.request("key", undefined, cookie)).json() as {key: string};
  await expect(auth(first.key)).rejects.toMatchObject({status: 401});
  expect(await auth(second.key)).toMatchObject({active: true});
  expect(JSON.stringify([...s.data.values()])).not.toContain(second.key.split(".")[1]);
  expect((await s.request("logout", undefined, cookie)).status).toBe(200);
  expect((await s.request("account", undefined, cookie)).status).toBe(401);
});

test("entitlement refresh denies past-due, ended subscriptions and upstream failures after at most 60s", async () => {
  const time = spyOn(Date, "now").mockReturnValue(2000000000000);
  const s = setup(), cookie = await s.signIn();
  const key = (await (await s.request("key", undefined, cookie)).json() as {key: string}).key;
  const auth = () => authenticatePro(new Request("https://classifier.dev/v1/classify", {headers: {Authorization: `Bearer ${key}`}}), s.env);
  await auth(); expect(s.calls).toBe(1);
  s.status.pastDue = true; time.mockReturnValue(2000000060001);
  await expect(auth()).rejects.toMatchObject({status: 403});
  s.status.pastDue = false; s.status.expires = 2000000060000; time.mockReturnValue(2000000120002);
  await expect(auth()).rejects.toMatchObject({status: 403});
  s.fail = true; time.mockReturnValue(2000000180003);
  await expect(auth()).rejects.toMatchObject({status: 503});
});

test("login links expire; cookie mutations reject foreign origins and request bodies are bounded", async () => {
  const time = spyOn(Date, "now").mockReturnValue(2000000000000);
  const s = setup();
  expect((await s.request("login", {email: "Customer@example.com"}, undefined, "https://evil.example")).status).toBe(403);
  expect((await s.request("login", {email: "a".repeat(9000)})).status).toBe(413);
  await s.request("login", {email: "Customer@example.com"});
  const token = s.token(); time.mockReturnValue(2000000900001);
  expect((await s.request("session", {token})).status).toBe(401);
});

test("free accounts can reach hosted checkout and billing errors never expose provider details", async () => {
  const s = setup(), cookie = await s.signIn(); s.status.active = false;
  expect(await (await s.request("account", undefined, cookie)).json()).toMatchObject({active: false, plan: "free"});
  expect((await s.request("key", undefined, cookie)).status).toBe(403);
  expect(await (await s.request("checkout", undefined, cookie)).json()).toEqual({url: "https://checkout.stripe.com/session"});
  s.fail = true;
  const response = await s.request("portal", undefined, cookie);
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE");
});

test("anonymous and existing enterprise authentication remain untouched", async () => {
  const s = setup();
  for (const Authorization of ["", "Bearer old-enterprise-token", "Basic example"]) {
    expect(await authenticatePro(new Request("https://classifier.dev", {headers: {Authorization}}), s.env)).toBeNull();
  }
  await expect(authenticatePro(new Request("https://classifier.dev", {headers: {Authorization: "Bearer classifier_pro_invalid"}}), s.env)).rejects.toMatchObject({status: 401});
});

test("email throttling is per account and session expiration requires a fresh link", async () => {
  const time = spyOn(Date, "now").mockReturnValue(2000000000000);
  const s = setup(), cookie = await s.signIn(), original = s.token();
  await s.request("login", {email: "customer@example.com"});
  expect(s.token()).toBe(original);
  time.mockReturnValue(2000000000000 + 30 * 86400000 + 1);
  expect((await s.request("account", undefined, cookie)).status).toBe(401);
});

test("billing login fails closed when caller is rate limited", async () => {
  const s = setup();
  s.env.LIMITER = {idFromName: (x: string) => x, get: () => ({fetch: async () => Response.json({limited: true})})} as unknown as DurableObjectNamespace;
  expect((await s.request("login", {email: "customer@example.com"})).status).toBe(429);
  expect(s.data.size).toBe(0);
});

test("tampering with account ID cannot reuse a valid session or API key", async () => {
  const s = setup(), cookie = await s.signIn();
  const key = (await (await s.request("key", undefined, cookie)).json() as {key: string}).key;
  const replacementId = "f".repeat(64);
  const tamperedCookie = cookie.replace(/=[a-f0-9]{64}\./, `=${replacementId}.`);
  expect((await s.request("account", undefined, tamperedCookie)).status).toBe(401);
  await expect(authenticatePro(new Request("https://classifier.dev", {headers: {Authorization: `Bearer ${key.replace(/classifier_pro_[a-f0-9]{64}\./, `classifier_pro_${replacementId}.`)}`}}), s.env)).rejects.toMatchObject({status: 401});
});

test("rate limiter failures cannot send an email and repeated checkout only creates confirmation links", async () => {
  const s = setup(), cookie = await s.signIn();
  for (let i = 0; i < 2; i++) {
    expect((await s.request("checkout", undefined, cookie)).status).toBe(200);
  }
  s.env.LIMITER = {idFromName: (x: string) => x, get: () => ({fetch: async () => {throw new Error("limiter unavailable");}})} as unknown as DurableObjectNamespace;
  expect((await s.request("login", {email: "new@example.com"})).status).toBe(503);
  expect(s.data.size).toBe(1);
});

test("known subscription expiry bounds cache and new checkout access refreshes within five seconds", async () => {
  const time = spyOn(Date, "now").mockReturnValue(2000000000000);
  const s = setup(), cookie = await s.signIn();
  s.status.expires = 2000000001000;
  expect(await (await s.request("account", undefined, cookie)).json()).toMatchObject({active: true});
  time.mockReturnValue(2000000001001);
  expect(await (await s.request("account", undefined, cookie)).json()).toMatchObject({active: false});
  s.status.expires = null;
  time.mockReturnValue(2000000006002);
  expect(await (await s.request("account", undefined, cookie)).json()).toMatchObject({active: true});
});
