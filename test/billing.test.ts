import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { authenticatePro, BillingAccount, handleBilling, type BillingEnv } from "../src/billing";

afterEach(() => mock.restore());
function setup() {
  const data = new Map<string, unknown>();
  const instances = new Map<string, BillingAccount>();
  const customerId = "a".repeat(64);
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
  const external = spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    const input = JSON.parse(options?.body as string);
    if (String(url).includes("resend.com")) {sent = input.text; return Response.json({id: "email_123"});}
    if (fail) return Response.json({error: "PRIVATE PROVIDER DETAILS"}, {status: 500});
    if (String(url).endsWith("customers.get_or_create")) return Response.json({id: input.customer_id});
    if (String(url).endsWith("customers.get")) {
      calls++;
      return Response.json({subscriptions: status.active ? [{plan_id: "pro", status: "active", past_due: status.pastDue, expires_at: status.expires, canceled_at: 123}] : []});
    }
    return Response.json({url: "https://billing.stripe.com/session"});
  });
  const request = (action: string, input?: unknown, cookie?: string, origin = "https://classifier.dev") => handleBilling(new Request(`https://classifier.dev/v1/billing/${action}`, {
    method: action === "account" ? "GET" : "POST", headers: {Origin: origin, ...(cookie ? {Cookie: cookie} : {})}, ...(input ? {body: JSON.stringify(input)} : {}),
  }), env).then(response => response!);
  // Existing DurableObject behavior is tested directly, not through the retired public UI API.
  const legacyRequest = (action: string, input: Record<string, unknown> = {}, id = customerId) => env.BILLING!.get(env.BILLING!.idFromName(id)).fetch(new Request(`https://billing/${action}`, {
    method: "POST", body: JSON.stringify({customerId: id, origin: "https://classifier.dev", ...input}),
  }));
  const token = () => /#token=([a-f0-9.]+)/.exec(sent)![1];
  const signIn = async () => {
    expect((await legacyRequest("login", {email: "customer@example.com"})).status).toBe(200);
    const response = await legacyRequest("session", {secret: token().split(".")[1]});
    expect(response.status).toBe(200);
    return (await response.json() as {session: string}).session;
  };
  const auth = (key: string) => authenticatePro(new Request("https://classifier.dev/v1/classify", {headers: {Authorization: `Bearer ${key}`}}), env);
  return {env, request, legacyRequest, token, signIn, auth, data, status, external, customerId, get calls() {return calls;}, set fail(value: boolean) {fail = value;}};
}

test("retired billing UI endpoints send callers to account login without provider or storage side effects", async () => {
  const s = setup(), secret = await s.signIn();
  const key = (await (await s.legacyRequest("key", {secret})).json() as {key: string}).key;
  const stored = structuredClone([...s.data]);
  s.external.mockClear();
  const durableObjects = spyOn(s.env.BILLING!, "get");
  const limiter = spyOn(s.env.LIMITER, "get");
  for (const action of ["login", "session", "account", "key", "checkout", "portal", "logout"]) {
    const response = await s.request(action, {email: "customer@example.com", token: s.token()}, `classifier_session=${s.customerId}.${secret}`);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({login_url: "/login?returnTo=/app/plans"});
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBe("classifier_session=; Path=/v1/billing; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
  }
  expect(s.external).not.toHaveBeenCalled();
  expect(durableObjects).not.toHaveBeenCalled();
  expect(limiter).not.toHaveBeenCalled();
  expect([...s.data]).toEqual(stored);
  expect(await s.auth(key)).toEqual({customerId: s.customerId, active: true});
});

test("retired endpoints work without legacy provider configuration and reject foreign origins", async () => {
  const s = setup();
  delete s.env.BILLING; delete s.env.AUTUMN_SECRET_KEY; delete s.env.BILLING_SIGNING_KEY;
  expect((await s.request("login", {email: "customer@example.com"})).status).toBe(410);
  expect((await s.request("checkout", undefined, undefined, "https://evil.example")).status).toBe(403);
  expect((await s.request("login", undefined, undefined, "")).status).toBe(403);
  expect((await s.request("unknown")).status).toBe(404);
  expect((await handleBilling(new Request("https://classifier.dev/v1/billing/login"), s.env))!.status).toBe(405);
  expect((await handleBilling(new Request("https://other.example/v1/billing/account"), s.env))!.status).toBe(403);
  expect(await handleBilling(new Request("https://classifier.dev/v1/classify"), s.env)).toBeNull();
  expect(s.external).not.toHaveBeenCalled();
});

test("stored legacy login tokens remain single use under concurrency", async () => {
  const s = setup();
  await s.legacyRequest("login", {email: "customer@example.com"});
  const token = s.token();
  expect(token).toMatch(/^[a-f0-9]{64}\.[a-f0-9]{64}$/);
  const responses = await Promise.all([s.legacyRequest("session", {secret: token.split(".")[1]}), s.legacyRequest("session", {secret: token.split(".")[1]})]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 401]);
  expect(JSON.stringify([...s.data.values()])).not.toContain(token.split(".")[1]);
});

