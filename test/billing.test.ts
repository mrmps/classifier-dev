import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { authenticatePro, handleBilling } from "../src/billing";
import { setup } from "./workos-fixture";

afterEach(() => mock.restore());
const auth = (s: ReturnType<typeof setup>, key: string) => authenticatePro(new Request("https://classifier.dev/v1/classify", {headers: {Authorization: `Bearer ${key}`}}), s.env);

test("API keys rotate immediately, only hashes persist, sign-out ends the session", async () => {
  const s = setup(), cookie = await s.signIn();
  const first = await (await s.request("key", cookie)).json() as {key: string};
  expect(await auth(s, first.key)).toMatchObject({active: true});
  const second = await (await s.request("key", cookie)).json() as {key: string};
  await expect(auth(s, first.key)).rejects.toMatchObject({status: 401});
  expect(await auth(s, second.key)).toMatchObject({active: true});
  expect(JSON.stringify([...s.data.values()])).not.toContain(second.key.split(".")[1]);
  expect((await s.request("logout", cookie)).status).toBe(200);
  expect((await s.request("account", cookie)).status).toBe(401);
});

test("entitlement refresh denies past-due, ended subscriptions and upstream failures after at most 60s", async () => {
  const time = spyOn(Date, "now").mockReturnValue(2000000000000);
  const s = setup(), cookie = await s.signIn();
  const key = (await (await s.request("key", cookie)).json() as {key: string}).key;
  await auth(s, key); expect(s.calls).toBe(1);
  s.status.pastDue = true; time.mockReturnValue(2000000060001);
  await expect(auth(s, key)).rejects.toMatchObject({status: 403});
  s.status.pastDue = false; s.status.expires = 2000000060000; time.mockReturnValue(2000000120002);
  await expect(auth(s, key)).rejects.toMatchObject({status: 403});
  s.fail = true; time.mockReturnValue(2000000180003);
  await expect(auth(s, key)).rejects.toMatchObject({status: 503});
});

test("cookie mutations reject foreign or missing origins, wrong methods and unknown routes", async () => {
  const s = setup(), cookie = await s.signIn();
  for (const action of ["key", "checkout", "portal", "logout"]) {
    expect((await s.request(action, cookie, "https://evil.example")).status).toBe(403);
    expect((await s.call(action, {method: "POST", cookie, body: "{}"})).status).toBe(403);
    expect((await s.call(action, {cookie})).status).toBe(405);
  }
  expect((await s.call("account", {method: "POST", cookie, origin: "https://classifier.dev", body: "{}"})).status).toBe(405);
  expect((await s.call("session", {method: "POST", cookie, origin: "https://classifier.dev", body: "{}"})).status).toBe(404);
  expect((await s.call("login", {method: "POST", origin: "https://classifier.dev", body: JSON.stringify({email: "customer@example.com"})})).status).toBe(405);
  expect((await s.request("account", cookie)).status).toBe(200);
});

test("free accounts can reach hosted checkout and billing errors never expose provider details", async () => {
  const s = setup(), cookie = await s.signIn(); s.status.active = false;
  expect(await (await s.request("account", cookie)).json()).toMatchObject({email: "customer@example.com", active: false, plan: "free", hasKey: false});
  expect((await s.request("key", cookie)).status).toBe(403);
  expect(await (await s.request("checkout", cookie)).json()).toEqual({url: "https://checkout.stripe.com/session"});
  s.fail = true;
  const response = await s.request("portal", cookie);
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE");
});

test("anonymous and existing enterprise authentication remain untouched", async () => {
  const s = setup();
  for (const Authorization of ["", "Bearer old-enterprise-token", "Basic example"]) {
    expect(await authenticatePro(new Request("https://classifier.dev", {headers: {Authorization}}), s.env)).toBeNull();
  }
  await expect(authenticatePro(new Request("https://classifier.dev", {headers: {Authorization: "Bearer classifier_pro_invalid"}}), s.env)).rejects.toMatchObject({status: 401});
});

test("billing login fails closed when the caller is rate limited or the limiter is down", async () => {
  const s = setup();
  s.env.LIMITER = {idFromName: (x: string) => x, get: () => ({fetch: async () => Response.json({limited: true})})} as unknown as DurableObjectNamespace;
  expect((await s.call("login")).status).toBe(429);
  s.env.LIMITER = {idFromName: (x: string) => x, get: () => ({fetch: async () => {throw new Error("limiter unavailable");}})} as unknown as DurableObjectNamespace;
  expect((await s.call("login")).status).toBe(503);
  for (const response of [{}, {limited: "false"}, null]) {
    s.env.LIMITER = {idFromName: (x: string) => x, get: () => ({fetch: async () => Response.json(response)})} as unknown as DurableObjectNamespace;
    expect((await s.call("login")).status).toBe(503);
  }
  expect(s.data.size).toBe(0);
});

test("tampering with the account ID cannot reuse a valid API key", async () => {
  const s = setup(), cookie = await s.signIn();
  const key = (await (await s.request("key", cookie)).json() as {key: string}).key;
  const replacementId = "f".repeat(64);
  await expect(auth(s, key.replace(/classifier_pro_[a-f0-9]{64}\./, `classifier_pro_${replacementId}.`))).rejects.toMatchObject({status: 401});
});

test("repeated checkout only creates confirmation links and the Autumn customer is created once", async () => {
  const s = setup(), cookie = await s.signIn();
  for (let i = 0; i < 2; i++) expect((await s.request("checkout", cookie)).status).toBe(200);
  const account = [...s.data.values()].find(v => (v as {workosUserId?: string}).workosUserId) as {autumnCustomer?: boolean};
  expect(account.autumnCustomer).toBe(true);
});

test("known subscription expiry bounds cache and new checkout access refreshes within five seconds", async () => {
  const time = spyOn(Date, "now").mockReturnValue(2000000000000);
  const s = setup(), cookie = await s.signIn();
  s.status.expires = 2000000001000;
  expect(await (await s.request("account", cookie)).json()).toMatchObject({active: true});
  time.mockReturnValue(2000000001001);
  expect(await (await s.request("account", cookie)).json()).toMatchObject({active: false});
  s.status.expires = null;
  time.mockReturnValue(2000000006002);
  expect(await (await s.request("account", cookie)).json()).toMatchObject({active: true});
});

test("billing routes are only served on the canonical origin and all responses are uncacheable", async () => {
  const s = setup();
  const foreign = await handleBilling(new Request("https://evil.example/v1/billing/account"), s.env);
  expect(foreign!.status).toBe(403);
  expect(await handleBilling(new Request("https://classifier.dev/v1/classify"), s.env)).toBeNull();
  const login = await s.call("login");
  expect(login.headers.get("Cache-Control")).toBe("no-store");
  expect((await s.request("account")).headers.get("Cache-Control")).toBe("no-store");
});
