import { useEffect, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { Download } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { formatCreditsUsd } from "@/lib/billing";
import type { AppSnapshot } from "@/server/contracts";
import { UsageChart } from "./usage-chart";
import { useAnalytics } from "./use-analytics";
import {
  analyticsParameters,
  analyticsTimestamp,
  analyticsTotals,
  measurement,
} from "./analytics-data";
import {
  tokenTotal,
  usageRange,
  type UsageMetric,
  type UsageGranularity,
} from "./usage-data";

const count = (value: number | null) =>
  value === null ? "Unavailable" : value.toLocaleString("en-US");

export function Usage({ snapshot }: { snapshot: AppSnapshot }) {
  const [days, setDays] = useState(7);
  const [granularity, setGranularity] = useState<UsageGranularity>("hourly");
  const [keyId, setKeyId] = useState("all");
  const [source, setSource] = useState("all");
  const [metric, setMetric] = useState<UsageMetric>("spend");
  const [dimension, setDimension] = useState<"key" | "type">("key");
  const params = {
    ...analyticsParameters(days, granularity),
    ...(keyId !== "all" ? { key_id: keyId } : {}),
    ...(source !== "all" ? { source } : {}),
  };
  const summary = useAnalytics(snapshot.account.id, true, "summary", params);
  const series = useAnalytics(snapshot.account.id, true, "timeseries", params);
  const groups = useAnalytics(snapshot.account.id, true, "breakdown", {
    ...params,
    group_by: dimension === "key" ? "key" : "tier",
  });
  const loading = summary.loading || series.loading || groups.loading;
  const error = summary.error || series.error || groups.error;
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("key");
    if (id && snapshot.keys.some((key) => key.id === id)) setKeyId(id);
  }, []);
  const range = usageRange(days);
  const totals = analyticsTotals(summary.data?.data[0]);
  const costKnown =
    measurement(summary.data?.data[0] ?? {}, "retailCostUsd") !== null;
  const tokens = tokenTotal(totals);
  const chart = (series.data?.data ?? []).map((row) => ({
    day: analyticsTimestamp(row.bucket),
    spend: measurement(row, "retailCostUsd") ?? 0,
    tokens: tokenTotal(analyticsTotals(row)),
    requests: measurement(row, "requests") ?? 0,
  }));
  const breakdown = (groups.data?.data ?? []).map((row) => ({
    id: String(row.dimension),
    name:
      snapshot.keys.find((key) => key.id === row.dimension)?.name ??
      String(row.dimension),
    ...analyticsTotals(row),
  }));
  const keyNames = new Map(
    snapshot.usageAggregates.map((row) => [row.keyId, row.keyName]),
  );
  for (const key of snapshot.keys) keyNames.set(key.id, key.name);
  for (const agent of snapshot.agents) keyNames.set(agent.id, agent.name);
  const keyOptions = [
    { value: "all", label: "All API keys" },
    ...Array.from(keyNames, ([value, label]) => ({ value, label })),
  ];
  const typeOptions = [
    { value: "all", label: "All types" },
    { value: "api", label: "API" },
    { value: "mcp", label: "MCP" },
  ];
  const filtered = keyId !== "all" || source !== "all";
  function exportUsage() {
    const csv = [
      "Time (UTC),Estimated spend (USD),Estimated tokens,Estimated requests",
      ...chart.map((row) =>
        [row.day, row.spend, row.tokens ?? "", row.requests].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `classifier-usage-${granularity}-${range.start}-${range.end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader
        title="Usage"
        description="Spend, tokens, and requests across your workspace."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Select
          items={keyOptions}
          value={keyId}
          onValueChange={(value) => value && setKeyId(value)}
        >
          <SelectTrigger
            aria-label="Filter usage by key or agent"
            className="w-full sm:w-48"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {keyOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={typeOptions}
          value={source}
          onValueChange={(value) => value && setSource(value)}
        >
          <SelectTrigger
            aria-label="Filter usage by type"
            className="w-full sm:w-36"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {typeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setKeyId("all");
              setSource("all");
            }}
          >
            Reset filters
          </Button>
        )}
        <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
          <Select
            items={[
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
            ]}
            value={String(days)}
            onValueChange={(value) => {
              if (value) {
                setDays(Number(value));
                if (Number(value) > 30) setGranularity("daily");
              }
            }}
          >
            <SelectTrigger
              aria-label="Usage date range"
              className="flex-1 sm:w-32"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            items={[
              { value: "hourly", label: "Hourly" },
              { value: "daily", label: "Daily" },
            ]}
            value={granularity}
            onValueChange={(value) => {
              if (value === "hourly" || value === "daily")
                setGranularity(value);
            }}
          >
            <SelectTrigger
              aria-label="Usage interval"
              className="flex-1 sm:w-24"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="hourly" disabled={days > 30}>
                  Hourly
                </SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            aria-label="Export usage CSV"
            onClick={exportUsage}
            disabled={loading || !!error || !costKnown}
          >
            <Download />
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Estimated analytics · retained for 3 months ·{" "}
        {summary.data?.meta.sampled ? "sampled" : "may be sampled"}. Your
        billing balance is exact.
        {summary.data &&
          ` Queried ${new Date(summary.data.meta.queriedAt).toLocaleTimeString("en-US", { timeZone: "UTC" })} UTC.`}
      </p>
      {error ? (
        <div role="alert" className="rounded-xl border border-border p-5">
          <p>{error}</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              summary.retry();
              series.retry();
              groups.retry();
            }}
          >
            Retry analytics
          </Button>
        </div>
      ) : loading ? (
        <p role="status">Loading usage…</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-background">
            <dl className="grid grid-cols-3 gap-4 px-4 pt-5 sm:gap-8 sm:px-5">
              <div className="flex flex-col gap-2">
                <dt className="text-sm text-muted-foreground">Spend</dt>
                <dd className="text-xl font-medium tracking-tight tabular-nums sm:text-3xl">
                  {costKnown ? formatCreditsUsd(totals.credits) : "Unavailable"}
                </dd>
                <p className="text-xs text-muted-foreground">
                  Estimated, not your billing balance
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <dt className="text-sm text-muted-foreground">Tokens</dt>
                <dd className="text-xl font-medium tracking-tight tabular-nums sm:text-3xl">
                  {tokens === null ? "—" : count(tokens)}
                </dd>
                <p className="text-xs text-muted-foreground">
                  {tokens === null
                    ? "Missing for some requests"
                    : "Input + output"}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <dt className="text-sm text-muted-foreground">Requests</dt>
                <dd className="text-xl font-medium tracking-tight tabular-nums sm:text-3xl">
                  {count(totals.requests)}
                </dd>
                <p className="text-xs text-muted-foreground">
                  {count(totals.items)} items submitted
                </p>
              </div>
            </dl>
            <section
              className="flex min-w-0 flex-col gap-5 px-4 pt-6 pb-5 sm:px-5"
              aria-label="Usage over time"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ToggleGroup
                  value={[metric]}
                  onValueChange={(values) => {
                    const value = values[0];
                    if (
                      value === "spend" ||
                      value === "tokens" ||
                      value === "requests"
                    )
                      setMetric(value);
                  }}
                  aria-label="Chart metric"
                >
                  <ToggleGroupItem value="spend">Spend</ToggleGroupItem>
                  <ToggleGroupItem value="tokens">Tokens</ToggleGroupItem>
                  <ToggleGroupItem value="requests">Requests</ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">
                  {granularity === "hourly" ? "Hourly" : "Daily"} totals · UTC
                </p>
              </div>
              {metric === "spend" && !costKnown ? (
                <p className="py-8 text-sm text-muted-foreground">
                  Spend is unavailable for some requests. View request counts
                  instead.
                </p>
              ) : metric === "tokens" && tokens === null ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>Token counts aren’t available</EmptyTitle>
                    <EmptyDescription>
                      One or more matching requests did not report token counts,
                      so a complete total is unavailable. Spend and request
                      totals are still available.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : totals.requests > 0 ? (
                <UsageChart
                  data={chart}
                  metric={metric}
                  granularity={granularity}
                />
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No usage in this range</EmptyTitle>
                    <EmptyDescription>
                      Run a classification or choose another date range, key, or
                      type.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              <p className="text-xs text-muted-foreground">
                {range.start} – {range.end} · UTC · Includes successful and
                failed requests. Today is still in progress. Activity can take
                time to appear.
              </p>
            </section>
          </div>
          <section
            className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background"
            aria-labelledby="usage-breakdown"
          >
            <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
              <h2 id="usage-breakdown" className="font-medium">
                Breakdown · top 50
              </h2>
              <ToggleGroup
                value={[dimension]}
                onValueChange={(values) => {
                  const value = values[0];
                  if (value === "key" || value === "type") setDimension(value);
                }}
                aria-label="Usage breakdown grouping"
              >
                <ToggleGroupItem value="key">By API key</ToggleGroupItem>
                <ToggleGroupItem value="type">By tier</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Table className="min-w-[560px] table-fixed [&_th]:px-4 [&_th]:sm:px-5 [&_td]:px-4 [&_td]:sm:px-5 [&_td]:h-14 [&_td]:py-3">
              <TableHeader>
                <TableRow className="bg-muted/20">
                  <TableHead>
                    {dimension === "key" ? "API key" : "Type"}
                  </TableHead>
                  <TableHead className="w-32 text-right">Spend</TableHead>
                  <TableHead className="w-36 text-right">Tokens</TableHead>
                  <TableHead className="w-28 text-right">Requests</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/20">
                    <TableCell>
                      <span className="block truncate" title={row.name}>
                        {row.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {costKnown
                        ? formatCreditsUsd(row.credits)
                        : "Unavailable"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(tokenTotal(row))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(row.requests)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!breakdown.length && (
              <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
                No activity matches these filters.
              </p>
            )}
          </section>
        </>
      )}
      <Button
        variant="outline"
        className="self-start"
        render={<a href="/app/activity" />}
      >
        View activity
      </Button>
    </div>
  );
}
