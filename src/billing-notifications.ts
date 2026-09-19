/** Private sign-in and paid-subscription emails, delivered by a durable outbox. */
import { BillingError, unavailable } from "./auth";

export interface NotifyEnv {
  RESEND_API_KEY?: string;
  REPORT_TO?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRO_PRODUCT_ID?: string;
}

const encoder = new TextEncoder();
const FROM = "classifier.dev <onboarding@resend.dev>";
const REPLY_TO = "contact@classifier.dev";
const RESEND = "https://api.resend.com/emails";
const TIMEOUT = 10000;
const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 3_600_000;
const OUTBOX = "outbox";
const MAX_SUBJECT = 200;
const MAX_TEXT = 4000;

export type Notification = {id: string; subject: string; text: string};
export const NOTIFICATION_ID = /^notify:(login|pro):[A-Za-z0-9_-]{1,128}$/;
const PROVIDER_ID = /^[A-Za-z0-9_-]{1,128}$/;

const when = (at: number) => new Date(at).toISOString();
const address = (value: unknown) =>
  typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "Email unavailable";
const money = (amount: number, currency: string) => `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;

export function loginNotification(input: {sessionId: string; email: string; at: number}): Notification {
  if (!PROVIDER_ID.test(input.sessionId)) throw unavailable();
  return {
    id: `notify:login:${input.sessionId}`,
    subject: "classifier.dev: account signed in",
    text: [
      "A Classifier Pro account signed in.",
      "",
      `Account:        ${address(input.email)}`,
      `WorkOS session: ${input.sessionId}`,
      `Signed in:      ${when(input.at)}`,
      "",
      "One message per sign-in. Session refreshes and account reads send none.",
    ].join("\n"),
  };
}

export type PaidSubscription = {subscription: string; customer: string; invoice: string; amount: number; currency: string; email: unknown; paidAt: number | null};
export function subscriptionNotification(paid: PaidSubscription, at: number): Notification {
  if (!PROVIDER_ID.test(paid.subscription)) throw unavailable();
  // Say when the invoice was actually paid; a replayed old event must not read as money arriving now.
  const stamp = paid.paidAt === null ? `Queued:        ${when(at)} (the event carried no paid time)` : `Paid:          ${when(paid.paidAt)}`;
  return {
    id: `notify:pro:${paid.subscription}`,
    subject: `classifier.dev: new paid Pro subscription (${money(paid.amount, paid.currency)})`,
    text: [
      "A new paid Classifier Pro subscription started. This is a first payment,",
      "not a renewal.",
      "",
      `Customer:      ${address(paid.email)}`,
      `Amount paid:   ${money(paid.amount, paid.currency)}`,
      `Stripe customer: ${paid.customer}`,
      `Subscription:  ${paid.subscription}`,
      `Invoice:       ${paid.invoice}`,
      stamp,
      "",
      "Sent once per subscription, from the paid invoice itself.",
    ].join("\n"),
  };
}

type Mail = {from: string; to: string[]; reply_to: string; subject: string; text: string};
type Outbox =
  | {key: string; attempts: number; mail: Mail}
  | {key: string; attempts: number; subject: string; text: string}
  | {key: string; sent: true};
const backoff = (attempts: number) => Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (attempts - 1));

function pending(note: Notification, env: NotifyEnv, attempts: number): Outbox {
  if (!env.REPORT_TO) return {key: note.id, attempts, subject: note.subject, text: note.text};
  return {key: note.id, attempts, mail: {from: FROM, to: [env.REPORT_TO], reply_to: REPLY_TO, subject: note.subject, text: note.text}};
}

export async function enqueue(storage: DurableObjectStorage, note: Notification, env: NotifyEnv): Promise<boolean> {
  if (!NOTIFICATION_ID.test(note.id) || !note.subject || !note.text || note.subject.length > MAX_SUBJECT || note.text.length > MAX_TEXT) {
    throw new BillingError(400, "A valid notification is required.");
  }
  return storage.transaction(async tx => {
    if (await tx.get<Outbox>(OUTBOX)) return false;
    await tx.put<Outbox>(OUTBOX, pending(note, env, 0));
    await tx.setAlarm(Date.now());
    return true;
  });
}

export async function flush(storage: DurableObjectStorage, env: NotifyEnv): Promise<void> {
  const record = await storage.get<Outbox>(OUTBOX);
  if (!record || "sent" in record) return;
  const attempts = record.attempts + 1;
  const next: Outbox = "mail" in record
    ? {...record, attempts}
    : pending({id: record.key, subject: record.subject, text: record.text}, env, attempts);
  // Pre-arm the retry before sending so a crash after acceptance cannot lose the job.
  await storage.transaction(async tx => {
    await tx.put<Outbox>(OUTBOX, next);
    await tx.setAlarm(Date.now() + backoff(attempts));
  });
  if (!("mail" in next) || !env.RESEND_API_KEY) return;
  if (!await deliver(next.mail, record.key, env.RESEND_API_KEY)) return;
  await storage.transaction(async tx => {
    await tx.put<Outbox>(OUTBOX, {key: record.key, sent: true});
    await tx.deleteAlarm();
  });
}

async function deliver(mail: Mail, key: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(RESEND, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {authorization: `Bearer ${apiKey}`, "content-type": "application/json", "Idempotency-Key": key},
      body: JSON.stringify(mail),
    });
    if (!response.ok) return false;
    const result = await response.json() as {id?: unknown} | null;
    return typeof result?.id === "string" && result.id.length > 0;
  } catch { return false; }
}

const SKEW_SECONDS = 300;
const MAX_BODY = 256 * 1024;

const obj = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
function idOf(value: unknown): string | null {
  if (typeof value === "string" && value) return value;
  const id = obj(value)?.id;
  return typeof id === "string" && id ? id : null;
}
const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const millis = (value: unknown) => positive(value) && (value as number) <= 8_640_000_000_000 ? (value as number) * 1000 : null;

async function rawBody(req: Request): Promise<Uint8Array> {
  if (!req.body) throw new BillingError(400, "A request body is required.");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY) { await reader.cancel(); throw new BillingError(413, "Request is too large."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function parseSignature(header: string): {stamp: string; seconds: number; signatures: string[]} | null {
  let stamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const split = part.indexOf("=");
    if (split < 0) continue;
    const name = part.slice(0, split).trim(), value = part.slice(split + 1).trim();
    if (name === "t" && !stamp && /^\d{1,15}$/.test(value)) stamp = value;
    else if (name === "v1" && /^[a-fA-F0-9]{64}$/.test(value)) signatures.push(value);
  }
  const seconds = stamp ? Number(stamp) : NaN;
  if (!Number.isSafeInteger(seconds) || !signatures.length) return null;
  return {stamp, seconds, signatures};
}
const fromHex = (value: string) => Uint8Array.from(value.match(/../g)!.map(byte => parseInt(byte, 16)));

async function verify(secret: string, raw: Uint8Array, header: string): Promise<boolean> {
  const parsed = parseSignature(header);
  if (!parsed) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - parsed.seconds) > SKEW_SECONDS) return false;
  const prefix = encoder.encode(`${parsed.stamp}.`);
  const signed = new Uint8Array(prefix.length + raw.length);
  signed.set(prefix);
  signed.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["verify"]);
  for (const signature of parsed.signatures) {
    if (await crypto.subtle.verify("HMAC", key, fromHex(signature), signed)) return true;
  }
  return false;
}

const subscriptionOf = (invoice: Record<string, unknown>) =>
  idOf(obj(obj(invoice.parent)?.subscription_details)?.subscription) ?? idOf(invoice.subscription);

function chargesProduct(invoice: Record<string, unknown>, product: string, subscription: string): boolean {
  const lines = obj(invoice.lines)?.data;
  if (!Array.isArray(lines)) return false;
  return lines.some(entry => {
    const line = obj(entry);
    if (!line || !positive(line.amount)) return false;
    const owner = idOf(obj(obj(line.parent)?.subscription_item_details)?.subscription);
    if (owner && owner !== subscription) return false;
    const named = idOf(obj(obj(line.pricing)?.price_details)?.product) ?? idOf(obj(line.price)?.product);
    return named === product;
  });
}

export function proSubscription(event: Record<string, unknown>, product: string): PaidSubscription | null {
  if (event.livemode !== true || event.type !== "invoice.paid") return null;
  const invoice = obj(obj(event.data)?.object);
  if (!invoice || invoice.status !== "paid" || invoice.billing_reason !== "subscription_create") return null;
  if (!positive(invoice.amount_paid)) return null;
  const id = typeof invoice.id === "string" && invoice.id ? invoice.id : null;
  const customer = idOf(invoice.customer);
  const subscription = subscriptionOf(invoice);
  const currency = typeof invoice.currency === "string" && invoice.currency ? invoice.currency : null;
  if (!id || !customer || !subscription || !currency) return null;
  if (!chargesProduct(invoice, product, subscription)) return null;
  const paidAt = millis(obj(invoice.status_transitions)?.paid_at) ?? millis(event.created);
  return {subscription, customer, invoice: id, amount: invoice.amount_paid as number, currency, email: invoice.customer_email, paidAt};
}

export async function stripeEvent(req: Request, env: NotifyEnv): Promise<Notification | null> {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_PRO_PRODUCT_ID) throw unavailable();
  const header = req.headers.get("Stripe-Signature") || "";
  const raw = await rawBody(req);
  if (!header || !await verify(env.STRIPE_WEBHOOK_SECRET, raw, header)) throw new BillingError(400, "The signature could not be verified.");
  let event: Record<string, unknown> | null = null;
  try { event = obj(JSON.parse(new TextDecoder().decode(raw))); } catch { event = null; }
  if (!event) throw new BillingError(400, "A valid JSON object is required.");
  const paid = proSubscription(event, env.STRIPE_PRO_PRODUCT_ID);
  return paid ? subscriptionNotification(paid, Date.now()) : null;
}
