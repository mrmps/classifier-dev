import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { adminResponse } from "../src/admin";
import type { Env } from "../src/index";

const PASSWORD = "correct horse battery staple";
const env = { ADMIN_PASSWORD: PASSWORD, ADMIN_SIGNING_KEY: "signing-key-under-test" } as unknown as Env;
const IP = "203.0.113.47";

const get = (url = "https://classifier.dev/admin", headers: Record<string, string> = {}) =>
  new Request(url, { headers });

const post = (
  password: string,
  headers: Record<string, string> = { origin: "https://classifier.dev" },
  csrf?: string,
) => {
  const body = new FormData();
  body.set("password", password);
  if (csrf !== undefined) body.set("csrf", csrf);
  return new Request("https://classifier.dev/admin", { method: "POST", body, headers });
};

/** The token the login page just handed out, and the cookie that must come back with it. */
async function formToken(res: Response) {
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("__Secure-cd_csrf="))!;
  const value = setCookie.slice(setCookie.indexOf("=") + 1, setCookie.indexOf(";"));
  const inField = (await res.text()).match(/name="csrf" value="([0-9a-f]+)"/)![1];
  return { value, inField, cookie: `__Secure-cd_csrf=${value}` };
}

const session = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("__Secure-cd_admin="));

/** The dashboard queries Analytics Engine; here it never answers, and every panel is empty. */
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async () => new Response("no", { status: 500 })) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

async function signIn() {
  const res = (await adminResponse(post(PASSWORD), env, "admin", IP))!;
  const cookie = session(res)!;
  return cookie.slice(0, cookie.indexOf(";"));
}

describe("routing", () => {
  test("every other path is somebody else's problem", async () => {
    expect(await adminResponse(get("https://classifier.dev/"), env, "", IP)).toBeNull();
    expect(await adminResponse(get("https://classifier.dev/docs"), env, "docs", IP)).toBeNull();
  });

  test("with no password configured the route does not exist", async () => {
    expect(await adminResponse(get(), {} as Env, "admin", IP)).toBeNull();
  });
});

