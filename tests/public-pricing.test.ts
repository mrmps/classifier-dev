import { expect, test } from "bun:test";
import { HOME_CSS, NAV, homeHtml } from "../src/home";
import { CHAT_CSS } from "../src/chatui";
import { BILLING_PLANS, formatCreditsUsd } from "../src/lib/billing";
import { PRICING } from "../src/pages";
import { pricingHtml } from "../src/pricingui";
import { BASE_CSS } from "../src/ui";
import worker, { type Env } from "../src/index";

const ctx = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

test("public navigation exposes pricing and the WorkOS entry points", () => {
  const html = homeHtml();
  expect(html).toContain('class="site-header"');
  expect(html).toContain('href="/pricing"');
  expect(html).toContain('href="/login">Log in</a>');
  expect(html).toContain('href="/auth/sign-up">Sign up</a>');
  expect(html).toContain('href="/auth/sign-up">Get started</a>');
  expect(html).not.toContain('href="/chat"');
  expect(html).toContain('href="/openapi.json"');
  expect(html).toContain('href="/skill.md"');
  expect(html).toContain('href="/llms.txt"');
  expect(html).toContain('class="site-menu-resources"');
  expect(html).toContain('class="site-menu-actions"');
  expect(html).toContain('<span class="sr">Menu</span>');
  expect(html).not.toContain('href="/pro"');
});

test("authenticated navigation replaces account entry points with the dashboard", () => {
  const html = NAV("home", true);
  expect(html).toContain('href="/app">Dashboard</a>');
  expect(html).not.toContain('href="/login"');
  expect(html).not.toContain('href="/auth/sign-up"');
});

test("the public worker renders authenticated navigation as a cookie variant", async () => {
  const response = await worker.fetch(
    new Request("https://classifier.dev/", {
      headers: { Accept: "text/html" },
    }),
    {} as Env,
    ctx,
    { viewer: { signedIn: true } },
  );
  const html = await response.text();

  expect(html).toContain('href="/app">Dashboard</a>');
  expect(response.headers.get("Vary")).toContain("cookie");
});

test("public navigation stays above content and does not expose internal chat", () => {
  const headerLayer = Number(/\.site-header\{[^}]*z-index:(\d+)/.exec(HOME_CSS)?.[1]);
  const chatLayer = Number(/\.chat\{[^}]*z-index:(\d+)/.exec(CHAT_CSS)?.[1]);
  expect(headerLayer).toBeGreaterThan(0);
  expect(headerLayer).toBeLessThan(chatLayer);
  expect(homeHtml({chat: true})).not.toContain('class="chat" id="chat" aria-label="Chat">');
});

test("the open mobile menu removes the newsletter dock from view and interaction", () => {
  const mobileMenuCss = HOME_CSS.slice(
    HOME_CSS.indexOf("@media(max-width:1024px)"),
    HOME_CSS.indexOf("@media(max-width:420px)"),
  );
  expect(mobileMenuCss).toMatch(/body:has\(\.site-menu\[open\]\)\s+\.dock\s*\{\s*display:\s*none\s*;?\s*\}/);
});

test("desktop navigation uses one compact control row and a wide-gamut purple accent", () => {
  expect(HOME_CSS).toMatch(/\.site-link,\.site-action\{[^}]*min-height:36px[^}]*line-height:1/);
  expect(HOME_CSS).toMatch(/\.site-action\.primary\{min-height:36px/);
  expect(HOME_CSS).toMatch(/\.site-actions\{display:flex;align-items:center;gap:8px\}/);
  expect(BASE_CSS).toContain("--accent:#aa63ff; --accent-hover:#bb82ff");
  expect(BASE_CSS).toContain("--accent:color(display-p3 .63 .40 1)");
});

test("pricing renders workspace plans and Pro rate limits", () => {
  const html = pricingHtml();
  expect(html).toContain("simple plans with upfront usage");
  expect(html).toContain("10× rate limits");
  expect(html).toContain('class="plan-grid"');
  expect(html).toContain('class="plan-action" href="/auth/sign-up"');
  expect(html).toContain(`$${BILLING_PLANS.pro.priceCents / 100}`);
  expect(html).toContain(formatCreditsUsd(BILLING_PLANS.pro.includedCredits));
  expect(html).toContain("jev/laya");
  expect(html).toContain("jev/kev");
  expect(html).toContain('href="/auth/sign-up?returnTo=/app/plans"');
  expect(html).not.toContain("classifier_pro_");
  expect(html).toContain("30,000/min · 200,000/day");
  expect(html).toContain("shared across workspace keys and agents");
  expect(html).not.toContain("/pricing/manage");
  expect(PRICING).toContain(formatCreditsUsd(BILLING_PLANS.free.includedCredits));
  expect(PRICING).toContain(formatCreditsUsd(BILLING_PLANS.pro.includedCredits));
});
