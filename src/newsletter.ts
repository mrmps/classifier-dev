/**
 * The updates list.
 *
 * Email, subscription state and which roadmap items the person ticked, in the
 * shared application Postgres. No IP, user agent, request id or workspace
 * foreign key is stored on subscriber rows. Newsletter consent remains
 * independent of accounts and API activity.
 *
 * The table, for whoever next touches it (`migrations/` holds the changes;
 * the original was made by hand; now managed in migrations/postgres):
 *
 *   create table subscriber (
 *     id bigint generated always as identity primary key,
 *     email text not null unique,
 *     source text not null default 'site',
 *     wants text[] not null default '{}',      -- ROADMAP keys, in ROADMAP order
 *     desired_latency_ms integer,
 *     created_at timestamptz not null default now(),
 *     confirmed_at timestamptz,
 *     unsubscribed_at timestamptz
 *   );
 *
 * ROADMAP is the single source of the copy. The plain text at `curl
 * classifier.dev`, the form on the rendered page and the Markdown all read it,
 * so the three cannot drift.
 *
 * The write goes over Neon's HTTP SQL endpoint rather than a Postgres driver,
 * using the same DATABASE_URL as the account application.
 */

import type { Env } from "./index";
import { btn, esc, page } from "./ui";

/**
 * What an address is worth. Honest about being work in progress, not a promise
 * with a date. The key is what a subscriber ticks: it is the value of the
 * checkbox on the page, the string in the `wants` array of the API body, a
 * claim in the confirmation token and the element stored in the `wants`
 * column, so renaming one renames the stored answer — add a key, never
 * repurpose one.
 */
export const ROADMAP: ReadonlyArray<{ key: string; name: string; what: string }> = [
  { key: "private", name: "Private inference", what: "your text never reaches a shared provider" },
  { key: "faster", name: "Faster inference", what: "lower response time for latency-sensitive paths" },
  { key: "dedicated", name: "Dedicated endpoints", what: "capacity that is yours, at your own latency" },
  { key: "trained", name: "Trained endpoints", what: "tuned on your labelled data, not just your labels" },
  { key: "api", name: "A self-serve API", what: "keys and higher limits without booking a call" },
  { key: "accuracy", name: "Better classification", what: "accuracy work, measured the way /benchmark is" },
];

/** The keys a `wants` may hold, in the order they are printed and stored. */
export const ROADMAP_KEYS: ReadonlyArray<string> = ROADMAP.map((r) => r.key);
export const FASTER_INFERENCE_KEY = "faster";
export const MIN_DESIRED_LATENCY_MS = 1;
export const MAX_DESIRED_LATENCY_MS = 60_000;

/** The names behind a list of keys, for a person reading mail. */
export const wantedNames = (wants: ReadonlyArray<string>) => ROADMAP.filter((r) => wants.includes(r.key)).map((r) => r.name);

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

/**
 * Which roadmap items were ticked. Takes the JSON array an agent sends, the
 * repeated `wants` fields a checkbox form posts, or one comma-separated
 * string, and returns the known keys among them, once each, in ROADMAP order.
 * Anything else is dropped rather than refused: a stale key from a cached
 * page is not a reason to lose the address.
 */
export function wanted(raw: unknown): string[] {
  const given = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const asked = new Set(given.filter((v): v is string => typeof v === "string").map((v) => v.trim().toLowerCase()));
  return ROADMAP_KEYS.filter((k) => asked.has(k));
}

/** A whole-millisecond target, bounded so accidental years or fractions are rejected. */
export function desiredLatency(raw: unknown): number | null {
  const value = typeof raw === "number" ? raw
    : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim())
    : NaN;
  return Number.isSafeInteger(value) && value >= MIN_DESIRED_LATENCY_MS && value <= MAX_DESIRED_LATENCY_MS ? value : null;
}

