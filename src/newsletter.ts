/**
 * The updates list.
 *
 * Email and subscription state, in a Postgres that holds nothing else. No IP, no user
 * agent, no request id. The columns you would join a person to a classification
 * on were never created, so the schema enforces this and no policy has to.
 * PRIVACY on the home page promises the API keeps no text; this keeps the same
 * promise about the people who ask for news.
 *
 * ROADMAP is the single source of the copy. The plain text at `curl
 * classifier.dev`, the form on the rendered page and the Markdown all read it,
 * so the three cannot drift.
 *
 * The write goes over Neon's HTTP SQL endpoint rather than a Postgres driver,
 * because a Worker has no TCP and this file is not worth a dependency.
 */

import type { Env } from "./index";
import { btn, esc, page } from "./ui";

/** What an address is worth. Honest about being work in progress, not a promise with a date. */
export const ROADMAP: ReadonlyArray<{ name: string; what: string }> = [
  { name: "Private inference", what: "your text never reaches a shared provider" },
  { name: "Dedicated endpoints", what: "capacity that is yours, at your own latency" },
  { name: "Trained endpoints", what: "tuned on your labelled data, not just your labels" },
  { name: "A self-serve API", what: "keys and higher limits without booking a call" },
  { name: "Better classification", what: "accuracy work, measured the way /benchmark is" },
];

export const SUBSCRIBE_PATH = "subscribe";

/** Longest address RFC 5321 allows; anything longer is a mistake or a probe. */
const MAX_EMAIL = 254;

/**
 * Deliberately not RFC 5322. That grammar accepts addresses no mail server
 * will, and rejecting a real address is the only failure that matters here.
 * One @, something either side, a dot in the domain, no spaces.
 */
const EMAIL = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

export function normalise(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL) return null;
  return EMAIL.test(email) ? email : null;
}

/** The plain-text section, rendered into DOCS. Widths match the pricing tables. */
export function roadmapDoc(): string {
  const rows = ROADMAP.map((r) => `    ${r.name.padEnd(24)}${r.what}`).join("\n");
  return `UPDATES

  The free tier is the whole service today. What is being built on top of it:

${rows}

  Subscribe from anywhere you can make a request:

    curl -X POST https://classifier.dev/${SUBSCRIBE_PATH} \\
      -H "content-type: application/json" \\
      -d '{"email":"you@example.com"}'

  Check your inbox and confirm before updates start. Agents can POST the
  emailed token as {"token":"..."} to /subscribe/confirm without a browser.
  Links expire within 24 hours. Submit again for a new link; repeat requests
  within the hour send at most one confirmation email.

  One mail when something on that list ships, and nothing in between. The list
  keeps your address, signup source, and subscription dates in a separate
  database, with no classification traffic. Unsubscribing is a reply.
`;
}

class Unavailable extends Error {}

/** Tokens expire after 24 hours; hourly issuance makes Resend retries idempotent. */
export const CONFIRM_PATH = "subscribe/confirm";
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const utf8 = new TextEncoder();

