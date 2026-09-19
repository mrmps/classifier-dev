/**
 * A WorkOS AuthKit stand-in for billing tests. The real SDK runs against mocked HTTP: JWTs are RS256-signed
 * with a key served from a JWKS fixture, PKCE verifiers are checked against the challenge the login redirect
 * carried, authorization codes and refresh tokens are single use, and sessions can be revoked or expired.
 */
import { expect, spyOn } from "bun:test";
import { BillingAccount, handleBilling, type BillingEnv } from "../src/billing";

export const CLIENT_ID = "client_test_01";
export const ISSUER = `https://api.workos.com/user_management/${CLIENT_ID}`;
export const ORIGIN = "https://classifier.dev";
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("");
const base64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const sha256 = async (text: string) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
const random = () => hex(crypto.getRandomValues(new Uint8Array(16)).buffer);

const generate = () => crypto.subtle.generateKey({name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"}, true, ["sign", "verify"]);
/** The key behind the JWKS, and a rogue key the JWKS never lists. */
const keys = await generate(), rogue = await generate();
const jwk = {...await crypto.subtle.exportKey("jwk", keys.publicKey), kid: "key_01", alg: "RS256", use: "sig"};
export async function signJwt(claims: Record<string, unknown>, expiresIn = 300, options: {rogue?: boolean; kid?: string} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(encoder.encode(JSON.stringify({alg: "RS256", kid: options.kid ?? "key_01", typ: "JWT"})));
  const payload = base64url(encoder.encode(JSON.stringify({iss: ISSUER, iat: now, exp: now + expiresIn, ...claims})));
  const key = (options.rogue ? rogue : keys).privateKey;
  return `${head}.${payload}.${base64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(`${head}.${payload}`)))}`;
}
/** The legacy account ID: the keyed hash of the normalized email, exactly as the worker computes it. */
export async function legacyId(email: string, signingKey = "test-billing-secret") {
  const key = await crypto.subtle.importKey("raw", encoder.encode(signingKey), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(email)));
}
export const cookieOf = (response: Response, name: string) => response.headers.getSetCookie().find(c => c.startsWith(`${name}=`));
export const cookieValue = (response: Response, name: string) => cookieOf(response, name)?.split(";")[0];

type WorkOSSession = {id: string; user_id: string; status: "active" | "expired" | "revoked"; expires_at: string; created_at: string};
export function setup() {
  const data = new Map<string, unknown>();
  const instances = new Map<string, BillingAccount>();
  const status = {active: true, pastDue: false, expires: null as number | null};
  let calls = 0, fail = false;
  /** Each fixture has its own API key, so each gets its own SDK client bound to this fixture's fetch. */
  const apiKey = `sk_test_${random()}`;
  const workos = {
    user: {id: "user_01AAA", email: "Customer@example.com", email_verified: true},
    tokenTtl: 300, issuer: ISSUER, pageSize: 100,
    /** Extra or overriding claims for issued tokens; a rogue signing key; the key ID tokens name. */
    claims: {} as Record<string, unknown>, rogue: false, kid: "key_01",
    /** Non-zero: the status WorkOS answers with for that call. */
    refreshStatus: 0, sessionsStatus: 0, revokeStatus: 0, exchangeStatus: 0,
    challenges: new Map<string, string>(), refreshTokens: new Map<string, string>(), sessions: [] as WorkOSSession[],
    exchanges: [] as Record<string, unknown>[], revoked: [] as string[],
  };
  const env: BillingEnv = {
    BILLING_SIGNING_KEY: "test-billing-secret", AUTUMN_SECRET_KEY: "test-autumn",
    WORKOS_API_KEY: apiKey, WORKOS_CLIENT_ID: CLIENT_ID, WORKOS_COOKIE_PASSWORD: "cookie-password-for-tests-0123456789", WORKOS_REDIRECT_URI: `${ORIGIN}/v1/billing/callback`,
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
  const failure = (code: number) => Response.json(code === 400 ? {error: "invalid_grant", error_description: "PRIVATE PROVIDER DETAILS"} : {message: "PRIVATE PROVIDER DETAILS", code: "private"}, {status: code});
  const issue = async (userId: string, sid: string) => {
    const refresh = `rt_${random()}`;
    workos.refreshTokens.set(refresh, sid);
    const user = {object: "user", ...workos.user, first_name: null, last_name: null, name: null, profile_picture_url: null, last_sign_in_at: null, locale: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z"};
    const accessToken = await signJwt({iss: workos.issuer, sub: userId, sid, ...workos.claims}, workos.tokenTtl, {rogue: workos.rogue, kid: workos.kid});
    return Response.json({user: {...user, id: userId}, access_token: accessToken, refresh_token: refresh, organization_id: null, authentication_method: "MagicAuth"});
  };
  const api = async (url: URL, method: string, text: string, headers: Headers): Promise<Response> => {
    if (method === "GET" && url.pathname === `/sso/jwks/${CLIENT_ID}`) return Response.json({keys: [jwk]});
    if (headers.get("Authorization") !== `Bearer ${apiKey}`) return Response.json({message: "Unauthorized"}, {status: 401});
    if (method === "POST" && url.pathname === "/user_management/authenticate") {
      const input = JSON.parse(text);
      if (input.client_id !== CLIENT_ID || input.client_secret !== apiKey) return Response.json({message: "Unauthorized"}, {status: 401});
      if (input.grant_type === "authorization_code") {
        workos.exchanges.push(input);
        if (workos.exchangeStatus) return failure(workos.exchangeStatus);
        const challenge = workos.challenges.get(input.code);
        workos.challenges.delete(input.code);
        if (!challenge || typeof input.code_verifier !== "string" || base64url(await crypto.subtle.digest("SHA-256", encoder.encode(input.code_verifier))) !== challenge) return failure(400);
        const sid = `session_${random()}`;
        workos.sessions.push({id: sid, user_id: workos.user.id, status: "active", expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), created_at: new Date().toISOString()});
        return issue(workos.user.id, sid);
      }
      if (input.grant_type === "refresh_token") {
        if (workos.refreshStatus) return failure(workos.refreshStatus);
        const sid = workos.refreshTokens.get(input.refresh_token);
        workos.refreshTokens.delete(input.refresh_token);
        const session = workos.sessions.find(s => s.id === sid);
        if (!session || session.status !== "active") return failure(400);
        return issue(session.user_id, session.id);
      }
      return failure(400);
    }
    const sessions = /^\/user_management\/users\/([^/]+)\/sessions$/.exec(url.pathname);
    if (method === "GET" && sessions) {
      if (workos.sessionsStatus) return failure(workos.sessionsStatus);
      const all = workos.sessions.filter(s => s.user_id === decodeURIComponent(sessions[1])).reverse();
      const after = url.searchParams.get("after");
      const start = after ? all.findIndex(s => s.id === after) + 1 : 0;
      const limit = Math.min(Number(url.searchParams.get("limit") || 10), workos.pageSize);
      const page = all.slice(start, start + limit);
      const next = start + limit < all.length ? page[page.length - 1].id : null;
      return Response.json({object: "list", data: page.map(s => ({object: "session", ...s, ip_address: null, user_agent: null, auth_method: "magic_auth", ended_at: null, updated_at: s.created_at})), list_metadata: {before: null, after: next}});
    }
    if (method === "POST" && url.pathname === "/user_management/sessions/revoke") {
      if (workos.revokeStatus) return failure(workos.revokeStatus);
      const {session_id} = JSON.parse(text);
      workos.revoked.push(session_id);
      const session = workos.sessions.find(s => s.id === session_id);
      if (!session) return Response.json({message: "Session not found", code: "not_found"}, {status: 404});
      session.status = "revoked";
      return new Response(null, {status: 200});
    }
    return Response.json({message: "Not found"}, {status: 404});
  };
  spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const text = typeof init?.body === "string" ? init.body : "";
    if (url.hostname === "api.workos.com") return api(url, method, text, new Headers(init?.headers as HeadersInit));
    const body = JSON.parse(text);
    if (fail) return Response.json({error: "PRIVATE PROVIDER DETAILS"}, {status: 500});
    if (url.pathname.endsWith("customers.get_or_create")) return Response.json({id: body.customer_id});
    if (url.pathname.endsWith("customers.get")) {
      calls++;
      return Response.json({subscriptions: status.active ? [{plan_id: "pro", status: "active", past_due: status.pastDue, expires_at: status.expires, canceled_at: 123}] : []});
    }
    if (url.pathname.endsWith("billing.attach")) {
      expect(body.redirect_mode).toBe("always"); expect(body.plan_id).toBe("pro");
      return Response.json({payment_url: "https://checkout.stripe.com/session"});
    }
    return Response.json({url: "https://billing.stripe.com/session"});
  });
  const call = (path: string, init: {method?: string; cookie?: string; origin?: string; body?: string} = {}) => handleBilling(new Request(`${ORIGIN}/v1/billing/${path}`, {
    method: init.method ?? "GET", headers: {...(init.origin ? {Origin: init.origin} : {}), ...(init.cookie ? {Cookie: init.cookie} : {})}, ...(init.body !== undefined ? {body: init.body} : {}),
  }), env).then(response => response!);
  /** What the /pro page does: GET for account, an empty JSON POST for everything else. */
  const request = (action: string, cookie?: string, origin = ORIGIN) => call(action, action === "account" ? {cookie} : {method: "POST", cookie, origin, body: "{}"});
  /** GET /login, then play WorkOS: remember the PKCE challenge behind a fresh authorization code. */
  const login = async () => {
    const response = await call("login");
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("Location")!);
    const code = `code_${random()}`;
    workos.challenges.set(code, location.searchParams.get("code_challenge")!);
    return {location, cookie: cookieValue(response, "classifier_oauth")!, state: location.searchParams.get("state")!, code, response};
  };
  const callback = (code: string, state: string, cookie?: string) => call(`callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, {cookie});
  const signIn = async () => {
    const started = await login();
    const response = await callback(started.code, started.state, started.cookie);
    expect(response.status).toBe(303);
    return cookieValue(response, "classifier_auth")!;
  };
  return {env, apiKey, workos, data, status, call, request, login, callback, signIn, get calls() {return calls;}, set fail(value: boolean) {fail = value;}};
}
