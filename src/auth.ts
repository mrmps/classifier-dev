import { NotFoundException, WorkOS, type User } from "@workos-inc/node/worker";
import type { ErrorCode } from "./openapi";

/** Browser sign-in for billing: hosted WorkOS AuthKit with SDK-sealed session cookies. API keys never touch this module. */
export interface AuthEnv {
  WORKOS_API_KEY?: string;
  WORKOS_CLIENT_ID?: string;
  WORKOS_COOKIE_PASSWORD?: string;
  WORKOS_REDIRECT_URI?: string;
}
export class BillingError extends Error {
  get code(): ErrorCode { return this.status === 401 ? "invalid_pro_key" : this.status === 403 ? "pro_inactive" : this.status === 503 ? "billing_unavailable" : "billing_error"; }
  constructor(public status: number, message: string) { super(message); }
}
export const unavailable = () => new BillingError(503, "Billing is temporarily unavailable. Please try again.");
export const unauthorized = () => new BillingError(401, "Sign in again to continue.");

export const SESSION_COOKIE = "classifier_auth";
/** The pre-AuthKit cookie. Never read; cleared on sign-out so stale copies do not linger. */
export const LEGACY_COOKIE = "classifier_session";
const OAUTH_COOKIE = "classifier_oauth";
const OAUTH_SECONDS = 600;
/** A cap on how long the browser keeps the sealed session; WorkOS decides when the session itself expires. */
const SESSION_SECONDS = 30 * 86400;
const TIMEOUT = 10000;
const encoder = new TextEncoder();

