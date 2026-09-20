import { callerId, type PrivacyEnv } from "./privacy";
import { billingCustomerId } from "./billing-identity";
import type { ErrorCode } from "./openapi";

export interface BillingEnv extends PrivacyEnv {
  BILLING?: DurableObjectNamespace;
  LIMITER: DurableObjectNamespace;
  BILLING_SIGNING_KEY?: string;
  AUTUMN_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  BILLING_FROM?: string;
  NEWSLETTER_FROM?: string;
  NEWSLETTER_RESEND_API_KEY?: string;
  BILLING_ORIGIN?: string;
}
export class BillingError extends Error {
  get code(): ErrorCode { return this.status === 401 ? "invalid_pro_key" : this.status === 403 ? "pro_inactive" : this.status === 503 ? "billing_unavailable" : "billing_error"; }
  constructor(public status: number, message: string) { super(message); }
}
const COOKIE = "classifier_session";
const SESSION_SECONDS = 30 * 86400;
const PLAN = "pro";
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, "0")).join("");
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
const hash = async (text: string) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
const json = (data: unknown, status = 200, headers: HeadersInit = {}) => Response.json(data, {status, headers: {"Cache-Control": "no-store", ...headers}});
const unavailable = () => new BillingError(503, "Billing is temporarily unavailable. Please try again.");
const unauthorized = () => new BillingError(401, "Sign in again to continue.");
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
async function provider(url: string, key: string | undefined, payload: unknown, autumn = false): Promise<Record<string, any>> {
  if (!key) throw unavailable();
  try {
    const response = await fetch(url, {method: "POST", signal: AbortSignal.timeout(10000), headers: {
      Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(autumn ? {"x-api-version": "2.4.0"} : {}),
    }, body: JSON.stringify(payload)});
    if (!response.ok) throw unavailable();
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw unavailable();
    return data as Record<string, any>;
  } catch { throw unavailable(); }
}
const autumn = (env: BillingEnv, path: string, payload: unknown) => provider(`https://api.useautumn.com/v1/${path}`, env.AUTUMN_SECRET_KEY, payload, true);
function safeUrl(value: unknown): string {
  if (typeof value !== "string") throw unavailable();
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !["stripe.com", "useautumn.com"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw unavailable();
    return url.href;
  } catch { throw unavailable(); }
}
async function accountId(email: string, env: BillingEnv) {
  if (!env.BILLING_SIGNING_KEY) throw unavailable();
  return billingCustomerId(email, env.BILLING_SIGNING_KEY);
}
async function accountCall(env: BillingEnv, id: string, action: string, data: Record<string, unknown>) {
  if (!env.BILLING) throw unavailable();
  try {
    const response = await env.BILLING.get(env.BILLING.idFromName(id)).fetch(new Request(`https://billing/${action}`, {
      method: "POST", body: JSON.stringify({...data, customerId: id}),
    }));
    const result = await response.json() as Record<string, any>;
    if (!response.ok) throw new BillingError(response.status, typeof result.error === "string" ? result.error : "Billing request failed.");
    return result;
  } catch (error) {
    if (error instanceof BillingError) throw error;
    throw unavailable();
  }
}
function cookie(value: string, seconds = SESSION_SECONDS) {
  return `${COOKIE}=${value}; Path=/v1/billing; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}
function session(req: Request) {
  const raw = req.headers.get("Cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) throw unauthorized();
  return parseCredential(raw);
}

/** All public billing mutations are same-origin; credentials never occur in query strings. */
export async function handleBilling(req: Request, env: BillingEnv): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/v1/billing/")) return null;
  try {
    const origin = env.BILLING_ORIGIN || "https://classifier.dev";
    if (url.origin !== origin) throw new BillingError(403, "Open billing on classifier.dev to continue.");
    const action = url.pathname.slice("/v1/billing/".length);
    if (!["login", "session", "account", "key", "checkout", "portal", "logout"].includes(action)) return json({error: "Not found."}, 404);
    if (req.method !== (action === "account" ? "GET" : "POST")) return json({error: "Method not allowed."}, 405);
    if (req.method === "POST" && req.headers.get("Origin") !== url.origin) throw new BillingError(403, "Open billing on this site to continue.");
    if (!env.BILLING || !env.BILLING_SIGNING_KEY || !env.AUTUMN_SECRET_KEY) throw unavailable();
    if (action === "login") {
      const caller = await callerId(env, req.headers.get("CF-Connecting-IP") || "anon");
      const limit = await env.LIMITER.get(env.LIMITER.idFromName(`billing-login:${caller}`)).fetch(new Request("https://limit/?limit=3&daily=20"));
      if (!limit.ok) throw unavailable();
      if ((await limit.json() as {limited: boolean}).limited) throw new BillingError(429, "Too many sign-in requests. Try again later.");
      const input = await body(req);
      const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BillingError(400, "Enter a valid email address.");
      const id = await accountId(email, env);
      await accountCall(env, id, "login", {email, origin: url.origin});
      return json({sent: true});
    }
    if (action === "session") {
      const input = await body(req);
      const credential = parseCredential(typeof input.token === "string" ? input.token : "");
      const result = await accountCall(env, credential.customerId, "session", {secret: credential.secret});
      return json({authenticated: true}, 200, {"Set-Cookie": cookie(`${credential.customerId}.${result.session}`)});
    }
    const credential = session(req);
    const result = await accountCall(env, credential.customerId, action, {secret: credential.secret, origin: url.origin});
    return json(result, 200, action === "logout" ? {"Set-Cookie": cookie("", 0)} : {});
  } catch (error) {
    const failure = error instanceof BillingError ? error : unavailable();
    return json({error: failure.message}, failure.status);
  }
}

/** Returns null for existing enterprise credentials and anonymous requests. */
export async function authenticatePro(req: Request, env: BillingEnv): Promise<{customerId: string; active: true} | null> {
  const authorization = req.headers.get("Authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || "";
  if (!bearer.startsWith("classifier_pro_")) return null;
  const credential = parseCredential(bearer.slice("classifier_pro_".length));
  await accountCall(env, credential.customerId, "authenticate", {secret: credential.secret});
  return {customerId: credential.customerId, active: true};
}

type Account = {email: string; login?: {hash: string; expires: number}; lastLogin?: number; session?: {hash: string; expires: number}; apiKeyHash?: string};
/** Billing state is isolated from request analytics. A queue serializes token consumption and rotation. */
export class BillingAccount implements DurableObject {
  private queue: Promise<unknown> = Promise.resolve();
  private cached?: {active: boolean; until: number};
  constructor(private state: DurableObjectState, private env: BillingEnv) {}
  fetch(req: Request): Promise<Response> {
    const operation = this.queue.then(() => this.dispatch(req));
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
  private async dispatch(req: Request): Promise<Response> {
    try {
      const input = await body(req);
      const {customerId, secret} = input;
      if (typeof customerId !== "string" || !/^[a-f0-9]{64}$/.test(customerId)) throw unauthorized();
      const action = new URL(req.url).pathname.slice(1);
      let account = await this.state.storage.get<Account>("account");
      if (action === "login") {
        if (typeof input.email !== "string" || typeof input.origin !== "string") throw unauthorized();
        // Cross-IP attempts cannot send more than one email per minute to an account.
        if (account?.lastLogin && account.lastLogin + 60000 > Date.now()) return json({sent: true});
        if (!(this.env.BILLING_FROM || this.env.NEWSLETTER_FROM)) throw unavailable();
        const token = random();
        account = {...account, email: input.email, lastLogin: Date.now(), login: {hash: await hash(token), expires: Date.now() + 15 * 60000}};
        await this.state.storage.put("account", account);
        const link = `${input.origin}/pro#token=${customerId}.${token}`;
        try {
          const sent = await provider("https://api.resend.com/emails", this.env.NEWSLETTER_RESEND_API_KEY || this.env.RESEND_API_KEY, {
            from: this.env.BILLING_FROM || this.env.NEWSLETTER_FROM, to: [input.email], subject: "Sign in to classifier.dev",
            text: `Sign in to manage Classifier Pro:\n\n${link}\n\nThis link expires in 15 minutes and can only be used once. If you did not request it, you can ignore this email.`,
          });
          if (typeof sent.id !== "string") throw unavailable();
        } catch (error) {
          delete account.login;
          delete account.lastLogin;
          await this.state.storage.put("account", account);
          throw error;
        }
        return json({sent: true});
      }
      if (!account || typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret)) throw unauthorized();
      const digest = await hash(secret);
      if (action === "session") {
        if (!account.login || account.login.expires <= Date.now() || account.login.hash !== digest) throw unauthorized();
        const customer = await autumn(this.env, "customers.get_or_create", {customer_id: customerId, email: account.email});
        if (customer.id !== customerId) throw unavailable();
        const session = random();
        const newSession = {hash: await hash(session), expires: Date.now() + SESSION_SECONDS * 1000};
        // Only storage work runs in the transaction; network requests have completed.
        await this.state.storage.transaction(async storage => {
          const current = await storage.get<Account>("account");
          if (!current?.login || current.login.expires <= Date.now() || current.login.hash !== digest) throw unauthorized();
          delete current.login;
          current.session = newSession;
          await storage.put("account", current);
        });
        return json({session});
      }
      if (action === "authenticate") {
        if (account.apiKeyHash !== digest) throw new BillingError(401, "Invalid Pro API key.");
        if (!await this.active(customerId)) throw new BillingError(403, "Your Pro subscription is not active. Manage billing at /pro.");
        return json({active: true});
      }
      if (!account.session || account.session.expires <= Date.now() || account.session.hash !== digest) throw unauthorized();
      if (action === "logout") {
        delete account.session; await this.state.storage.put("account", account); return json({authenticated: false});
      }
      if (action === "account") {
        const active = await this.active(customerId);
        return json({email: account.email, active, plan: active ? "pro" : "free", hasKey: !!account.apiKeyHash});
      }
      if (action === "key") {
        if (!await this.active(customerId)) throw new BillingError(403, "Subscribe to Pro before creating an API key.");
        const key = random(); account.apiKeyHash = await hash(key); await this.state.storage.put("account", account);
        return json({key: `classifier_pro_${customerId}.${key}`});
      }
      if (action === "checkout") {
        const customer = await autumn(this.env, "customers.get_or_create", {customer_id: customerId, email: account.email});
        if (customer.id !== customerId) throw unavailable();
        const checkout = await autumn(this.env, "billing.attach", {customer_id: customerId, plan_id: PLAN, redirect_mode: "always", success_url: `${input.origin}/pro?checkout=complete`});
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
