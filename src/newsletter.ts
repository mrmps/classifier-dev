/**
 * The updates list.
 *
 * One address, one date, in a Postgres that holds nothing else. No IP, no user
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

  One mail when something on that list ships, and nothing in between. The list
  holds the address and the date it arrived, in a database with no other
  table, so there is nothing to join it to, here or anywhere else.
  Unsubscribing is a reply.
`;
}

class Unavailable extends Error {}

/**
 * Append an address.
 *
 * `on conflict do nothing` makes a second submission a no-op, which also means
 * the response cannot be used to test whether an address is already on the
 * list — a subscribe endpoint that answers "already subscribed" is an address
 * oracle for anyone who wants one.
 */
export async function subscribe(env: Env, email: string, source: string): Promise<void> {
  const conn = env.NEWSLETTER_DATABASE_URL;
  if (!conn) throw new Unavailable("NEWSLETTER_DATABASE_URL is not set");

  const res = await fetch(`https://${new URL(conn).host}/sql`, {
    method: "POST",
    headers: { "content-type": "application/json", "neon-connection-string": conn },
    body: JSON.stringify({
      query: `insert into subscriber (email, source) values ($1, $2) on conflict (email) do nothing`,
      params: [email, source.slice(0, 32)],
    }),
  });

  if (!res.ok) {
    // The body can carry the connection string back in an error; log the status only.
    throw new Unavailable(`neon returned ${res.status}`);
  }
}

export { Unavailable };

/**
 * Notify the owner of a new subscription via email.
 *
 * Fire-and-forget: the notification is sent via ctx.waitUntil, so a Resend
 * outage never makes a signup fail. This means the response to the subscriber
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
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * What a browser with JavaScript turned off gets back. The form posts normally
 * in that case, so the answer has to be a page rather than a JSON body.
 */
export function resultPage(ok: boolean, message: string): string {
  return page({
    title: ok ? "subscribed · classifier.dev" : "classifier.dev updates",
    body: `<div class="page"><main><article class="doc prose">
  <header><h1><span class="syn"># </span>classifier.dev updates</h1></header>
  <p class="${ok ? "quote" : "note"}">${esc(message)}</p>
  <p class="row">${btn("back to classifier.dev", { cls: "dim", href: "/" })}</p>
</article></main></div>`,
  });
}
