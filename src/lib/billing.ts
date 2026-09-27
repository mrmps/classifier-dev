/** Money stays in integer credits until presentation: one credit is $0.00001. */
export const CREDITS_PER_DOLLAR = 100_000;
export type BillingPlanId = "free" | "pro" | "scale";
export const BILLING_PLANS = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    seatLimit: 1,
    includedCredits: 500_000,
    rateLimitMultiplier: 1,
    description: "Start free. Upgrade your plan when you need more.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 2_000,
    seatLimit: 3,
    includedCredits: 2_000_000,
    rateLimitMultiplier: 10,
    description: "For individual developers and personal agents.",
  },
  scale: {
    id: "scale",
    name: "Scale",
    priceCents: 20_000,
    seatLimit: null,
    includedCredits: 20_000_000,
    rateLimitMultiplier: 100,
    description: "For teams running classification in production.",
  },
} as const;
export const PAID_PLANS = [BILLING_PLANS.pro, BILLING_PLANS.scale];
export const FREE_ALLOWANCE_CREDITS = BILLING_PLANS.free.includedCredits;
export function isBillingPlanId(value: unknown): value is BillingPlanId {
  return typeof value === "string" && Object.hasOwn(BILLING_PLANS, value);
}
/** Rate limits are the one thing plans change besides included credits, so an
 * unknown or legacy plan id falls back to the paid Pro multiplier, never free. */
export function rateLimitMultiplier(plan: string, funded: boolean, keyHash?: string, overrides?: string): number {
  const base = isBillingPlanId(plan) && plan !== "free"
    ? BILLING_PLANS[plan].rateLimitMultiplier
    : funded ? BILLING_PLANS.pro.rateLimitMultiplier : 1;
  if (!funded || !keyHash || !overrides) return base;
  try {
    const configured: unknown = JSON.parse(overrides);
    if (!configured || typeof configured !== "object" || Array.isArray(configured) || !Object.hasOwn(configured, keyHash)) return base;
    const value = (configured as Record<string, unknown>)[keyHash];
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1000
      ? Math.max(base, value) : base;
  } catch {
    return base;
  }
}
/** Pay-as-you-go top-ups: whole dollars, bounded so one typo cannot run away. */
export const TOP_UP_MIN_CENTS = 500;
export const TOP_UP_MAX_CENTS = 100_000;
export function isValidTopUpCents(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= TOP_UP_MIN_CENTS &&
    value <= TOP_UP_MAX_CENTS &&
    value % 100 === 0
  );
}
export const creditsToDollars = (credits: number) =>
  credits / CREDITS_PER_DOLLAR;
export const centsToCredits = (cents: number) =>
  cents * (CREDITS_PER_DOLLAR / 100);
export const formatCreditsUsd = (credits: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 5,
  }).format(creditsToDollars(credits));
export const formatCents = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

export const dollarsToCredits = (dollars: number) =>
  Math.round(dollars * CREDITS_PER_DOLLAR);