async function tokenKey(env: Env): Promise<CryptoKey> {
  if (!env.NEWSLETTER_CONFIRMATION_SECRET) throw new Unavailable("confirmation secret is not set");
  return crypto.subtle.importKey("raw", utf8.encode(env.NEWSLETTER_CONFIRMATION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function confirmationToken(env: Env, email: string, now = Date.now()): Promise<string> {
  const expires = Math.floor(now / 3_600_000) * 3_600_000 + 86_400_000;
  const payload = encode(utf8.encode(JSON.stringify({ email, expires })));
  const signature = await crypto.subtle.sign("HMAC", await tokenKey(env), utf8.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}

export async function verifyToken(env: Env, token: unknown, now = Date.now()): Promise<string | null> {
  if (typeof token !== "string" || token.length > 1500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const key = await tokenKey(env);
  try {
    const [payload, signature] = token.split(".");
    if (!await crypto.subtle.verify("HMAC", key, decode(signature), utf8.encode(payload))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (!Number.isSafeInteger(claims.expires) || claims.expires <= now || claims.expires > now + 86_400_000) return null;
    return normalise(claims.email);
  } catch { return null; }
}

/** No database row exists until the inbox owner confirms. */
export async function requestConfirmation(env: Env, email: string): Promise<void> {
  if (!env.NEWSLETTER_RESEND_API_KEY || !env.NEWSLETTER_FROM || !env.NEWSLETTER_DATABASE_URL) throw new Unavailable("newsletter is not configured");
  const token = await confirmationToken(env, email);
  const link = `https://classifier.dev/${CONFIRM_PATH}?token=${encodeURIComponent(token)}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.NEWSLETTER_RESEND_API_KEY}`, "content-type": "application/json",
      "idempotency-key": `newsletter-confirm/${token.split(".")[1]}`,
    },
    body: JSON.stringify({
      from: env.NEWSLETTER_FROM,
      to: [email],
      ...(env.REPORT_TO ? { reply_to: env.REPORT_TO } : {}),
      subject: "Confirm your classifier.dev updates subscription",
      text: [
        "Confirm that you want classifier.dev product updates:", link, "",
        "Open the link and press Confirm subscription. It expires within 24 hours.",
        "If you did not request updates, ignore this email. You have not been added to the list.", "",
        "Agents can confirm without a browser:",
        "POST https://classifier.dev/subscribe/confirm",
        "Content-Type: application/json",
        JSON.stringify({ token }),
      ].join("\n"),
    }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({})) as { message?: string };
    const message = error.message ?? "";
    const reason = message.includes("not verified") ? "domain not verified for this key"
      : message.includes("restricted") ? "restricted key"
      : /api key/i.test(message) ? "API key rejected" : "delivery rejected";
    throw new Unavailable(`resend returned ${res.status}: ${reason}`);
  }
}

/** Store only confirmed addresses; retries do not re-notify or undo an unsubscribe. */
export async function subscribe(env: Env, email: string, source: string): Promise<boolean> {
  const conn = env.NEWSLETTER_DATABASE_URL;
  if (!conn) throw new Unavailable("NEWSLETTER_DATABASE_URL is not set");
  const res = await fetch(`https://${new URL(conn).host}/sql`, {
    method: "POST",
    headers: { "content-type": "application/json", "neon-connection-string": conn },
    body: JSON.stringify({
      query: `insert into subscriber (email, source, confirmed_at) values ($1, $2, now())
        on conflict (email) do update set confirmed_at = now()
        where subscriber.confirmed_at is null and subscriber.unsubscribed_at is null
        returning email`,
      params: [email, source.slice(0, 32)],
    }),
  });
  if (!res.ok) throw new Unavailable(`neon returned ${res.status}`);
  const result = await res.json() as { rowCount: number };
  return result.rowCount > 0;
}

/** GET is read-only: scanners must not activate subscriptions by opening a link. */
export function confirmationPage(token: string): string {
  return page({
    title: "confirm subscription · classifier.dev",
    body: `<div class="page"><main><article class="doc prose">
      <header><h1>Confirm your subscription</h1></header>
      <p>Get one email when a classifier.dev roadmap item ships.</p>
      <form method="post" action="/${CONFIRM_PATH}">
        <input type="hidden" name="token" value="${esc(token)}">
        ${btn("Confirm subscription", { cls: "cta", type: "submit" })}
      </form>
      <p>If you did not request updates, you can close this page.</p>
    </article></main></div>`,
  });
}

export { Unavailable };

/**
 * Notify the owner of a new subscription via email.
 *
 * Fire-and-forget: the notification is sent via ctx.waitUntil, so a Resend
 * outage never makes a confirmation fail. This means the response to the subscriber
 * is sent even if the notification email never arrives.
 */
export async function notify(env: Env, email: string, source: string): Promise<void> {
  if (!env.RESEND_API_KEY || !env.REPORT_TO) return;

  const date = new Date().toISOString();
  const body = [
    `Subscriber: ${email}`,
    `Source: ${source}`,
    `Date: ${date}`,
    "",
    "The subscriber list is in the newsletter Neon project.",
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: "classifier.dev <onboarding@resend.dev>",
      to: [env.REPORT_TO],
      subject: `new subscriber: ${email}`,
      text: body,
    }),
  });
  if (!res.ok) throw new Error(`resend returned ${res.status}`);
}

/**
 * What a browser with JavaScript turned off gets back. The form posts normally
 * in that case, so the answer has to be a page rather than a JSON body.
 */
export function resultPage(ok: boolean, message: string): string {
  return page({
    title: "classifier.dev updates",
    body: `<div class="page"><main><article class="doc prose">
  <header><h1><span class="syn"># </span>classifier.dev updates</h1></header>
  <p class="${ok ? "quote" : "note"}">${esc(message)}</p>
  <p class="row">${btn("back to classifier.dev", { cls: "dim", href: "/" })}</p>
</article></main></div>`,
  });
}
