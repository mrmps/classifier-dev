// The redesigned home page for browsers. curl, agents, crawlers and unfurlers keep the
// generated text, Markdown and JSON from src/home.ts and src/index.ts; only a browser that
// asks for HTML gets this page. Its scripts, styles, fonts and media are static files in
// public/site/, served by Workers static assets at /site/.
//
// The design is hand-made, but what it states is not: every price, limit and threshold is a
// <data value="key"> element whose text is filled here from the same constants the API,
// the pricing page and the plain text use.
import { HOME_TEMPLATE } from "./home-template";
import { AGENT_PROMPT, JSON_LD } from "../home";
import { esc } from "../ui";
import { BILLING_PLANS, TOP_UP_MAX_CENTS, TOP_UP_MIN_CENTS, creditsToDollars } from "../lib/billing";
import { CLASSIFICATION_PRICING, LONG_CONTEXT_PRICING } from "../lib/classification-pricing";
import { SCRAPE_NANODOLLARS } from "../scrape";
import { LONG_CONTEXT_JOB_MAX_TOKENS } from "../long-context";
import { ESCALATE_BELOW, MAX_INPUTS, TIERS } from "../index";
import { ROADMAP, FASTER_INFERENCE_KEY, MIN_DESIRED_LATENCY_MS, MAX_DESIRED_LATENCY_MS } from "../newsletter";

