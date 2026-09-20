import { expect, test } from "bun:test";
import { HOME_CSS, homeHtml } from "../src/home";
import { CHAT_CSS } from "../src/chatui";
import { BILLING_PLANS, formatCreditsUsd } from "../src/lib/billing";
import { PRICING } from "../src/pages";
import { pricingHtml } from "../src/pricingui";

test("public navigation exposes pricing and the WorkOS entry points", () => {
  const html = homeHtml();
  expect(html).toContain('class="site-header"');
  expect(html).toContain('href="/pricing"');
  expect(html).toContain('href="/login">Log in</a>');
  expect(html).toContain('href="/auth/sign-up">Sign up</a>');
  expect(html).toContain('href="/auth/sign-up">Get started</a>');
  expect(html).toContain('href="/chat"');
  expect(html).toContain('href="/openapi.json"');
  expect(html).toContain('href="/skill.md"');
  expect(html).toContain('href="/llms.txt"');
  expect(html).toContain('class="site-menu-resources"');
  expect(html).toContain('class="site-menu-actions"');
  expect(html).toContain('<span class="sr">Menu</span>');
  expect(html).not.toContain('href="/pro"');
});

test("public navigation and its menus stay above content but below the chat controls", () => {
  const headerLayer = Number(/\.site-header\{[^}]*z-index:(\d+)/.exec(HOME_CSS)?.[1]);
  const chatLayer = Number(/\.chat\{[^}]*z-index:(\d+)/.exec(CHAT_CSS)?.[1]);
  expect(headerLayer).toBeGreaterThan(0);
  expect(headerLayer).toBeLessThan(chatLayer);
  expect(homeHtml({chat: true})).toContain('class="chat" id="chat" aria-label="Chat">');
});

test("pricing renders current shared plan values and keeps legacy keys documented", () => {
  const html = pricingHtml();
  expect(html).toContain("simple plans with upfront usage");
  expect(html).toContain("more included usage + a shared workspace");
  expect(html).toContain('class="plan-grid"');
  expect(html).toContain('class="plan-action" href="/auth/sign-up"');
  expect(html).toContain(`$${BILLING_PLANS.pro.priceCents / 100}`);
  expect(html).toContain(formatCreditsUsd(BILLING_PLANS.pro.includedCredits));
  expect(html).toContain("laya-0.3.4-english-fast");
  expect(html).toContain("laya-0.3.4-english-bulk");
  expect(html).toContain('href="/auth/sign-up?returnTo=/app/plans"');
  expect(html).toContain("classifier_pro_");
  expect(html).not.toContain("/pricing/manage");
  expect(PRICING).toContain(formatCreditsUsd(BILLING_PLANS.free.includedCredits));
  expect(PRICING).toContain(formatCreditsUsd(BILLING_PLANS.pro.includedCredits));
});
