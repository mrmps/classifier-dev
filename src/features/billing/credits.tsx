import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, CreditCard } from "@/components/ui/icons";
import { BILLING_PLANS, formatCents, formatCreditsUsd } from "@/lib/billing";
import type { AppSnapshot } from "@/server/contracts";

const date = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function Credits({
  snapshot,
  navigate,
}: {
  snapshot: AppSnapshot;
  navigate: (path: string) => void;
}) {
  const { billing } = snapshot;
  const [portalError, setPortalError] = useState("");
  const [openingPortal, setOpeningPortal] = useState(false);
  async function openPortal() {
    setOpeningPortal(true);
    setPortalError("");
    try {
      const { billingRedirect } = await import("./checkout");
      window.location.assign(await billingRedirect("portal"));
    } catch {
      setPortalError("Payment management is unavailable. Try again shortly.");
    } finally {
      setOpeningPortal(false);
    }
  }
  const plan = BILLING_PLANS[billing.plan];
  const scheduledPlan = billing.scheduledPlan
    ? BILLING_PLANS[billing.scheduledPlan]
    : null;
  const canManage = snapshot.organizations?.active.role === "owner";
  const free = billing.plan === "free";
  const allowance = snapshot.credits.included;
  const allowanceDescription = free
    ? "one-time signup credit"
    : "included per month";
  const renewal = date(snapshot.credits.resetAt);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Billing"
        description={
          free
            ? "Your plan and one-time signup balance."
            : "Your plan and usage for this billing period."
        }
      />

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground">
              <CreditCard className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{plan.name} plan</h2>
                {billing.mode === "demo" && (
                  <Badge variant="secondary">Demo</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="tabular-nums">
                  {formatCents(plan.priceCents)}
                </span>
                {" / month"}
              </p>
            </div>
          </div>
          <Button onClick={() => navigate("/app/plans")}>
            {billing.plan === "scale" || !canManage || scheduledPlan
              ? "View plans"
              : "Upgrade plan"}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>

        <CardContent className="flex flex-col gap-6 border-t border-border p-5 sm:p-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-2">
                <h3 className="text-sm text-muted-foreground">
                  Available balance
                </h3>
                <p className="text-3xl font-semibold tracking-tight tabular-nums">
                  {formatCreditsUsd(billing.availableCredits)}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">
                  {formatCreditsUsd(allowance)}
                </span>{" "}
                {allowanceDescription}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
              <p className="text-muted-foreground">
                Exact balance, after funds reserved for in-flight requests.
              </p>
              <Button
                variant="link"
                size="sm"
                className="-mr-2"
                onClick={() => navigate("/app/usage")}
              >
                View usage <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>
              {scheduledPlan
                ? `Changes to ${scheduledPlan.name} on ${renewal}.`
                : billing.plan === "free"
                  ? "Free credit is granted once at personal signup. It does not replenish or transfer to teams."
                  : `${billing.mode === "demo" ? "Demo period renews" : "Renews"} on ${renewal}.`}
            </p>
            {snapshot.credits.bonus > 0 && (
              <p>
                You also have {formatCreditsUsd(snapshot.credits.bonus)} in
                bonus usage for this period.
              </p>
            )}
            {billing.paidCredits > 0 && (
              <p>
                Your existing {formatCreditsUsd(billing.paidCredits)} balance
                remains available after your included usage.
              </p>
            )}
            {!canManage && (
              <p>Your workspace owner manages the subscription.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <section
        aria-labelledby="billing-details"
        className="flex flex-col gap-4"
      >
        <h2 id="billing-details" className="text-base font-semibold">
          Billing details
        </h2>
        <dl className="divide-y divide-border rounded-xl border border-border px-5 sm:px-6">
          <div className="flex flex-col gap-1 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <dt className="text-sm text-muted-foreground">
              Your account email
            </dt>
            <dd className="break-all text-sm">
              {snapshot.organizations?.identity.email ?? snapshot.account.email}
            </dd>
          </div>
          <div className="flex flex-col gap-1 py-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <dt className="shrink-0 text-sm text-muted-foreground">
              Payment methods & invoices
            </dt>
            <dd className="text-sm text-muted-foreground sm:max-w-sm sm:text-right">
              {billing.mode === "autumn" && canManage ? (
                <Button
                  variant="outline"
                  disabled={openingPortal}
                  onClick={() => void openPortal()}
                >
                  {openingPortal ? "Opening…" : "Manage payments and invoices"}
                </Button>
              ) : billing.mode === "demo" ? (
                "No real payments are made in this demo."
              ) : billing.mode === "autumn" ? (
                "Your workspace owner manages payments and invoices."
              ) : (
                "Payment management is not connected yet."
              )}
              {portalError && (
                <p role="alert" className="mt-2 text-destructive">
                  {portalError}
                </p>
              )}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
