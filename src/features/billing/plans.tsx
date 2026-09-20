import { useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowRight, ArrowUpRight, Check } from "@/components/ui/icons";
import {
  BILLING_PLANS,
  formatCents,
  formatCreditsUsd,
  creditsToDollars,
  type BillingPlanId,
} from "@/lib/billing";
import type { ActionResult, AppAction, AppSnapshot } from "@/server/contracts";
import retailRates from "../../retail-rates.json";

const date = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
const price = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);

export function Plans({
  snapshot,
  act,
  navigate,
}: {
  snapshot: AppSnapshot;
  act: (action: AppAction) => Promise<ActionResult>;
  navigate: (path: string) => void;
}) {
  const { billing } = snapshot;
  const current = BILLING_PLANS[billing.plan];
  const [selection, setSelection] = useState<BillingPlanId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const attempt = useRef("");
  const selected = selection ? BILLING_PLANS[selection] : null;
  const keeping = selected?.id === current.id;
  const downgrading =
    selected !== null && selected.priceCents < current.priceCents;
  const amountDue =
    selected && !keeping && !downgrading
      ? selected.priceCents - current.priceCents
      : 0;
  const canManageBilling = snapshot.organizations?.active.role === "owner";
  const enabled = billing.mode !== "unconfigured" && canManageBilling;

  function choose(plan: BillingPlanId) {
    attempt.current = crypto.randomUUID();
    setError("");
    setMessage("");
    setSelection(plan);
  }

  async function confirm() {
    if (!selected || busy || !enabled) return;
    setBusy(true);
    setError("");
    try {
      if (billing.mode === "autumn") {
        const { billingRedirect } = await import("./checkout");
        window.location.assign(
          await billingRedirect(
            selected.id === "free" || current.id === "pro"
              ? "portal"
              : "checkout",
          ),
        );
        return;
      }
      await act({
        type: "billing-subscribe",
        plan: selected.id,
        idempotencyKey: attempt.current,
      });
      setMessage(
        keeping
          ? `Scheduled change canceled. Your ${selected.name} plan will continue.`
          : downgrading
            ? `Your workspace will move to ${selected.name} on ${date(snapshot.credits.resetAt)}.`
            : `${selected.name} is now active for this workspace.`,
      );
      setSelection(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your plan could not be changed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function actionLabel(plan: BillingPlanId) {
    if (current.id === plan) return "Current plan";
    if (billing.scheduledPlan === plan) return "Downgrade scheduled";
    return `${BILLING_PLANS[plan].priceCents > current.priceCents ? "Upgrade" : "Downgrade"} to ${BILLING_PLANS[plan].name}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <Button
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() => navigate("/app/credits")}
      >
        <ArrowRight data-icon="inline-start" className="rotate-180" />
        Back to billing
      </Button>
      <PageHeader
        title="Plans"
        description="Compare monthly usage allowances and team seats."
        action={
          <Badge variant="secondary">
            {billing.mode === "demo"
              ? "Demo pricing"
              : billing.mode === "autumn"
                ? "Token-based pricing"
                : "Checkout unavailable"}
          </Badge>
        }
      />
      {billing.mode === "unconfigured" && (
        <p className="text-sm text-muted-foreground">
          Online plan changes are not available yet. Book a call below to
          discuss a plan.
        </p>
      )}
      {!canManageBilling && (
        <Alert>
          <AlertTitle>Your workspace owner manages the plan</AlertTitle>
          <AlertDescription>
            Compare the options below, then ask your owner to make a change.
          </AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert role="status">
          <Check />
          <AlertTitle>{message}</AlertTitle>
          <AlertDescription>
            This is a local demo. No real payment was made.
          </AlertDescription>
        </Alert>
      )}
      {billing.scheduledPlan && (
        <Alert>
          <AlertTitle>
            {BILLING_PLANS[billing.scheduledPlan].name} starts{" "}
            {date(snapshot.credits.resetAt)}
          </AlertTitle>
          <AlertDescription>
            <p>Your {current.name} plan stays active until then.</p>
            {enabled && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2 w-fit"
                onClick={() => choose(current.id)}
              >
                Cancel scheduled change
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Free</h2>
            <p className="text-sm text-muted-foreground">
              $0 per month ·{" "}
              {formatCreditsUsd(BILLING_PLANS.free.includedCredits)} once at
              personal signup · 1 workspace seat. Teams do not receive free
              signup credit.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={
              !enabled ||
              billing.scheduledPlan === "free" ||
              current.id === "free"
            }
            onClick={() => choose("free")}
          >
            {actionLabel("free")}
          </Button>
        </CardContent>
      </Card>

      <section className="grid items-stretch gap-4" aria-label="Paid plans">
        {[BILLING_PLANS.pro].map((plan) => (
          <Card
            key={plan.id}
            className={
              current.id === plan.id
                ? "gap-6 border-foreground/30 shadow-none"
                : "gap-6 shadow-none"
            }
          >
            <CardHeader className="gap-2">
              <div className="flex min-h-6 items-center justify-between gap-2">
                <h2 className="text-lg font-semibold tracking-tight">
                  {plan.name}
                </h2>
                {current.id === plan.id ? (
                  <Badge variant="secondary">Current plan</Badge>
                ) : billing.scheduledPlan === plan.id ? (
                  <Badge variant="secondary">Scheduled</Badge>
                ) : null}
              </div>
              <p className="min-h-10 text-sm leading-5 text-muted-foreground">
                {plan.description}
              </p>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-6">
              <div className="flex flex-col gap-3">
                <p className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold tracking-tight tabular-nums">
                    {price(plan.priceCents)}
                  </span>
                  <span className="text-sm text-muted-foreground">/ month</span>
                </p>
                <p className="text-sm">
                  <strong className="font-semibold tabular-nums">
                    {price(creditsToDollars(plan.includedCredits) * 100)}
                  </strong>{" "}
                  <span className="text-muted-foreground">
                    of usage included each month
                  </span>
                </p>
              </div>
              <ul className="flex flex-col gap-3">
                {[
                  plan.seatLimit === null
                    ? "Unlimited workspace seats"
                    : `${plan.seatLimit} workspace seats`,
                  "Agents and API access",
                  "Usage by connection",
                  "Usage charts and sampled activity",
                ].map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <Check className="mt-0.5 size-4 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-auto w-full"
                variant={current.id === plan.id ? "outline" : "default"}
                disabled={
                  !enabled ||
                  billing.scheduledPlan === plan.id ||
                  current.id === plan.id
                }
                onClick={() => choose(plan.id)}
              >
                {actionLabel(plan.id)}
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>

      <section aria-labelledby="token-prices" className="flex flex-col gap-4">
        <h2 id="token-prices" className="text-lg font-semibold">
          Token prices
        </h2>
        <p className="text-sm text-muted-foreground">
          Prices per million tokens. Fast uses Jev at cost. Smart adds Gemini at
          cost plus 20% only when it escalates.
        </p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[540px] text-left text-sm">
            <thead>
              <tr className="bg-muted/20">
                <th className="p-4">Model</th>
                <th className="p-4">Input</th>
                <th className="p-4">Cached input</th>
                <th className="p-4">Output</th>
              </tr>
            </thead>
            <tbody>
              {retailRates.models.map((rate) => (
                <tr key={rate.model} className="border-t border-border">
                  <th scope="row" className="p-4 font-medium">
                    {rate.provider === "typesafe" ? "Jev" : "Gemini escalation"}
                  </th>
                  {[
                    rate.inputUsdPerMillion,
                    rate.cachedInputUsdPerMillion,
                    rate.outputUsdPerMillion,
                  ].map((value, index) => (
                    <td key={index} className="p-4 tabular-nums">
                      {Number(value) === 0 ? "Free" : `$${Number(value)}`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Smart requests without escalation cost the same as Fast. Gemini output
          includes reasoning tokens. Usage stops when your balance is depleted;
          there are no automatic top-ups.
        </p>
      </section>

      <Card className="shadow-none">
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex max-w-xl flex-col gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Enterprise</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Need more capacity or a custom setup? Let’s talk through your
              volume, infrastructure, and support requirements.
            </p>
          </div>
          <Button
            variant="outline"
            className="w-fit shrink-0"
            render={
              <a
                href="https://cal.com/michaelsf/coffee"
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            Book a call
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        </CardContent>
      </Card>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Paid-plan usage refreshes each period; unused allowance does not roll
        over. Free signup credit is granted once and does not replenish.
        {billing.mode === "demo" &&
          " Demo periods last 30 days. No real charges are made."}
      </p>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setSelection(null);
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>
              {keeping
                ? "Cancel scheduled change?"
                : `${downgrading ? "Downgrade" : "Upgrade"} to ${selected?.name}?`}
            </DialogTitle>
            <DialogDescription>
              {keeping
                ? `Your workspace will stay on ${current.name} instead of switching to ${billing.scheduledPlan ? BILLING_PLANS[billing.scheduledPlan].name : "another plan"}.`
                : downgrading
                  ? `Your current plan stays active until ${date(snapshot.credits.resetAt)}.`
                  : "Review the change before activating this plan for your workspace."}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <dl className="flex flex-col gap-3 rounded-lg bg-muted p-4 text-sm">
                <div className="flex justify-between gap-4">
                  <dt>Plan</dt>
                  <dd className="font-medium">{selected.name}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Recurring price</dt>
                  <dd>{formatCents(selected.priceCents)} / month</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Included usage</dt>
                  <dd>
                    {selected.id === "free"
                      ? "No new credit"
                      : `${formatCreditsUsd(selected.includedCredits)} / month`}
                  </dd>
                </div>
                {billing.mode === "demo" && !keeping && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">
                      Simulated charge today
                    </dt>
                    <dd className="font-medium">{formatCents(amountDue)}</dd>
                  </div>
                )}
              </dl>
              <p className="text-sm text-muted-foreground">
                {billing.mode === "autumn"
                  ? "Continue to secure payment management to review and confirm this change. Your balance updates only after payment is confirmed."
                  : keeping
                    ? "Your current allowance and renewal date stay the same."
                    : downgrading
                      ? selected.id === "free"
                        ? "Returning to Free does not grant new signup credit. Your current plan remains available until the renewal date."
                        : `The new allowance starts on ${date(snapshot.credits.resetAt)}. Your current plan remains available until then.`
                      : current.id === "free"
                        ? "Your new included allowance starts now and refreshes after 30 days. It replaces your remaining free allowance."
                        : `This demo charges the full price difference, without proration, and adds ${formatCreditsUsd(selected.includedCredits - current.includedCredits)} to your current allowance. Your renewal date stays the same.`}
              </p>
              <p className="text-xs text-muted-foreground">
                {billing.mode === "demo"
                  ? "No real payment will be made."
                  : "You can review the final amount before confirming."}
              </p>
              {billing.scheduledPlan && !keeping && (
                <p className="text-xs text-muted-foreground">
                  This replaces your scheduled change to{" "}
                  {BILLING_PLANS[billing.scheduledPlan].name}.
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setSelection(null)}
                >
                  Go back
                </Button>
                <Button
                  disabled={busy || !enabled}
                  onClick={() => void confirm()}
                >
                  {busy
                    ? "Saving…"
                    : billing.mode === "autumn"
                      ? "Continue to payment management"
                      : keeping
                        ? "Cancel scheduled change"
                        : downgrading
                          ? `Schedule downgrade to ${selected.name}`
                          : `Upgrade to ${selected.name} in demo`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