/** The plain-text section, rendered into DOCS. Widths match the pricing tables. */
export function roadmapDoc(): string {
  const rows = ROADMAP.map((r) => `    ${r.name.padEnd(24)}${r.what}`).join("\n");
  return `UPDATES

  The free tier is the whole service today. What is being built on top of it:

${rows}

  Subscribe with a request, naming what you would use first:

    curl -X POST https://classifier.dev/${SUBSCRIBE_PATH} \\
      -H "content-type: application/json" \\
      -d '{"email":"you@example.com","wants":["private","trained"]}'

  "wants" is optional. It takes any of:
    ${ROADMAP_KEYS.join(", ")}

  When "wants" includes faster, also send desired_latency_ms (1–60000).

  Confirm from the email before updates start; an agent can POST the emailed
  token as {"token":"..."} to /subscribe/confirm instead. Links last 24
  hours, and repeat requests within the hour send one email.

  One mail when something on that list ships, nothing in between. Your
  address and what you ticked are kept apart from API traffic. Unsubscribe by
  replying.
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

/** A claim the token carries: the address, and what its owner ticked. */
export interface Claim { email: string; wants: string[]; desiredLatencyMs: number | null }

/**
 * The ticks ride in the token. No row exists until the inbox owner confirms,
 * so the token is the only place they can wait; and since the token is
 * signed, what comes back is what was asked for. A different list is a
 * different token, so it is a different confirmation email.
 */
export async function confirmationToken(
  env: Env,
  email: string,
  now = Date.now(),
  wants: ReadonlyArray<string> = [],
  desiredLatencyMs: number | null = null,
): Promise<string> {
  const latency = desiredLatency(desiredLatencyMs);
  if (wants.includes(FASTER_INFERENCE_KEY) && latency === null) throw new RangeError("faster inference requires a desired latency");
  const expires = Math.floor(now / 3_600_000) * 3_600_000 + 86_400_000;
  const payload = encode(utf8.encode(JSON.stringify({
    email,
    expires,
    ...(wants.length ? { wants } : {}),
    ...(wants.includes(FASTER_INFERENCE_KEY) ? { desired_latency_ms: latency } : {}),
  })));
  const signature = await crypto.subtle.sign("HMAC", await tokenKey(env), utf8.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}

export async function verifyToken(env: Env, token: unknown, now = Date.now()): Promise<Claim | null> {
  if (typeof token !== "string" || token.length > 1500 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const key = await tokenKey(env);
  try {
    const [payload, signature] = token.split(".");
    if (!await crypto.subtle.verify("HMAC", key, decode(signature), utf8.encode(payload))) return null;
    const claims = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (!Number.isSafeInteger(claims.expires) || claims.expires <= now || claims.expires > now + 86_400_000) return null;
    const email = normalise(claims.email);
    const wants = wanted(claims.wants);
    const desiredLatencyMs = wants.includes(FASTER_INFERENCE_KEY) ? desiredLatency(claims.desired_latency_ms) : null;
    return email && (!wants.includes(FASTER_INFERENCE_KEY) || desiredLatencyMs !== null)
      ? { email, wants, desiredLatencyMs }
      : null;
  } catch { return null; }
}

/** No database row exists until the inbox owner confirms. */
export async function requestConfirmation(
  env: Env,
  email: string,
  wants: ReadonlyArray<string> = [],
  desiredLatencyMs: number | null = null,
): Promise<void> {
  if (!env.NEWSLETTER_RESEND_API_KEY || !env.NEWSLETTER_FROM || !env.DATABASE_URL) throw new Unavailable("newsletter is not configured");
  const token = await confirmationToken(env, email, Date.now(), wants, desiredLatencyMs);
  const names = wantedNames(wants);
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
        ...(names.length ? [`You ticked: ${names.join(", ")}.`, ""] : []),
        ...(desiredLatencyMs !== null ? [`Desired latency: ${desiredLatencyMs} ms.`, ""] : []),
        "Open the link and press Confirm subscription. The link lasts 24 hours.",
        "If you did not ask for this, ignore it. You are not on the list.", "",
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

/**
 * Store a confirmed address with what it ticked. Returns whether this
 * confirmation is the one that put the address on the list, which is what
 * the owner is told about.
 *
 * A repeat confirmation keeps the one row: the date it was first confirmed
 * stands, and the ticks are replaced only when the new list has something in
 * it, so a bare re-subscribe from curl never blanks a list made on the page.
 * An unsubscribe is never undone. The keys go over as one Postgres array
 * literal; they are ROADMAP keys, never the caller's text, so the literal
 * needs no quoting, and `wanted` guarantees it. `now()` is one instant for
 * the whole statement, so a row whose confirmed_at equals it was confirmed
 * by this call.
 */
export async function subscribe(
  env: Env,
  email: string,
  source: string,
  wants: ReadonlyArray<string> = [],
  desiredLatencyMs: number | null = null,
): Promise<boolean> {
  const conn = env.DATABASE_URL;
  if (!conn) throw new Unavailable("DATABASE_URL is not set");
  const res = await fetch(`https://${new URL(conn).host}/sql`, {
    method: "POST",
    headers: { "content-type": "application/json", "neon-connection-string": conn },
    body: JSON.stringify({
      query: `insert into subscriber (email, source, confirmed_at, wants, desired_latency_ms) values ($1, $2, now(), $3::text[], $4::integer)
        on conflict (email) do update set
          confirmed_at = coalesce(subscriber.confirmed_at, now()),
          wants = case when cardinality(excluded.wants) > 0 then excluded.wants else subscriber.wants end,
          desired_latency_ms = case when cardinality(excluded.wants) > 0 then excluded.desired_latency_ms else subscriber.desired_latency_ms end
        where subscriber.unsubscribed_at is null
        returning (confirmed_at = now()) as added`,
      params: [email, source.slice(0, 32), `{${wants.join(",")}}`, desiredLatencyMs],
    }),
  });
  if (!res.ok) throw new Unavailable(`neon returned ${res.status}`);
  const result = await res.json() as { rows?: { added?: boolean }[] };
  return result.rows?.[0]?.added === true;
}

/** GET is read-only: scanners must not activate subscriptions by opening a link. */
export function confirmationPage(token: string, wants: ReadonlyArray<string> = [], desiredLatencyMs: number | null = null): string {
  const names = wantedNames(wants);
  return page({
    title: "confirm subscription · classifier.dev",
    body: `<div class="page"><main><article class="doc prose">
      <header><h1>Confirm your subscription</h1></header>
      <p>Get one email when a classifier.dev roadmap item ships.</p>
      ${names.length ? `<p class="quote">You ticked: ${esc(names.join(", "))}.</p>` : ""}
      ${desiredLatencyMs !== null ? `<p class="quote">Desired latency: ${desiredLatencyMs} ms.</p>` : ""}
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
export async function notify(
  env: Env,
  email: string,
  source: string,
  wants: ReadonlyArray<string> = [],
  desiredLatencyMs: number | null = null,
): Promise<void> {
  if (!env.RESEND_API_KEY || !env.REPORT_TO) return;

  const date = new Date().toISOString();
  const names = wantedNames(wants);
  const body = [
    `Subscriber: ${email}`,
    `Source: ${source}`,
    `Wants: ${names.length ? names.join(", ") : "(nothing ticked)"}`,
    ...(desiredLatencyMs !== null ? [`Desired latency: ${desiredLatencyMs} ms`] : []),
    `Date: ${date}`,
    "",
    "The subscriber list is in the application's subscriber table.",
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