describe("the door", () => {
  test("no cookie, no dashboard", async () => {
    const res = (await adminResponse(get(), env, "admin", IP))!;
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain("password");
    expect(body).not.toContain("requests");
  });

  test("a wrong password is a wrong password", async () => {
    const res = (await adminResponse(post("hunter2"), env, "admin", IP))!;
    expect(res.status).toBe(401);
    expect(session(res)).toBeUndefined();
  });

  test("a cross-site form post is refused before the password is read", async () => {
    const res = (await adminResponse(post(PASSWORD, { origin: "https://evil.example" }), env, "admin", IP))!;
    expect(res.status).toBe(403);
    expect(session(res)).toBeUndefined();
  });

  test("a stated origin that does not match is refused even holding a good token", async () => {
    const page = (await adminResponse(get(), env, "admin", IP))!;
    const { inField, cookie } = await formToken(page);
    const res = (await adminResponse(
      post(PASSWORD, { origin: "https://evil.example", cookie }, inField),
      env,
      "admin",
      IP,
    ))!;
    expect(res.status).toBe(403);
    expect(session(res)).toBeUndefined();
  });

  test("a post with no origin and no token is refused too", async () => {
    const res = (await adminResponse(post(PASSWORD, {}), env, "admin", IP))!;
    expect(res.status).toBe(403);
    expect(session(res)).toBeUndefined();
  });

  test("a browser that strips Origin still gets in with the form's token", async () => {
    const page = (await adminResponse(get(), env, "admin", IP))!;
    const { value, inField, cookie } = await formToken(page);
    expect(inField).toBe(value);
    const res = (await adminResponse(post(PASSWORD, { cookie }, inField), env, "admin", IP))!;
    expect(res.status).toBe(302);
    expect(session(res)).toContain("__Secure-cd_admin=");
  });

  test("the token is worthless without the cookie it was paired with", async () => {
    const page = (await adminResponse(get(), env, "admin", IP))!;
    const { inField } = await formToken(page);
    const res = (await adminResponse(post(PASSWORD, {}, inField), env, "admin", IP))!;
    expect(res.status).toBe(403);
    expect(session(res)).toBeUndefined();
  });

  test("one visitor's token does not open another's cookie", async () => {
    const mine = await formToken((await adminResponse(get(), env, "admin", IP))!);
    const theirs = await formToken((await adminResponse(get(), env, "admin", IP))!);
    expect(mine.value).not.toBe(theirs.value);
    const res = (await adminResponse(post(PASSWORD, { cookie: mine.cookie }, theirs.inField), env, "admin", IP))!;
    expect(res.status).toBe(403);
  });

  test("every login page hands out a token cookie a cross-site post cannot carry", async () => {
    const res = (await adminResponse(get(), env, "admin", IP))!;
    const c = res.headers.getSetCookie().find((x) => x.startsWith("__Secure-cd_csrf="))!;
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Path=/admin");
  });

  test("a stale session is cleared without taking the next attempt's token with it", async () => {
    const res = (await adminResponse(get("https://classifier.dev/admin", {
      cookie: `__Secure-cd_admin=${Date.now() + 60_000}.deadbeef`,
    }), env, "admin", IP))!;
    const cookies = res.headers.getSetCookie();
    expect(cookies.find((c) => c.startsWith("__Secure-cd_admin="))).toContain("Max-Age=0");
    expect(cookies.find((c) => c.startsWith("__Secure-cd_csrf="))).toBeDefined();
    const { inField, cookie } = await formToken(res);
    const next = (await adminResponse(post(PASSWORD, { cookie }, inField), env, "admin", IP))!;
    expect(next.status).toBe(302);
  });

  test("the right password mints a cookie a browser will keep to itself", async () => {
    const res = (await adminResponse(post(PASSWORD), env, "admin", IP))!;
    expect(res.status).toBe(302);
    const cookie = session(res)!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/admin");
    expect(cookie.startsWith("__Secure-")).toBe(true);
    expect(cookie).not.toContain(PASSWORD);
  });

  test("a forged cookie does not open it, and is cleared on the way out", async () => {
    const res = (await adminResponse(get("https://classifier.dev/admin", {
      cookie: `__Secure-cd_admin=${Date.now() + 60_000}.deadbeef`,
    }), env, "admin", IP))!;
    expect(res.status).toBe(401);
    expect(session(res)).toContain("Max-Age=0");
  });

  test("an expired cookie does not open it", async () => {
    const cookie = await signIn();
    const exp = cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf("."));
    const stale = cookie.replace(exp, String(Date.now() - 1000));
    const res = (await adminResponse(get("https://classifier.dev/admin", { cookie: stale }), env, "admin", IP))!;
    expect(res.status).toBe(401);
  });

  test("a session signed for another deployment does not open it", async () => {
    const cookie = await signIn();
    const elsewhere = { ...env, ADMIN_SIGNING_KEY: "some other deployment" } as Env;
    const res = (await adminResponse(get("https://classifier.dev/admin", { cookie }), elsewhere, "admin", IP))!;
    expect(res.status).toBe(401);
  });

  test("signing out clears the cookie", async () => {
    const res = (await adminResponse(get("https://classifier.dev/admin?logout=1"), env, "admin", IP))!;
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("what the page tells the browser", () => {
  test("it is not to be indexed, cached, framed, or blamed in a Referer", async () => {
    const res = (await adminResponse(get(), env, "admin", IP))!;
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  test("the only script that runs is the one this page nonced", async () => {
    const cookie = await signIn();
    const res = (await adminResponse(get("https://classifier.dev/admin", { cookie }), env, "admin", IP))!;
    expect(res.status).toBe(200);
    const nonce = res.headers.get("content-security-policy")!.match(/script-src 'nonce-([^']+)'/)![1];
    const body = await res.text();
    expect(body).toContain(`<script nonce="${nonce}">`);
    expect(body.match(/<script/g)!.length).toBe(1);
  });

  test("the login page is allowed no script at all", async () => {
    const res = (await adminResponse(get(), env, "admin", IP))!;
    expect(res.headers.get("content-security-policy")).toContain("script-src 'none'");
  });

  test("two dashboards never share a nonce", async () => {
    const cookie = await signIn();
    const csp = async () =>
      (await adminResponse(get("https://classifier.dev/admin", { cookie }), env, "admin", IP))!.headers.get(
        "content-security-policy",
      );
    expect(await csp()).not.toBe(await csp());
  });

  test("nothing on the page is a password or a caller's address", async () => {
    const cookie = await signIn();
    const res = (await adminResponse(get("https://classifier.dev/admin", { cookie }), env, "admin", IP))!;
    const body = await res.text();
    expect(body).not.toContain(PASSWORD);
    expect(body).not.toContain(IP);
    expect(body).not.toContain("unique IPs");
  });
});
