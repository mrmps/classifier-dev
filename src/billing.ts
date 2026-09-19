import { callerId, type PrivacyEnv } from "./privacy";
import {
  authenticateSession, beginLogin, BillingError, clearCookie, clearLoginCookie, completeLogin, endSession, SESSION_COOKIE, sessionCookie,
  unauthorized, unavailable, type AuthEnv,
} from "./auth";
import { enqueue, flush, loginNotification, stripeEvent, type NotifyEnv, type Notification } from "./billing-notifications";

export { BillingError } from "./auth";
export interface BillingEnv extends PrivacyEnv, AuthEnv, NotifyEnv {
  BILLING?: DurableObjectNamespace;
  LIMITER: DurableObjectNamespace;
  BILLING_SIGNING_KEY?: string;
  AUTUMN_SECRET_KEY?: string;
  BILLING_ORIGIN?: string;
}
const PLAN = "pro";
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("");
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
const hash = async (text: string) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
function json(data: unknown, status = 200, headers?: HeadersInit) {
  const h = new Headers(headers);
  h.set("Cache-Control", "no-store");
  return Response.json(data, {status, headers: h});
}
function parseCredential(value: string) {
  const match = /^([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(value);
  if (!match) throw unauthorized();
  return {customerId: match[1], secret: match[2]};
}
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!req.body) throw new BillingError(400, "A JSON body is required.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) { await reader.cancel(); throw new BillingError(413, "Request is too large."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof BillingError) throw error;
    throw new BillingError(400, "A valid JSON object is required.");
  }
}
async function autumn(env: BillingEnv, path: string, payload: unknown): Promise<Record<string, any>> {
  if (!env.AUTUMN_SECRET_KEY) throw unavailable();
  try {
    const response = await fetch(`https://api.useautumn.com/v1/${path}`, {method: "POST", signal: AbortSignal.timeout(10000), headers: {
      Authorization: `Bearer ${env.AUTUMN_SECRET_KEY}`, "Content-Type": "application/json", "x-api-version": "2.4.0",
    }, body: JSON.stringify(payload)});
    if (!response.ok) throw unavailable();
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw unavailable();
    return data as Record<string, any>;
  } catch { throw unavailable(); }
}
function safeUrl(value: unknown): string {
  if (typeof value !== "string") throw unavailable();
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !["stripe.com", "useautumn.com"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw unavailable();
    return url.href;
  } catch { throw unavailable(); }
}
/** Legacy account IDs: the same keyed hash of the normalized email, computed once at first sign-in. */
async function accountId(email: string, env: BillingEnv) {
  if (!env.BILLING_SIGNING_KEY) throw unavailable();
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.BILLING_SIGNING_KEY), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(email)));
}
async function durable(env: BillingEnv, name: string, action: string, data: Record<string, unknown>) {
  if (!env.BILLING) throw unavailable();
  try {
    const response = await env.BILLING.get(env.BILLING.idFromName(name)).fetch(new Request(`https://billing/${action}`, {method: "POST", body: JSON.stringify(data)}));
    const result = await response.json() as Record<string, any>;
    if (!response.ok) throw new BillingError(response.status, typeof result.error === "string" ? result.error : "Billing request failed.");
    return result;
  } catch (error) {
    if (error instanceof BillingError) throw error;
    throw unavailable();
  }
}
/** Storage only: the instance named by the event writes a record, and its alarm does the sending. */
const notify = (env: BillingEnv, note: Notification) => durable(env, note.id, "notify", note);
const identityName = (userId: string) => `workos:${userId}`;
/**
 * The customer behind a WorkOS user. A bound identity answers directly and never looks at the email again.
 * A first sign-in with a verified email claims the legacy account for that email (or a fresh one); the candidate
 * is persisted before the claim so a retry after a crash cannot split the account when the email has changed.
 */