test("existing DurableObject keys rotate immediately, only hashes persist, and logout revokes its session", async () => {
  const s = setup(), secret = await s.signIn();
  const first = await (await s.legacyRequest("key", {secret})).json() as {key: string};
  expect(await s.auth(first.key)).toMatchObject({active: true});
  const second = await (await s.legacyRequest("key", {secret})).json() as {key: string};
  await expect(s.auth(first.key)).rejects.toMatchObject({status: 401});
  expect(await s.auth(second.key)).toMatchObject({active: true});
  expect(JSON.stringify([...s.data.values()])).not.toContain(second.key.split(".")[1]);
  expect((await s.legacyRequest("logout", {secret})).status).toBe(200);
  expect((await s.legacyRequest("account", {secret})).status).toBe(401);
});

test("entitlement refresh denies past-due, ended subscriptions and upstream failures after at most 60s", async () => {
  const time = spyOn(Date, "now").mockReturnValue(2000000000000);
  const s = setup(), secret = await s.signIn();
  const key = (await (await s.legacyRequest("key", {secret})).json() as {key: string}).key;
  await s.auth(key); expect(s.calls).toBe(1);
  s.status.pastDue = true; time.mockReturnValue(2000000060001);
  await expect(s.auth(key)).rejects.toMatchObject({status: 403, message: "Your Pro subscription is not active. Manage billing at /app/plans."});
  s.status.pastDue = false; s.status.expires = 2000000060000; time.mockReturnValue(2000000120002);
  await expect(s.auth(key)).rejects.toMatchObject({status: 403});
  s.fail = true; time.mockReturnValue(2000000180003);
  await expect(s.auth(key)).rejects.toMatchObject({status: 503, message: "Billing is temporarily unavailable. Please try again."});
});

test("stored legacy login links and sessions still expire", async () => {
  const time = spyOn(Date, "now").mockReturnValue(2000000000000);
  const s = setup(), secret = await s.signIn();
  time.mockReturnValue(2000000060001);
  await s.legacyRequest("login", {email: "customer@example.com"});
  const token = s.token(); time.mockReturnValue(2000000960002);
  expect((await s.legacyRequest("session", {secret: token.split(".")[1]})).status).toBe(401);
  time.mockReturnValue(2000000000000 + 30 * 86400000 + 1);
  expect((await s.legacyRequest("account", {secret})).status).toBe(401);
});

test("anonymous and existing enterprise authentication remain untouched", async () => {
  const s = setup();
  for (const Authorization of ["", "Bearer old-enterprise-token", "Basic example"]) {
    expect(await authenticatePro(new Request("https://classifier.dev", {headers: {Authorization}}), s.env)).toBeNull();
  }
  await expect(s.auth("classifier_pro_invalid")).rejects.toMatchObject({status: 401});
});

test("tampering with account ID cannot reuse a valid session or API key", async () => {
  const s = setup(), secret = await s.signIn();
  const key = (await (await s.legacyRequest("key", {secret})).json() as {key: string}).key;
  const replacementId = "f".repeat(64);
  expect((await s.legacyRequest("account", {secret}, replacementId)).status).toBe(401);
  await expect(s.auth(key.replace(s.customerId, replacementId))).rejects.toMatchObject({status: 401});
});

test("known subscription expiry bounds cache and inactive access refreshes within five seconds", async () => {
  const time = spyOn(Date, "now").mockReturnValue(2000000000000);
  const s = setup(), secret = await s.signIn();
  s.status.expires = 2000000001000;
  const key = (await (await s.legacyRequest("key", {secret})).json() as {key: string}).key;
  expect(await s.auth(key)).toMatchObject({active: true});
  time.mockReturnValue(2000000001001);
  await expect(s.auth(key)).rejects.toMatchObject({status: 403});
  s.status.expires = null;
  time.mockReturnValue(2000000006002);
  expect(await s.auth(key)).toMatchObject({active: true});
});
