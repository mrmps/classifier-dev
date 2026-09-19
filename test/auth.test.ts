import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { authenticatePro } from "../src/billing";
import { cookieOf, cookieValue, legacyId, setup, sha256 } from "./workos-fixture";

afterEach(() => mock.restore());
const cleared = (response: Response, name: string) => expect(cookieOf(response, name)).toMatch(new RegExp(`^${name}=; Path=/v1/billing; HttpOnly; Secure; SameSite=Lax; Max-Age=0$`));
const stored = (s: ReturnType<typeof setup>) => JSON.stringify([...s.data.values()]);

test("login redirects to hosted AuthKit with PKCE and binds the state to a short-lived cookie", async () => {
  const s = setup();
  const {location, response} = await s.login();
  expect(location.origin).toBe("https://api.workos.com");
  expect(location.pathname).toBe("/user_management/authorize");
  expect(Object.fromEntries(location.searchParams)).toMatchObject({client_id: "client_test_01", provider: "authkit", response_type: "code", code_challenge_method: "S256", redirect_uri: "https://classifier.dev/v1/billing/callback"});
  expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(location.href).not.toContain("sk_test");
  expect(cookieOf(response, "classifier_oauth")).toMatch(/^classifier_oauth=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Path=\/v1\/billing; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  s.env.WORKOS_REDIRECT_URI = "https://classifier.dev/v1/billing/other";
  expect((await s.call("login")).status).toBe(503);
  s.env.WORKOS_REDIRECT_URI = "https://classifier.dev/v1/billing/callback"; s.env.WORKOS_COOKIE_PASSWORD = "short";
  expect((await s.call("login")).status).toBe(503);
});

test("callback rejects missing, foreign, tampered and expired state without touching the provider", async () => {
  const time = spyOn(Date, "now").mockReturnValue(2000000000000);
  const s = setup();
  const first = await s.login(), second = await s.login();
  const [payload, signature] = first.cookie.slice("classifier_oauth=".length).split(".");
  const tampered = `classifier_oauth=${payload}.${signature.slice(0, -2)}${signature.endsWith("AA") ? "BB" : "AA"}`;
  const attempts = [
    s.callback(first.code, first.state),
    s.callback(first.code, "", first.cookie),
    s.callback(first.code, second.state, first.cookie),
    s.callback(first.code, first.state, second.cookie),
    s.callback(first.code, first.state, tampered),
    s.callback("", first.state, first.cookie),
  ];
  for (const response of await Promise.all(attempts)) {
    expect(response.status).toBe(400);
    expect(cookieOf(response, "classifier_auth")).toBeUndefined();
    cleared(response, "classifier_oauth");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
  time.mockReturnValue(2000000000000 + 600001);
  expect((await s.callback(first.code, first.state, first.cookie)).status).toBe(400);
  expect(s.workos.exchanges).toHaveLength(0);
  expect(s.data.size).toBe(0);
});

test("callback exchanges the code with the PKCE verifier and seals a session only after a verified exchange", async () => {
  const s = setup();
  const started = await s.login();
  const response = await s.callback(started.code, started.state, started.cookie);
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe("https://classifier.dev/pro");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(s.workos.exchanges).toHaveLength(1);
  expect(s.workos.exchanges[0]).toMatchObject({grant_type: "authorization_code", code: started.code, client_id: "client_test_01"});
  expect(s.workos.exchanges[0].code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  const cookie = cookieOf(response, "classifier_auth")!;
  expect(cookie).toMatch(/^classifier_auth=Fe26\.2\*[^;]+; Path=\/v1\/billing; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/);
  expect(cookie).not.toContain("eyJ");
  cleared(response, "classifier_oauth");
  expect((await s.request("account", cookie.split(";")[0])).status).toBe(200);
  // The code is single use at WorkOS; replaying the callback cannot mint a second session.
  const replay = await s.callback(started.code, started.state, started.cookie);
  expect(replay.status).toBe(401);
  expect(cookieOf(replay, "classifier_auth")).toBeUndefined();
  for (const [status, expected] of [[400, 401], [500, 503]] as const) {
    s.workos.exchangeStatus = status;
    const fresh = await s.login();
    const failed = await s.callback(fresh.code, fresh.state, fresh.cookie);
    expect(failed.status).toBe(expected);
    expect(cookieOf(failed, "classifier_auth")).toBeUndefined();
    cleared(failed, "classifier_oauth");
    expect(await failed.text()).not.toContain("PRIVATE");
  }
});

test("only a verified email can claim the legacy account; its API key keeps working and old credentials are dropped", async () => {
  const s = setup();
  const customerId = await legacyId("customer@example.com"), secret = "a".repeat(64), oldSession = "b".repeat(64);
  s.data.set(`${customerId}account`, {email: "customer@example.com", lastLogin: 1, login: {hash: "x", expires: 9e15}, session: {hash: await sha256(oldSession), expires: 9e15}, apiKeyHash: await sha256(secret)});
  const auth = () => authenticatePro(new Request("https://classifier.dev/v1/classify", {headers: {Authorization: `Bearer classifier_pro_${customerId}.${secret}`}}), s.env);
  expect(await auth()).toMatchObject({customerId, active: true});
  s.workos.user.email_verified = false;
  const started = await s.login();
  const refused = await s.callback(started.code, started.state, started.cookie);
  expect(refused.status).toBe(403);
  expect(cookieOf(refused, "classifier_auth")).toBeUndefined();
  expect(s.data.size).toBe(1);
  expect(s.data.get(`${customerId}account`)).toMatchObject({login: {hash: "x"}});
  s.workos.user.email_verified = true;
  const cookie = await s.signIn();
  expect(s.data.get("workos:user_01AAAidentity")).toEqual({customerId});
  const account = s.data.get(`${customerId}account`) as Record<string, unknown>;
  expect(account).toMatchObject({email: "customer@example.com", workosUserId: "user_01AAA", apiKeyHash: await sha256(secret)});
  expect(Object.keys(account).sort()).toEqual(["apiKeyHash", "email", "workosUserId"]);
  expect(await auth()).toMatchObject({customerId, active: true});
  expect(await (await s.request("account", cookie)).json()).toEqual({email: "customer@example.com", active: true, plan: "pro", hasKey: true});
  expect((await s.request("account", `classifier_session=${customerId}.${oldSession}`)).status).toBe(401);
  expect((await s.request("account", `classifier_session=${customerId}.${oldSession}; ${cookie}`)).status).toBe(200);
});

test("a WorkOS user keeps its customer across email changes and no other user can claim it", async () => {
  const s = setup();
  const first = await s.signIn();
  const key = (await (await s.request("key", first)).json() as {key: string}).key;
  const customerId = key.slice("classifier_pro_".length, "classifier_pro_".length + 64);
  expect(customerId).toBe(await legacyId("customer@example.com"));
  s.workos.user.email = "Renamed@example.com";
  const second = await s.signIn();
  expect(await (await s.request("account", second)).json()).toMatchObject({email: "customer@example.com", hasKey: true});
  const rotated = (await (await s.request("key", second)).json() as {key: string}).key;
  expect(rotated.startsWith(`classifier_pro_${customerId}.`)).toBe(true);
  expect(s.data.has(`${await legacyId("renamed@example.com")}account`)).toBe(false);
  // Another WorkOS user who now owns the original address cannot take the linked account.
  s.workos.user = {id: "user_02BBB", email: "customer@example.com", email_verified: true};
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = await s.login();
    const refused = await s.callback(started.code, started.state, started.cookie);
    expect(refused.status).toBe(403);
    expect(cookieOf(refused, "classifier_auth")).toBeUndefined();
  }
  expect(s.data.get("workos:user_02BBBidentity")).toEqual({candidate: customerId});
  expect(s.data.get(`${customerId}account`)).toMatchObject({workosUserId: "user_01AAA"});
  // A candidate persisted before a crash wins over a later email change, so the account cannot split.
  const older = await legacyId("older@example.com");
  s.data.set("workos:user_03CCCidentity", {candidate: older});
  s.workos.user = {id: "user_03CCC", email: "changed@example.com", email_verified: true};
  const third = await s.signIn();
  expect(s.data.get("workos:user_03CCCidentity")).toEqual({customerId: older});
  expect(s.data.has(`${await legacyId("changed@example.com")}account`)).toBe(false);
  expect(await (await s.request("account", third)).json()).toMatchObject({email: "changed@example.com", hasKey: false});
  expect((await (await s.request("key", third)).json() as {key: string}).key.startsWith(`classifier_pro_${older}.`)).toBe(true);
});

test("expired access tokens refresh once and the new cookie rides on success and on later failures", async () => {
  const s = setup();
  s.workos.tokenTtl = -60;
  const expired = await s.signIn();
  s.workos.tokenTtl = 300;
  const refreshed = await s.request("account", expired);
  expect(refreshed.status).toBe(200);
  const next = cookieValue(refreshed, "classifier_auth")!;
  expect(next).toMatch(/^classifier_auth=Fe26\.2\*/);
  expect(next).not.toBe(expired);
  expect(cookieOf(refreshed, "classifier_auth")).toContain("Max-Age=2592000");
  const settled = await s.request("account", next);
  expect(settled.status).toBe(200);
  expect(settled.headers.getSetCookie()).toEqual([]);
  // The consumed refresh token is terminal for the old cookie.
  const stale = await s.request("account", expired);
  expect(stale.status).toBe(401);
  cleared(stale, "classifier_auth");
  s.workos.tokenTtl = -60;
  const again = await s.signIn();
  s.workos.tokenTtl = 300;
  s.fail = true;
  const outage = await s.request("portal", again);
  expect(outage.status).toBe(503);
  expect(cookieOf(outage, "classifier_auth")).toMatch(/^classifier_auth=Fe26\.2\*.*Max-Age=2592000$/);
  s.fail = false;
  expect((await s.request("account", cookieValue(outage, "classifier_auth")!)).status).toBe(200);
});

test("transient refresh failures keep the session and answer 503; terminal failures sign the user out", async () => {
  const s = setup();
  s.workos.tokenTtl = -60;
  const cookie = await s.signIn();
  s.workos.tokenTtl = 300;
  for (const status of [500, 429, 408]) {
    s.workos.refreshStatus = status;
    const response = await s.request("account", cookie);
    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.text()).not.toContain("PRIVATE");
  }
  s.workos.refreshStatus = 0;
  expect((await s.request("account", cookie)).status).toBe(200);
  s.workos.tokenTtl = -60;
  const another = await s.signIn();
  s.workos.refreshStatus = 400;
  const terminal = await s.request("account", another);
  expect(terminal.status).toBe(401);
  cleared(terminal, "classifier_auth");
  expect(await terminal.text()).not.toContain("PRIVATE");
});

test("a refreshed token is signature-checked again: a forged one signs the user out, an unknown key keeps the new cookie", async () => {
  const s = setup();
  s.workos.tokenTtl = -60;
  const expired = await s.signIn();
  s.workos.tokenTtl = 300; s.workos.rogue = true;
  const forged = await s.request("account", expired);
  expect(forged.status).toBe(401);
  expect(forged.headers.getSetCookie()).toHaveLength(1);
  cleared(forged, "classifier_auth");
  s.workos.rogue = false; s.workos.tokenTtl = -60;
  const again = await s.signIn();
  s.workos.tokenTtl = 300; s.workos.kid = "key_rotated";
  const unknown = await s.request("account", again);
  expect(unknown.status).toBe(503);
  expect(cookieOf(unknown, "classifier_auth")).toMatch(/^classifier_auth=Fe26\.2\*.*Max-Age=2592000$/);
  expect(await unknown.text()).not.toContain("PRIVATE");
});

test("revoked and expired WorkOS sessions are denied; a session lookup outage does not sign the user out", async () => {
  const s = setup();
  const cookie = await s.signIn();
  s.workos.sessionsStatus = 500;
  const outage = await s.request("account", cookie);
  expect(outage.status).toBe(503);
  expect(outage.headers.getSetCookie()).toEqual([]);
  s.workos.sessionsStatus = 0;
  // Newer sessions push the current one onto a later page; it is still found.
  for (let i = 0; i < 120; i++) s.workos.sessions.push({id: `session_newer_${i}`, user_id: "user_01AAA", status: "active", expires_at: new Date(Date.now() + 86400000).toISOString(), created_at: new Date().toISOString()});
  expect((await s.request("account", cookie)).status).toBe(200);
  s.workos.sessions[0].status = "revoked";
  const revoked = await s.request("account", cookie);
  expect(revoked.status).toBe(401);
  cleared(revoked, "classifier_auth");
  const second = await s.signIn();
  s.workos.sessions[s.workos.sessions.length - 1].expires_at = new Date(Date.now() - 1000).toISOString();
  expect((await s.request("account", second)).status).toBe(401);
  const third = await s.signIn();
  s.workos.sessions[s.workos.sessions.length - 1].user_id = "user_someone_else";
  expect((await s.request("account", third)).status).toBe(401);
});

test("tokens from another issuer and tampered cookies are rejected", async () => {
  const s = setup();
  s.workos.issuer = "https://evil.example/user_management/client_test_01";
  const started = await s.login();
  const foreign = await s.callback(started.code, started.state, started.cookie);
  expect(foreign.status).toBe(401);
  expect(cookieOf(foreign, "classifier_auth")).toBeUndefined();
  expect(s.data.size).toBe(0);
  s.workos.issuer = "https://api.workos.com/user_management/client_test_01";
  // Signed by the real key, but naming another client, audience or subject.
  for (const claims of [{aud: "client_other"}, {aud: ["client_other"]}, {client_id: "client_other"}, {sub: "user_other"}]) {
    s.workos.claims = claims;
    const started = await s.login();
    const rejected = await s.callback(started.code, started.state, started.cookie);
    expect(rejected.status).toBe(401);
    expect(cookieOf(rejected, "classifier_auth")).toBeUndefined();
  }
  expect(s.data.size).toBe(0);
  s.workos.claims = {aud: ["client_test_01"], client_id: "client_test_01"};
  expect((await s.request("account", await s.signIn())).status).toBe(200);
  s.workos.claims = {};
  const cookie = await s.signIn();
  const flipped = cookie.slice(0, -4) + (cookie.endsWith("aaaa") ? "bbbb" : "aaaa");
  for (const bad of [flipped, "classifier_auth=garbage", "classifier_auth="]) {
    const response = await s.request("account", bad);
    expect(response.status).toBe(401);
    cleared(response, "classifier_auth");
  }
  expect((await s.request("account", cookie)).status).toBe(200);
});

test("sign-out revokes the WorkOS session, clears both cookies and returns the hosted sign-out URL", async () => {
  const s = setup();
  const cookie = await s.signIn();
  const sessionId = s.workos.sessions[0].id;
  const response = await s.request("logout", cookie);
  expect(response.status).toBe(200);
  const {url} = await response.json() as {url: string};
  const target = new URL(url);
  expect(target.origin + target.pathname).toBe("https://api.workos.com/user_management/sessions/logout");
  expect(Object.fromEntries(target.searchParams)).toEqual({session_id: sessionId, return_to: "https://classifier.dev/pro"});
  expect(s.workos.revoked).toEqual([sessionId]);
  cleared(response, "classifier_auth"); cleared(response, "classifier_session");
  expect((await s.request("account", cookie)).status).toBe(401);
  for (const absent of [undefined, "classifier_auth=garbage", "classifier_session=" + "c".repeat(64) + "." + "d".repeat(64)]) {
    const signedOut = await s.request("logout", absent);
    expect(await signedOut.json()).toEqual({url: "https://classifier.dev/pro"});
    cleared(signedOut, "classifier_auth"); cleared(signedOut, "classifier_session");
  }
  expect(s.workos.revoked).toHaveLength(1);
  // Sign-out works from an expired access token: the sealed cookie names the session.
  s.workos.tokenTtl = -60;
  const expired = await s.signIn();
  for (const status of [500, 400, 401]) {
    s.workos.revokeStatus = status;
    const failed = await s.request("logout", expired);
    expect(failed.status).toBe(503);
    expect(failed.headers.getSetCookie()).toEqual([]);
    expect(await failed.text()).not.toContain("PRIVATE");
  }
  s.workos.revokeStatus = 404;
  const gone = await s.request("logout", expired);
  expect(await gone.json()).toEqual({url: "https://classifier.dev/pro"});
  cleared(gone, "classifier_auth");
  s.workos.revokeStatus = 0;
  const later = await s.signIn();
  expect(new URL((await (await s.request("logout", later)).json() as {url: string}).url).searchParams.get("session_id")).toBe(s.workos.sessions[s.workos.sessions.length - 1].id);
  expect((await s.request("logout", later, "https://evil.example")).status).toBe(403);
  expect(stored(s)).not.toContain("sk_test");
});