const count = (n: number) => n.toLocaleString("en-US");
const usd = (dollars: number, digits = dollars % 1 === 0 ? 0 : 2) =>
  `$${dollars.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const perMillion = (nanodollars: number) => usd(nanodollars / 1000, 3);
const perThousand = (nanodollars: number) => usd(nanodollars / 1e6);
const words = (n: number) => (n % 1e6 === 0 ? `${n / 1e6} million` : count(n));

/** What each <data value="key"> on the page says. A key the page uses and this map lacks is an error. */
export function siteValues(): Record<string, string> {
  const { free, pro, scale } = BILLING_PLANS;
  return {
    "plan.free.price": usd(free.priceCents / 100),
    "plan.free.credit": usd(creditsToDollars(free.includedCredits)),
    "plan.free.seats": String(free.seatLimit),
    "plan.pro.price": usd(pro.priceCents / 100),
    "plan.pro.included": usd(creditsToDollars(pro.includedCredits)),
    "plan.pro.seats": String(pro.seatLimit),
    "plan.pro.rate": `${pro.rateLimitMultiplier}×`,
    "plan.scale.price": usd(scale.priceCents / 100),
    "plan.scale.included": usd(creditsToDollars(scale.includedCredits)),
    "plan.scale.rate": `${scale.rateLimitMultiplier}×`,
    "topup.min": usd(TOP_UP_MIN_CENTS / 100),
    "topup.max": usd(TOP_UP_MAX_CENTS / 100),
    "rate.input": perMillion(CLASSIFICATION_PRICING.inputNanodollars),
    "rate.smart": perThousand(CLASSIFICATION_PRICING.escalationNanodollars),
    "rate.long": perMillion(LONG_CONTEXT_PRICING.inputNanodollars),
    "rate.web": perThousand(SCRAPE_NANODOLLARS),
    "free.fast.rpm": count(TIERS.fast.rpm),
    "free.fast.daily": count(TIERS.fast.daily),
    "free.smart.rpm": count(TIERS.smart.rpm),
    "free.smart.daily": count(TIERS.smart.daily),
    "smart.below": `${Math.round(ESCALATE_BELOW * 100)}%`,
    "max.inputs": count(MAX_INPUTS),
    "long.tokens": words(LONG_CONTEXT_JOB_MAX_TOKENS),
    // Rate limits per plan: the free tier's, times the plan's multiplier (the pricing page).
    ...Object.fromEntries(([["free", free], ["pro", pro], ["scale", scale]] as const).flatMap(([k, plan]) =>
      (["fast", "smart"] as const).map((t) => [`lim.${k}.${t}`, `${count(TIERS[t].rpm * plan.rateLimitMultiplier)}/min · ${count(TIERS[t].daily * plan.rateLimitMultiplier)}/day`]))),
  };
}

const DATA = /<data value="([a-z0-9.-]+)">[^<]*<\/data>/g;

export function fillValues(html: string, values = siteValues()): string {
  return html.replace(DATA, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new Error(`site/home: no value for <data value="${key}">`);
    return `<data value="${key}">${esc(values[key])}</data>`;
  });
}

/**
 * The chips in the toast that follows a subscribe: one per ROADMAP item (its detail as the title),
 * and for "faster" the latency wanted. All optional; the page sends them with the email.
 */
export function roadmapFields(): string {
  const chips = ROADMAP.map((r) =>
    `    <label class="upd__chip" for="want-${r.key}" title="${esc(r.what)}"><input id="want-${r.key}" type="checkbox" name="wants" value="${r.key}"><svg class="i" aria-hidden="true"><use href="#i-check"/></svg>${esc(r.name)}</label>`);
  const latency = ROADMAP.some((r) => r.key === FASTER_INFERENCE_KEY)
    ? [`    <span class="upd__latency" data-latency hidden><label for="want-desired-latency">Desired latency</label><input id="want-desired-latency" type="number" name="desired_latency_ms" min="${MIN_DESIRED_LATENCY_MS}" max="${MAX_DESIRED_LATENCY_MS}" step="1" inputmode="numeric" aria-describedby="want-latency-unit"><span id="want-latency-unit">ms</span></span>`]
    : [];
  return [...chips, ...latency].join("\n");
}

const LOGIN = '<a class="btn btn--soft btn--sm nav__login" href="/login">Log in</a>';
const MENU_LOGIN = '<a class="menu__row" href="/login">Log in</a>';
const DASHBOARD = '<a class="btn btn--soft btn--sm nav__login" href="/app">Dashboard</a>';
const MENU_DASHBOARD = '<a class="menu__row" href="/app">Dashboard</a>';
const ROADMAP_SLOT = "<!--@roadmap-->";

for (const marker of [LOGIN, MENU_LOGIN, ROADMAP_SLOT])
  if (!HOME_TEMPLATE.includes(marker)) throw new Error(`site/home: the template lost ${marker}`);

// Built on first use, not at import: the constants come from modules that import this one.
let pages: { out: string; in: string } | null = null;
function build() {
  const page = fillValues(HOME_TEMPLATE)
    // The setup prompt the page copies and deep-links is the site's own, the one curl prints.
    .replace(/data-agent-prompt="[^"]*"/, `data-agent-prompt="${esc(AGENT_PROMPT)}"`)
    .replace(ROADMAP_SLOT, roadmapFields())
    // Search engines get the same structured data as before: the FAQ quotes the measured accuracies.
    .replace("</head>", `${JSON_LD()}\n</head>`);
  return { out: page, in: page.replace(LOGIN, DASHBOARD).replace(MENU_LOGIN, MENU_DASHBOARD) };
}

export function siteHomeHtml(o: { signedIn?: boolean } = {}): string {
  pages ??= build();
  return o.signedIn ? pages.in : pages.out;
}

/**
 * The page's Content-Security-Policy. The generated pages need only inline scripts; this one
 * also loads its own scripts, stylesheets, fonts and media, so those may come from /site/ on
 * this origin and nowhere else. Inline scripts are allowed by hash, as on every other page.
 */
export function sitePolicy(origin: string, inlineScriptHashes: string[]): string {
  const site = `${origin}/site/`;
  return [
    "default-src 'none'",
    `script-src ${[site, ...inlineScriptHashes].join(" ")}`,
    `style-src ${site} 'unsafe-inline'`,
    `font-src ${site}`,
    `media-src ${site}`,
    "img-src 'self' data: blob:",
    "connect-src 'self' https://classifier.dev",
    `manifest-src ${site}`,
    "form-action 'self'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}
