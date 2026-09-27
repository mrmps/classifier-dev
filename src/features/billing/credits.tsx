import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowRight, CreditCard, Refresh } from "@/components/ui/icons";
import {
  BILLING_PLANS,
  TOP_UP_MAX_CENTS,
  TOP_UP_MIN_CENTS,
  formatCents,
  formatCreditsUsd,
  isValidTopUpCents,
} from "@/lib/billing";
import type { AppAction, AppSnapshot } from "@/server/contracts";

const date = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const TOP_UP_PRESETS_CENTS = [500, 1_000, 2_500, 5_000, 10_000];

function dollarsToCents(value: string): number | null {
  if (!/^\d{1,4}$/.test(value.trim())) return null;
  return Number(value.trim()) * 100;
}

const CARD_BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};
const brandName = (brand: string) =>
  CARD_BRANDS[brand] ??
  brand.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());

export function Credits({
  snapshot,
  navigate,
  act,
}: {
  snapshot: AppSnapshot;
  navigate: (path: string) => void;
  act?: (action: AppAction) => Promise<unknown>;
}) {
  const { billing } = snapshot;
  const [portalError, setPortalError] = useState("");
  const [openingPortal, setOpeningPortal] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("25");
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [topUpError, setTopUpError] = useState("");
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoEnabled, setAutoEnabled] = useState(billing.autoTopUp.enabled);
  const [autoAmount, setAutoAmount] = useState("10");
  const [autoThreshold, setAutoThreshold] = useState("5");
  const [autoCap, setAutoCap] = useState("");
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoError, setAutoError] = useState("");
  const refreshed = useRef(false);
  useEffect(() => {
    // Returning from a checkout or payment setup: verify with the provider
    // right away instead of waiting for a webhook, then reload the snapshot.
    if (refreshed.current || !act) return;
    if (!new URLSearchParams(window.location.search).has("billing")) return;
    refreshed.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      try {
        const { refreshBilling } = await import("./billing.functions");
        await refreshBilling();
      } catch {
        /* reconciliation retries on the next sync */
      }
      await act({ type: "refresh" }).catch(() => {});
    })();
  }, [act]);
  async function openPortal(action: "portal" | "setup-payment" = "portal") {
    setOpeningPortal(true);
    setPortalError("");
    try {
      const { billingRedirect } = await import("./checkout");
      window.location.assign(await billingRedirect({ action }));
    } catch {
      setPortalError("Payment management is unavailable. Try again shortly.");
    } finally {
      setOpeningPortal(false);
    }
  }
  async function startTopUp() {
    const cents = dollarsToCents(topUpAmount);
    if (cents === null || !isValidTopUpCents(cents)) {
      setTopUpError(
        `Enter a whole dollar amount between ${formatCents(TOP_UP_MIN_CENTS)} and ${formatCents(TOP_UP_MAX_CENTS)}.`,
      );
      return;
    }
    setTopUpBusy(true);
    setTopUpError("");
    try {
      const { billingRedirect } = await import("./checkout");
      window.location.assign(
        await billingRedirect({ action: "top-up", amountCents: cents }),
      );
    } catch (cause) {
      setTopUpError(
        cause instanceof Error
          ? cause.message
          : "Checkout is unavailable. Try again shortly.",
      );
    } finally {
      setTopUpBusy(false);
    }
  }
  function openAutoRecharge(enable = billing.autoTopUp.enabled) {
    setAutoEnabled(enable);
    setAutoAmount(String(billing.autoTopUp.amountCents / 100));
    setAutoThreshold(String(billing.autoTopUp.thresholdCents / 100));
    setAutoCap(
      billing.autoTopUp.capCents > 0
        ? String(billing.autoTopUp.capCents / 100)
        : "",
    );
    setAutoError("");
    setAutoOpen(true);
  }
  async function saveAutoTopUp() {
    const amount = dollarsToCents(autoAmount);
    const threshold = dollarsToCents(autoThreshold);
    const cap = autoCap.trim() === "" ? 0 : dollarsToCents(autoCap);
    if (amount === null || !isValidTopUpCents(amount)) {
      setAutoError(
        `The recharge amount is a whole dollar amount between ${formatCents(TOP_UP_MIN_CENTS)} and ${formatCents(TOP_UP_MAX_CENTS)}.`,
      );
      return;
    }
    if (threshold === null || threshold < 100) {
      setAutoError("The balance threshold is a whole dollar amount of at least $1.");
      return;
    }
    if (cap === null) {
      setAutoError("The monthly maximum is a whole dollar amount, or blank for no maximum.");
      return;
    }
    setAutoBusy(true);
    setAutoError("");
    try {
      const { updateAutoTopUp } = await import("./billing.functions");
      await updateAutoTopUp({
        data: {
          enabled: autoEnabled,
          amountCents: amount,
          thresholdCents: threshold,
          capCents: cap,
        },
      });
      await act?.({ type: "refresh" }).catch(() => {});
      setAutoOpen(false);
    } catch (cause) {
      setAutoError(
        cause instanceof Error
          ? cause.message
          : "Auto recharge settings could not be saved. Try again.",
      );
    } finally {
      setAutoBusy(false);
    }
  }
  const plan = BILLING_PLANS[billing.plan];
  const scheduledPlan = billing.scheduledPlan
    ? BILLING_PLANS[billing.scheduledPlan]
    : null;
  const canManage = snapshot.organizations?.active.role === "owner";
  const payAsYouGo = billing.payAsYouGo && billing.mode === "autumn";
  const paymentMethod = billing.paymentMethod;
  // null means the card on file has not been observed yet; never block on it.
  const missingCard = paymentMethod?.type === "none";
  const autoRecharge = billing.autoTopUp;
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
            ? "Your plan, balance and pay-as-you-go top-ups."
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
              <h2 className="text-base font-semibold">{plan.name} plan</h2>
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
              <div className="flex flex-col items-end gap-2">
                {payAsYouGo && canManage && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setTopUpError("");
                      setTopUpOpen(true);
                    }}
                  >
                    Top up balance
                  </Button>
                )}
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground tabular-nums">
                    {formatCreditsUsd(allowance)}
                  </span>{" "}
                  {allowanceDescription}
                </p>
              </div>
            </div>
            {payAsYouGo && (
              <div
                className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border p-4 ${
                  autoRecharge.enabled && autoRecharge.lastFailure
                    ? "border-destructive/50"
                    : "border-border"
                }`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Refresh className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex flex-col gap-1 text-sm">
                    <p className="font-medium">
                      {autoRecharge.enabled
                        ? "Auto recharge is on"
                        : "Auto recharge is off"}
                    </p>
                    <p className="text-muted-foreground">
                      {autoRecharge.enabled ? (
                        autoRecharge.lastFailure ? (
                          "The last automatic recharge failed. Update your payment method; retries pause for an hour."
                        ) : (
                          <>
                            Adds{" "}
                            <span className="font-medium text-foreground tabular-nums">
                              {formatCents(autoRecharge.amountCents)}
                            </span>{" "}
                            when your balance falls below{" "}
                            <span className="tabular-nums">
                              {formatCents(autoRecharge.thresholdCents)}
                            </span>
                            {autoRecharge.capCents > 0 && (
                              <>
                                {" · "}
                                <span className="tabular-nums">
                                  {formatCents(autoRecharge.monthUsedCents)} of{" "}
                                  {formatCents(autoRecharge.capCents)}
                                </span>{" "}
                                used this month
                              </>
                            )}
                          </>
                        )
                      ) : (
                        "When your balance runs out, new requests stop. Enable auto recharge to top up automatically."
                      )}
                    </p>
                  </div>
                </div>
                {canManage &&
                  (autoRecharge.enabled && autoRecharge.lastFailure ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={openingPortal}
                        onClick={() => void openPortal("setup-payment")}
                      >
                        Update payment method
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => openAutoRecharge()}
                      >
                        Edit
                      </Button>
                    </div>
                  ) : autoRecharge.enabled ? (
                    <Button
                      variant="outline"
                      onClick={() => openAutoRecharge()}
                    >
                      Edit
                    </Button>
                  ) : (
                    <Button onClick={() => openAutoRecharge(true)}>
                      Enable auto recharge
                    </Button>
                  ))}
              </div>
            )}
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
                  : `Renews on ${renewal}.`}
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
              Payment method
            </dt>
            <dd className="flex flex-col gap-2 text-sm text-muted-foreground sm:max-w-sm sm:items-end">
              {billing.mode === "autumn" ? (
                <>
                  {paymentMethod?.type === "card" ? (
                    <p>
                      <span className="font-medium text-foreground">
                        {brandName(paymentMethod.brand)}{" "}
                        <span className="tabular-nums">
                          ···· {paymentMethod.last4}
                        </span>
                      </span>{" "}
                      <span className="tabular-nums">
                        · valid until {paymentMethod.expMonth}/
                        {paymentMethod.expYear}
                      </span>
                    </p>
                  ) : paymentMethod?.type === "other" ? (
                    <p>A payment method is saved for this workspace.</p>
                  ) : missingCard ? (
                    <p>
                      No payment method on file. Add one to enable credit
                      purchases and automatic recharges.
                    </p>
                  ) : null}
                  {canManage ? (
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      {missingCard && (
                        <Button
                          disabled={openingPortal}
                          onClick={() => void openPortal("setup-payment")}
                        >
                          Add payment method
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        disabled={openingPortal}
                        onClick={() => void openPortal()}
                      >
                        {openingPortal
                          ? "Opening…"
                          : "Manage payments and invoices"}
                      </Button>
                    </div>
                  ) : (
                    <p>Your workspace owner manages payments and invoices.</p>
                  )}
                </>
              ) : (
                "Payment management is not connected yet."
              )}
              {portalError && (
                <p role="alert" className="text-destructive">
                  {portalError}
                </p>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <Dialog
        open={topUpOpen}
        onOpenChange={(open) => {
          if (!topUpBusy) setTopUpOpen(open);
        }}
      >
        <DialogContent showCloseButton={!topUpBusy}>
          <DialogHeader>
            <DialogTitle>Top up balance</DialogTitle>
            <DialogDescription>
              Add pay-as-you-go funds to your workspace. Purchased funds never
              expire and are used after your included plan allowance.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {TOP_UP_PRESETS_CENTS.map((cents) => (
              <Button
                key={cents}
                size="sm"
                variant={
                  dollarsToCents(topUpAmount) === cents ? "default" : "outline"
                }
                onClick={() => setTopUpAmount(String(cents / 100))}
              >
                {formatCents(cents)}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="top-up-amount">Amount ($)</Label>
            <Input
              id="top-up-amount"
              inputMode="numeric"
              value={topUpAmount}
              onChange={(event) => setTopUpAmount(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Whole dollar amounts between {formatCents(TOP_UP_MIN_CENTS)} and{" "}
              {formatCents(TOP_UP_MAX_CENTS)}. Your balance updates after the
              payment is confirmed.
            </p>
          </div>
          {topUpError && (
            <p role="alert" className="text-sm text-destructive">
              {topUpError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={topUpBusy}
              onClick={() => setTopUpOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={topUpBusy} onClick={() => void startTopUp()}>
              {topUpBusy ? "Opening…" : "Continue to checkout"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={autoOpen}
        onOpenChange={(open) => {
          if (!autoBusy) setAutoOpen(open);
        }}
      >
        <DialogContent showCloseButton={!autoBusy}>
          <DialogHeader>
            <DialogTitle>Auto recharge</DialogTitle>
            <DialogDescription>
              When your balance falls below the threshold, the saved payment
              method is charged the recharge amount. Purchased funds never
              expire.
            </DialogDescription>
          </DialogHeader>
          {missingCard ? (
            <Alert>
              <AlertTitle>Add a payment method first</AlertTitle>
              <AlertDescription>
                <p>
                  Automatic recharges charge your saved payment method, so one
                  must be on file before auto recharge can be enabled.
                </p>
                <Button
                  size="sm"
                  className="mt-2 w-fit"
                  disabled={openingPortal}
                  onClick={() => void openPortal("setup-payment")}
                >
                  {openingPortal ? "Opening…" : "Add payment method"}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4">
                <Label htmlFor="auto-recharge-enabled">
                  Enable auto recharge
                </Label>
                <Switch
                  id="auto-recharge-enabled"
                  checked={autoEnabled}
                  onCheckedChange={setAutoEnabled}
                />
              </div>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="auto-recharge-amount">
                    Recharge amount ($)
                  </Label>
                  <Input
                    id="auto-recharge-amount"
                    inputMode="numeric"
                    disabled={!autoEnabled}
                    value={autoAmount}
                    onChange={(event) => setAutoAmount(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="auto-recharge-threshold">
                    When balance falls below ($)
                  </Label>
                  <Input
                    id="auto-recharge-threshold"
                    inputMode="numeric"
                    disabled={!autoEnabled}
                    value={autoThreshold}
                    onChange={(event) => setAutoThreshold(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="auto-recharge-cap">
                    Monthly maximum ($, blank for none)
                  </Label>
                  <Input
                    id="auto-recharge-cap"
                    inputMode="numeric"
                    disabled={!autoEnabled}
                    value={autoCap}
                    onChange={(event) => setAutoCap(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatCents(autoRecharge.monthUsedCents)} recharged
                    automatically this month.
                  </p>
                </div>
              </div>
              {autoError && (
                <p role="alert" className="text-sm text-destructive">
                  {autoError}
                </p>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={autoBusy}
                  onClick={() => setAutoOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  disabled={autoBusy}
                  onClick={() => void saveAutoTopUp()}
                >
                  {autoBusy ? "Saving…" : "Save settings"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
