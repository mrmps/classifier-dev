import { expect, test } from "bun:test";
import { homeHtml } from "../src/home";
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
  expect(html).not.toContain('href="/pro"');
});

test("pricing renders current shared plan values and keeps legacy keys documented", () => {
  const html = pricingHtml();
  expect(html).toContain("Pricing that grows with your workload.");
  expect(html).toContain(`$${BILLING_PLANS.pro.priceCents / 100}`);
  expect(html).toContain(formatCreditsUsd(BILLING_PLANS.pro.includedCredits));
  expect(html).toContain('href="/auth/sign-up?returnTo=/app/plans"');
  expect(html).toContain("classifier_pro_");
  expect(html).not.toContain("/pricing/manage");
  expect(PRICING).toContain(formatCreditsUsd(BILLING_PLANS.free.includedCredits));
  expect(PRICING).toContain(formatCreditsUsd(BILLING_PLANS.pro.includedCredits));
});