async function resolveCustomer(env: BillingEnv, user: {id: string; email: string; emailVerified: boolean}): Promise<string> {
  const identity = await durable(env, identityName(user.id), "identity", {userId: user.id});
  if (typeof identity.customerId === "string") return identity.customerId;
  if (user.emailVerified !== true) throw new BillingError(403, "Verify your email address, then sign in again.");
  const email = user.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw unauthorized();
  const candidate = await durable(env, identityName(user.id), "candidate", {userId: user.id, customerId: await accountId(email, env)});
  if (typeof candidate.customerId !== "string") throw unavailable();
  if (candidate.bound) return candidate.customerId;
  await durable(env, candidate.customerId, "claim", {customerId: candidate.customerId, userId: user.id, email});
  await durable(env, identityName(user.id), "bind", {userId: user.id, customerId: candidate.customerId});
  return candidate.customerId;
}

const METHODS: Record<string, string> = {login: "GET", callback: "GET", account: "GET", key: "POST", checkout: "POST", portal: "POST", logout: "POST"};
/** Stripe signs its own requests and has no browser, session or Origin header to offer. */
const WEBHOOK = "stripe-webhook";
/** Browser billing routes. Mutations are same-origin; sessions are WorkOS-sealed cookies; nothing identifying is logged. */
export async function handleBilling(req: Request, env: BillingEnv): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/v1/billing/")) return null;
  const action = url.pathname.slice("/v1/billing/".length);
  const cookies: string[] = [];
  const headers = (extra: Record<string, string> = {}) => {
    const h = new Headers({"Cache-Control": "no-store", ...extra});
    if (action === "callback") h.set("Referrer-Policy", "no-referrer");
    for (const c of cookies) h.append("Set-Cookie", c);
    return h;
  };
  try {
    const origin = env.BILLING_ORIGIN || "https://classifier.dev";
    if (url.origin !== origin) throw new BillingError(403, "Open billing on classifier.dev to continue.");
    if (action === WEBHOOK) {
      if (req.method !== "POST") return json({error: "Method not allowed."}, 405);
      // The record is durable before Stripe is told 200, and a storage failure asks Stripe to try again.
      const paid = await stripeEvent(req, env);
      if (paid) { try { await notify(env, paid); } catch { throw unavailable(); } }
      return json({received: true}, 200, headers());
    }
    if (!Object.hasOwn(METHODS, action)) return json({error: "Not found."}, 404);
    if (req.method !== METHODS[action]) return json({error: "Method not allowed."}, 405);
    if (req.method === "POST" && req.headers.get("Origin") !== url.origin) throw new BillingError(403, "Open billing on this site to continue.");
    if (!env.BILLING || !env.BILLING_SIGNING_KEY || !env.AUTUMN_SECRET_KEY) throw unavailable();
    if (action === "login") {
      const caller = await callerId(env, req.headers.get("CF-Connecting-IP") || "anon");
      const limit = await env.LIMITER.get(env.LIMITER.idFromName(`billing-login:${caller}`)).fetch(new Request("https://limit/?limit=3&daily=20"));
      if (!limit.ok) throw unavailable();
      const result = await limit.json() as {limited?: unknown} | null;
      if (typeof result?.limited !== "boolean") throw unavailable();
      if (result.limited) throw new BillingError(429, "Too many sign-in requests. Try again later.");
      const login = await beginLogin(env, origin);
      cookies.push(login.cookie);
      return new Response(null, {status: 302, headers: headers({Location: login.url})});
    }
    if (action === "callback") {
      cookies.push(clearLoginCookie());
      const {user, sealedSession, sessionId} = await completeLogin(req, env);
      await resolveCustomer(env, user);
      // Only a callback that got this far is a sign-in worth reporting, and only once per session.
      await notify(env, loginNotification({sessionId, email: user.email, at: Date.now()}));
      cookies.push(sessionCookie(sealedSession));
      return new Response(null, {status: 303, headers: headers({Location: `${origin}/pro`})});
    }
    if (action === "logout") return json({url: await endSession(req, env, origin, cookies)}, 200, headers());
    const session = await authenticateSession(req, env, cookies);
    const identity = await durable(env, identityName(session.userId), "identity", {userId: session.userId});
    if (typeof identity.customerId !== "string") { cookies.splice(0, cookies.length, clearCookie(SESSION_COOKIE)); throw unauthorized(); }
    const result = await durable(env, identity.customerId, action, {customerId: identity.customerId, userId: session.userId, origin});
    return json(result, 200, headers());
  } catch (error) {
    const failure = error instanceof BillingError ? error : unavailable();
    return json({error: failure.message}, failure.status, headers());
  }
}