export function cookie(name: string, value: string, seconds: number) {
  return `${name}=${value}; Path=/v1/billing; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
}
export const clearCookie = (name: string) => cookie(name, "", 0);
export const sessionCookie = (sealed: string) => cookie(SESSION_COOKIE, sealed, SESSION_SECONDS);
export function readCookie(req: Request, name: string): string | undefined {
  return req.headers.get("Cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1) || undefined;
}
const base64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - text.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}
/** Claims of a token whose signature the SDK verified, or whose sealed container we authenticated. */
function claims(token: string): Record<string, unknown> {
  try {
    const value = JSON.parse(new TextDecoder().decode(fromBase64url(token.split(".")[1] || "")));
    return value && typeof value === "object" ? value : {};
  } catch { return {}; }
}

/** One client per isolate keeps the JWKS cached across requests. */
let cached: {id: string; workos: WorkOS} | undefined;
function config(env: AuthEnv) {
  const {WORKOS_API_KEY: apiKey, WORKOS_CLIENT_ID: clientId, WORKOS_COOKIE_PASSWORD: cookiePassword} = env;
  if (!apiKey || !clientId || !cookiePassword || cookiePassword.length < 32) throw unavailable();
  const id = `${apiKey}\n${clientId}`;
  if (cached?.id !== id) {
    // The worker build only forwards `config` to its fetch client, so the timeout is set there too.
    const fetchConfig: RequestInit & {timeout?: number} = {timeout: TIMEOUT};
    cached = {id, workos: new WorkOS(apiKey, {clientId, timeout: TIMEOUT, maxRetries: 0, config: fetchConfig})};
  }
  const workos = cached.workos;
  return {workos, clientId, cookiePassword, issuer: `${workos.baseURL}/user_management/${clientId}`};
}
type Pin = {issuer: string; clientId: string; userId: string; sessionId?: string};
/**
 * The SDK checks signature and expiry; issuer, subject and session are ours to pin. `aud` and `client_id` are
 * checked when present. Returns the session ID, or null when any claim disagrees.
 */
function sessionClaim(token: string, pin: Pin): string | null {
  const c = claims(token);
  if (c.iss !== pin.issuer || c.sub !== pin.userId || typeof c.sid !== "string" || !c.sid) return null;
  if (pin.sessionId !== undefined && c.sid !== pin.sessionId) return null;
  if (c.client_id !== undefined && c.client_id !== pin.clientId) return null;
  if (c.aud !== undefined && !(c.aud === pin.clientId || (Array.isArray(c.aud) && c.aud.includes(pin.clientId)))) return null;
  return c.sid;
}
const status = (error: unknown) => error && typeof error === "object" && typeof (error as {status?: unknown}).status === "number" ? (error as {status: number}).status : undefined;
/** A rejected credential is 401; outages, rate limits and our own API key being refused are 503. Details never leave. */
function providerFailure(error: unknown): BillingError {
  if (error instanceof BillingError) return error;
  const code = status(error);
  if (code !== undefined && code >= 400 && code < 500 && ![401, 408, 429].includes(code)) return unauthorized();
  return unavailable();
}
async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign", "verify"]);
}

/** Starts hosted sign-in. The returned cookie binds the CSRF state and PKCE verifier to this browser for ten minutes. */
export async function beginLogin(env: AuthEnv, origin: string): Promise<{url: string; cookie: string}> {
  const {workos, clientId, cookiePassword} = config(env);
  const redirectUri = `${origin}/v1/billing/callback`;
  if (env.WORKOS_REDIRECT_URI !== redirectUri) throw unavailable();
  const {url, state, codeVerifier} = await workos.userManagement.getAuthorizationUrlWithPKCE({provider: "authkit", redirectUri, clientId});
  const payload = base64url(encoder.encode(JSON.stringify({state, verifier: codeVerifier, expires: Date.now() + OAUTH_SECONDS * 1000})));
  const signature = base64url(await crypto.subtle.sign("HMAC", await hmacKey(cookiePassword), encoder.encode(payload)));
  return {url, cookie: cookie(OAUTH_COOKIE, `${payload}.${signature}`, OAUTH_SECONDS)};
}
export const clearLoginCookie = () => clearCookie(OAUTH_COOKIE);
async function openLoginCookie(env: AuthEnv, raw: string | undefined): Promise<{state: string; verifier: string} | null> {
  const [payload, signature, extra] = (raw || "").split(".");
  if (!payload || !signature || extra !== undefined) return null;
  try {
    if (!await crypto.subtle.verify("HMAC", await hmacKey(env.WORKOS_COOKIE_PASSWORD!), fromBase64url(signature), encoder.encode(payload))) return null;
    const value = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    if (typeof value?.state !== "string" || typeof value.verifier !== "string" || typeof value.expires !== "number" || value.expires <= Date.now()) return null;
    return {state: value.state, verifier: value.verifier};
  } catch { return null; }
}

/** Finishes hosted sign-in: state must match this browser's cookie, then the code and PKCE verifier are exchanged. */
export async function completeLogin(req: Request, env: AuthEnv): Promise<{user: User; sealedSession: string}> {
  const {workos, clientId, cookiePassword, issuer} = config(env);
  const url = new URL(req.url);
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  const login = await openLoginCookie(env, readCookie(req, OAUTH_COOKIE));
  if (!code || !state || !login || login.state !== state) throw new BillingError(400, "Sign-in could not be verified. Start again from /pro.");
  let result;
  try {
    result = await workos.userManagement.authenticateWithCode({code, codeVerifier: login.verifier, clientId, session: {sealSession: true, cookiePassword}});
  } catch (error) { throw providerFailure(error); }
  if (!result.sealedSession || typeof result.user?.id !== "string" || typeof result.user.email !== "string") throw unavailable();
  if (!sessionClaim(result.accessToken, {issuer, clientId, userId: result.user.id})) throw unauthorized();
  return {user: result.user, sealedSession: result.sealedSession};
}

export type Session = {userId: string; email: string; sessionId: string};
/**
 * Authenticates the sealed session cookie. Expired access tokens are refreshed once; a refreshed cookie or a
 * cleared one is appended to `cookies` so every response, including failures, carries it. Retryable provider
 * failures keep the cookie and answer 503. The session must still be active at WorkOS: revocation is immediate.
 */
export async function authenticateSession(req: Request, env: AuthEnv, cookies: string[]): Promise<Session> {
  const {workos, clientId, cookiePassword, issuer} = config(env);
  const deny = () => { cookies.splice(0, cookies.length, clearCookie(SESSION_COOKIE)); return unauthorized(); };
  const sessionData = readCookie(req, SESSION_COOKIE);
  if (!sessionData) throw deny();
  let unsealed;
  try { unsealed = await workos.userManagement.getSessionFromCookie({sessionData, cookiePassword}); } catch { throw deny(); }
  if (!unsealed?.accessToken || typeof unsealed.user?.id !== "string") throw deny();
  const session = workos.userManagement.loadSealedSession({sessionData, cookiePassword});
  let auth;
  try { auth = await session.authenticate(); } catch { throw unavailable(); }
  if (!auth.authenticated && auth.reason === "invalid_jwt") {
    let refreshed;
    try { refreshed = await session.refresh(); } catch { throw unavailable(); }
    if (!refreshed.authenticated) throw refreshed.retryable ? unavailable() : deny();
    if (!refreshed.sealedSession) throw unavailable();
    cookies.push(sessionCookie(refreshed.sealedSession));
    // The refresh result's own `user` is the pre-refresh snapshot. The new sealed cookie carries the fresh user
    // and its token gets the same signature check as any other; a JWKS problem here keeps the refreshed cookie.
    try { auth = await workos.userManagement.loadSealedSession({sessionData: refreshed.sealedSession, cookiePassword}).authenticate(); }
    catch { throw unavailable(); }
  }
  if (!auth.authenticated) throw deny();
  const {user, sessionId, accessToken} = auth;
  if (typeof user?.id !== "string" || typeof user.email !== "string" || typeof sessionId !== "string" || !sessionId) throw deny();
  if (!sessionClaim(accessToken, {issuer, clientId, userId: user.id, sessionId})) throw deny();
  if (!await sessionActive(workos, user.id, sessionId)) throw deny();
  return {userId: user.id, email: user.email, sessionId};
}
async function sessionActive(workos: WorkOS, userId: string, sessionId: string): Promise<boolean> {
  let after: string | null | undefined;
  for (let page = 0; page < 10; page++) {
    let list;
    try { list = await workos.userManagement.listSessions(userId, {limit: 100, ...(after ? {after} : {})}); }
    catch (error) { if (error instanceof NotFoundException) return false; throw unavailable(); }
    const found = list.data.find(s => s.id === sessionId);
    if (found) return found.userId === userId && found.status === "active" && Date.parse(found.expiresAt) > Date.now();
    after = list.listMetadata?.after;
    if (!after) return false;
  }
  return false;
}

/**
 * Revokes the session named in our own sealed cookie and returns the hosted sign-out URL. A missing or unusable
 * cookie, or a session WorkOS no longer has, just clears cookies and returns /pro; any other failure keeps the
 * cookie and answers 503 so nothing is claimed revoked.
 */
export async function endSession(req: Request, env: AuthEnv, origin: string, cookies: string[]): Promise<string> {
  const returnTo = `${origin}/pro`;
  cookies.push(clearCookie(SESSION_COOKIE), clearCookie(LEGACY_COOKIE));
  const sessionData = readCookie(req, SESSION_COOKIE);
  if (!sessionData) return returnTo;
  const {workos, clientId, cookiePassword, issuer} = config(env);
  let sessionId: string | null;
  try {
    const unsealed = await workos.userManagement.getSessionFromCookie({sessionData, cookiePassword});
    if (!unsealed?.accessToken || typeof unsealed.user?.id !== "string") return returnTo;
    sessionId = sessionClaim(unsealed.accessToken, {issuer, clientId, userId: unsealed.user.id});
  } catch { return returnTo; }
  if (!sessionId) return returnTo;
  try { await workos.userManagement.revokeSession({sessionId}); }
  catch (error) {
    if (status(error) === 404 || status(error) === 410) return returnTo;
    cookies.length = 0;
    throw unavailable();
  }
  return workos.userManagement.getLogoutUrl({sessionId, returnTo});
}
