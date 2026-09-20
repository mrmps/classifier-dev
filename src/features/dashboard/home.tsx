import { useState } from "react";
import { BILLING_PLANS, formatCreditsUsd } from "@/lib/billing";
import { ArrowRight } from "@/components/ui/icons";
import type { AppSnapshot, AppAction, ActionResult } from "@/server/contracts";
import { Button } from "@/components/ui/button";
import { HomeSetupPrompt } from "./home-setup-prompt";
import { PageHeader } from "@/components/page-header";
import { KeyAccess } from "../keys/key-access";
import { ApiSetup } from "../onboarding/connection-setup";
import { ExampleCards } from "../examples/examples";
import { UsageChart } from "../usage/usage-chart";
import { useAnalytics } from "../usage/use-analytics";
import {
  analyticsParameters,
  analyticsTimestamp,
  measurement,
} from "../usage/analytics-data";

export function Home({
  snapshot,
  navigate,
  act,
}: {
  snapshot: AppSnapshot;
  navigate: (path: string) => void;
  act: (action: AppAction) => Promise<ActionResult>;
}) {
  const [quickstart, setQuickstart] = useState(false);
  const used = snapshot.onboarding.completed;
  const plan = BILLING_PLANS[snapshot.billing.plan];
  const summary = useAnalytics(
    snapshot.account.id,
    true,
    "summary",
    analyticsParameters(7, "hourly"),
  );
  const series = useAnalytics(
    snapshot.account.id,
    used,
    "timeseries",
    analyticsParameters(7, "hourly"),
  );
  const spend = measurement(summary.data?.data[0] ?? {}, "retailCostUsd");
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <HomeSetupPrompt />
      <PageHeader
        title="Home"
        description={
          used
            ? "Your workspace usage and recent activity."
            : "Classify your first batch with the API or your agent."
        }
      />
      <section
        aria-label="Workspace overview"
        className="grid gap-4 sm:grid-cols-3"
      >
        <div className="rounded-xl border border-border p-5">
          <p className="text-sm text-muted-foreground">
            Estimated spend · 7 days
          </p>
          <p className="mt-3 text-2xl font-medium tabular-nums">
            {summary.loading
              ? "Loading…"
              : spend === null
                ? "Unavailable"
                : formatCreditsUsd(spend * 100_000)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Analytics may be sampled; balance is exact
          </p>
        </div>
        <div className="rounded-xl border border-border p-5">
          <p className="text-sm text-muted-foreground">Remaining balance</p>
          <p className="mt-3 text-2xl font-medium tabular-nums">
            {formatCreditsUsd(snapshot.credits.balance)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Shared by all API keys
          </p>
        </div>
        <div className="rounded-xl border border-border p-5">
          <p className="text-sm text-muted-foreground">Current plan</p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-2xl font-medium">{plan.name}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/app/credits")}
            >
              {used ? "Manage billing" : "View plans"}
            </Button>
          </div>
        </div>
      </section>
      {used && (
        <section
          className="rounded-xl border border-border p-5"
          aria-label="Recent spend"
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">Usage</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Last 7 days · hourly · UTC
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/app/usage")}
            >
              View usage <ArrowRight />
            </Button>
          </div>
          {series.error ? (
            <p role="alert">{series.error}</p>
          ) : series.loading ? (
            <p role="status">Loading usage…</p>
          ) : series.data?.data.some(
              (row) => measurement(row, "retailCostUsd") === null,
            ) ? (
            <p>Spend is unavailable for some requests.</p>
          ) : (
            <UsageChart
              data={(series.data?.data ?? []).map((row) => ({
                day: analyticsTimestamp(row.bucket),
                spend: measurement(row, "retailCostUsd") ?? 0,
                requests: measurement(row, "requests") ?? 0,
                tokens: null,
              }))}
              metric="spend"
              granularity="hourly"
            />
          )}
        </section>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-border p-5">
          <h2 className="text-base font-medium">Your API key</h2>
          <KeyAccess snapshot={snapshot} act={act} />
          <Button
            variant="ghost"
            className="self-start"
            aria-expanded={quickstart}
            onClick={() => setQuickstart(!quickstart)}
          >
            {quickstart ? "Hide API example" : "Try an API request"}{" "}
            <ArrowRight />
          </Button>
        </section>
        <section className="flex flex-col gap-4 rounded-xl border border-border p-5">
          <h2 className="text-base font-medium">Connect your agent</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Give your agent a classification tool. Choose a client for setup
            instructions.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              ["Claude Code", "claude-code"],
              ["Codex", "codex"],
              ["Cursor", "cursor"],
            ].map(([label, slug]) => (
              <Button
                key={slug}
                variant="outline"
                onClick={() => navigate(`/app/agents/${slug}`)}
              >
                {label}
              </Button>
            ))}
          </div>
          <Button
            variant="ghost"
            className="mt-auto self-start"
            onClick={() => navigate("/app/agents")}
          >
            All clients <ArrowRight />
          </Button>
        </section>
      </div>
      {quickstart && (
        <div className="rounded-xl border border-border p-5">
          <ApiSetup snapshot={snapshot} act={act} showKey={false} />
        </div>
      )}
      {!used && <ExampleCards navigate={navigate} />}
      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-medium">Recent activity</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/app/activity")}
          >
            View all <ArrowRight />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          View sampled activity from the last 3 months. Request history is
          loaded only when you open Activity.
        </p>
      </section>
    </div>
  );
}