/** Returns null for existing enterprise credentials and anonymous requests. */
export async function authenticatePro(req: Request, env: BillingEnv): Promise<{customerId: string; active: true} | null> {
  const authorization = req.headers.get("Authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || "";
  if (!bearer.startsWith("classifier_pro_")) return null;
  const credential = parseCredential(bearer.slice("classifier_pro_".length));
  await durable(env, credential.customerId, "authenticate", {customerId: credential.customerId, secret: credential.secret});
  return {customerId: credential.customerId, active: true};
}

/** Older records may still carry login/session fields; they are dropped at claim time and never honored. */
type Account = {email: string; workosUserId?: string; apiKeyHash?: string; autumnCustomer?: boolean; login?: unknown; session?: unknown; lastLogin?: unknown};
type Identity = {customerId?: string; candidate?: string};
const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;
/**
 * One instance per customer (billing state, credential hashes), one per WorkOS user (its customer mapping),
 * and one per operator notification (its outbox). Only the worker reaches these routes. A queue serializes
 * operations — the alarm included, so a redelivery cannot race its own send — and transactions guard the claims.
 */
export class BillingAccount implements DurableObject {
  private queue: Promise<unknown> = Promise.resolve();
  private cached?: {active: boolean; until: number};
  constructor(private state: DurableObjectState, private env: BillingEnv) {}
  fetch(req: Request): Promise<Response> {
    const operation = this.queue.then(() => this.dispatch(req));
    this.queue = operation.catch(() => {});
    return operation;
  }
  /** Notification instances only. Failing here keeps the record and the alarm, so nothing is lost. */
  alarm(): Promise<void> {
    const operation = this.queue.then(() => flush(this.state.storage, this.env));
    this.queue = operation.catch(() => {});
    return operation;
  }
  private async active(customerId: string): Promise<boolean> {
    if (this.cached && this.cached.until > Date.now()) return this.cached.active;
    const customer = await autumn(this.env, "customers.get", {customer_id: customerId});
    if (!Array.isArray(customer.subscriptions)) throw unavailable();
    const subscription = customer.subscriptions.find((s: any) => s && s.plan_id === PLAN && s.status === "active" && s.past_due === false && (s.expires_at === null || (typeof s.expires_at === "number" && s.expires_at > Date.now())));
    const active = !!subscription;
    // A completed checkout appears quickly; a known cancellation never outlives its expiry.
    const until = Math.min(Date.now() + (active ? 60000 : 5000), subscription?.expires_at ?? Infinity);
    this.cached = {active, until};
    return active;
  }
  /** The Autumn customer is created on first use and its ID checked before anything relies on it. */
  private async customer(customerId: string, account: Account) {
    if (account.autumnCustomer) return;
    const customer = await autumn(this.env, "customers.get_or_create", {customer_id: customerId, email: account.email});
    if (customer.id !== customerId) throw unavailable();
    account.autumnCustomer = true;
    await this.state.storage.put("account", account);
  }
  private async identity(action: string, input: Record<string, unknown>): Promise<Response> {
    const {userId, customerId} = input;
    if (typeof userId !== "string" || !USER_ID.test(userId)) throw unauthorized();
    if (action === "identity") return json({customerId: (await this.state.storage.get<Identity>("identity"))?.customerId ?? null});
    if (typeof customerId !== "string" || !/^[a-f0-9]{64}$/.test(customerId)) throw unauthorized();
    return this.state.storage.transaction(async storage => {
      const identity = await storage.get<Identity>("identity") ?? {};
      if (identity.customerId) return json({customerId: identity.customerId, bound: true});
      if (action === "candidate") {
        identity.candidate ??= customerId;
        await storage.put("identity", identity);
        return json({customerId: identity.candidate, bound: false});
      }
      if (identity.candidate !== customerId) throw unauthorized();
      await storage.put("identity", {customerId});
      return json({customerId, bound: true});
    });
  }
  private async dispatch(req: Request): Promise<Response> {
    try {
      const input = await body(req);
      const action = new URL(req.url).pathname.slice(1);
      if (["identity", "candidate", "bind"].includes(action)) return await this.identity(action, input);
      // A notification instance holds no account, so this is answered before anything asks for one.
      if (action === "notify") {
        const {id, subject, text} = input;
        if (typeof id !== "string" || typeof subject !== "string" || typeof text !== "string") throw new BillingError(400, "A valid notification is required.");
        return json({queued: await enqueue(this.state.storage, {id, subject, text}, this.env)});
      }
      const {customerId, secret, userId} = input;
      if (typeof customerId !== "string" || !/^[a-f0-9]{64}$/.test(customerId)) throw unauthorized();
      let account = await this.state.storage.get<Account>("account");
      if (action === "claim") {
        if (typeof userId !== "string" || !USER_ID.test(userId) || typeof input.email !== "string") throw unauthorized();
        const email = input.email;
        await this.state.storage.transaction(async storage => {
          const current = await storage.get<Account>("account");
          if (current?.workosUserId && current.workosUserId !== userId) throw new BillingError(403, "This billing account is linked to a different sign-in.");
          const next: Account = {email: current?.email || email, workosUserId: userId};
          if (current?.apiKeyHash) next.apiKeyHash = current.apiKeyHash;
          if (current?.autumnCustomer) next.autumnCustomer = true;
          await storage.put("account", next);
        });
        return json({linked: true});
      }
      if (action === "authenticate") {
        if (!account || typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret)) throw unauthorized();
        if (account.apiKeyHash !== await hash(secret)) throw new BillingError(401, "Invalid Pro API key.");
        if (!await this.active(customerId)) throw new BillingError(403, "Your Pro subscription is not active. Manage billing at /pro.");
        return json({active: true});
      }
      if (!account?.workosUserId || typeof userId !== "string" || account.workosUserId !== userId || typeof input.origin !== "string") throw unauthorized();
      if (action === "account") {
        await this.customer(customerId, account);
        const active = await this.active(customerId);
        return json({email: account.email, active, plan: active ? "pro" : "free", hasKey: !!account.apiKeyHash});
      }
      if (action === "key") {
        await this.customer(customerId, account);
        if (!await this.active(customerId)) throw new BillingError(403, "Subscribe to Pro before creating an API key.");
        const key = random(); account.apiKeyHash = await hash(key); await this.state.storage.put("account", account);
        return json({key: `classifier_pro_${customerId}.${key}`});
      }
      if (action === "checkout") {
        await this.customer(customerId, account);
        const checkout = await autumn(this.env, "billing.attach", {customer_id: customerId, plan_id: PLAN, redirect_mode: "always", success_url: `${input.origin}/pro`});
        this.cached = undefined;
        return json({url: safeUrl(checkout.payment_url)});
      }
      if (action === "portal") {
        const portal = await autumn(this.env, "billing.open_customer_portal", {customer_id: customerId, return_url: `${input.origin}/pro`});
        this.cached = undefined;
        return json({url: safeUrl(portal.url)});
      }
      return json({error: "Not found."}, 404);
    } catch (error) {
      const failure = error instanceof BillingError ? error : unavailable();
      return json({error: failure.message}, failure.status);
    }
  }
}
