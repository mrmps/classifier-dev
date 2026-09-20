/** Money stays in integer credits until presentation: one credit is $0.00001. */
export const CREDITS_PER_DOLLAR = 100_000;
export type BillingPlanId = "free" | "pro" | "max" | "scale";
export const BILLING_PLANS = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    seatLimit: 1,
    includedCredits: 500_000,
    description: "Start free. Upgrade your plan when you need more.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 2_000,
    seatLimit: 3,
    includedCredits: 2_000_000,
    description: "For individual developers and personal agents.",
  },
  max: {
    id: "max",
    name: "Max",
    priceCents: 10_000,
    seatLimit: 3,
    includedCredits: 13_000_000,
    description: "For growing applications and frequent agent workloads.",
  },
  scale: {
    id: "scale",
    name: "Scale",
    priceCents: 39_900,
    seatLimit: null,
    includedCredits: 60_000_000,
    description: "For teams running classification in production.",
  },
} as const;
export const PAID_PLANS = [
  BILLING_PLANS.pro,
  BILLING_PLANS.max,
  BILLING_PLANS.scale,
];
export const FREE_ALLOWANCE_CREDITS = BILLING_PLANS.free.includedCredits;
export function isBillingPlanId(value: unknown): value is BillingPlanId {
  return typeof value === "string" && Object.hasOwn(BILLING_PLANS, value);
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
