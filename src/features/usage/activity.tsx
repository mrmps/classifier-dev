import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { formatCreditsUsd } from "@/lib/billing";
import type { AppSnapshot } from "@/server/contracts";
import { useAnalytics } from "./use-analytics";
import {
  analyticsParameters,
  analyticsTimestamp,
  measurement,
} from "./analytics-data";
type Row = AppSnapshot["usage"][number];
const status = (value: string) =>
  value === "completed" || value === "success"
    ? "Succeeded"
    : value === "refunded"
      ? "Failed · refunded"
      : value === "pending"
        ? "Processing"
        : value === "error"
          ? "Failed"
          : value;
const time = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export function ActivityTable({
  rows,
  filtered = false,
}: {
  rows: Row[];
  filtered?: boolean;
}) {
  const [selected, setSelected] = useState<Row | null>(null);
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border">
        {rows.length ? (
          <Table className="min-w-[650px]">
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="px-4">Time · UTC</TableHead>
                <TableHead>API key</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Details</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/20">
                  <TableCell className="px-4 py-4 text-muted-foreground">
                    {time(row.time)}
                  </TableCell>
                  <TableCell className="max-w-48 truncate">
                    {row.keyName}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.type}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.items.toLocaleString()}
                  </TableCell>
                  <TableCell>{status(row.status)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`View request ${row.id}`}
                      onClick={() => setSelected(row)}
                    >
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="p-8 text-sm text-muted-foreground">
            {filtered
              ? "No requests match these filters. Try another key or date range."
              : "No requests yet. Your classifications will appear here."}
          </p>
        )}
      </div>
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Request details</SheetTitle>
            <SheetDescription>
              Classification metadata for this recorded request.
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="flex flex-col gap-6 p-4">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-5 text-sm">
                {[
                  ["Request ID", selected.id],
                  ["Time (UTC)", time(selected.time)],
                  ["API key", selected.keyName],
                  ["Operation", selected.type],
                  ["Items", selected.items.toLocaleString()],
                  ["Status", status(selected.status)],
                  [
                    selected.status === "pending" ? "Reserved" : "Charged",
                    selected.costAvailable === false
                      ? "Unavailable"
                      : formatCreditsUsd(selected.credits),
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words">{value}</dd>
                  </div>
                ))}
              </dl>
              <CopyButton value={selected.id} label="Copy request ID" />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(value) => value && onChange(value)}
    >
      <SelectTrigger className="w-full sm:w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Activity({ snapshot }: { snapshot: AppSnapshot }) {
  const [key, setKey] = useState("all"),
    [source, setSource] = useState("all"),
    [state, setState] = useState("all"),
    [days, setDays] = useState("7"),
    [page, setPage] = useState(0);
  useEffect(() => setPage(0), [key, source, state, days]);
  const analytics = useAnalytics(snapshot.account.id, true, "activity", {
    ...analyticsParameters(Number(days), "daily"),
    ...(key !== "all" ? { key_id: key } : {}),
    ...(source !== "all" ? { source } : {}),
    ...(state !== "all" ? { status: state } : {}),
  });
  const rows: Row[] = (analytics.data?.data ?? []).map((row) => ({
    id: String(row.requestId),
    time: analyticsTimestamp(row.timestamp),
    agentName: String(row.agentId ?? ""),
    keyId: String(row.keyId),
    keyName:
      snapshot.keys.find((key) => key.id === row.keyId)?.name ??
      String(row.keyId),
    type: `${row.source} · ${row.tier}`,
    status: String(row.status),
    items: measurement(row, "items") ?? 0,
    credits: (measurement(row, "retailCostUsd") ?? 0) * 100_000,
    costAvailable: measurement(row, "retailCostUsd") !== null,
    inputTokens: measurement(row, "inputTokens"),
    outputTokens: measurement(row, "outputTokens"),
  }));
  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 10) - 1));
  function exportCsv() {
    const fields = [
      [
        "Request ID",
        "Time UTC",
        "API key",
        "Operation",
        "Items",
        "Status",
        "Spend USD",
      ],
      ...rows.map((row) => [
        row.id,
        row.time,
        row.keyName,
        row.type,
        row.items,
        row.status,
        row.status === "pending" || row.costAvailable === false
          ? ""
          : row.credits / 100000,
      ]),
    ];
    const csv = fields
      .map((row) =>
        row
          .map(
            (value) =>
              `"${String(value)
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\n");
    const href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = href;
    a.download = "classifier-activity.csv";
    a.click();
    URL.revokeObjectURL(href);
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Activity"
        description="Requests made by your apps and agents."
        action={
          <Button variant="outline" disabled={!rows.length} onClick={exportCsv}>
            Export sample CSV
          </Button>
        }
      />
      <div className="flex flex-wrap gap-3">
        <Filter
          label="Filter activity by API key"
          value={key}
          onChange={setKey}
          options={[
            { value: "all", label: "All API keys" },
            ...snapshot.keys.map((k) => ({ value: k.id, label: k.name })),
          ]}
        />
        <Filter
          label="Filter activity by source"
          value={source}
          onChange={setSource}
          options={[
            { value: "all", label: "All sources" },
            { value: "api", label: "API" },
            { value: "mcp", label: "MCP" },
          ]}
        />
        <Filter
          label="Filter activity by status"
          value={state}
          onChange={setState}
          options={[
            { value: "all", label: "All statuses" },
            ...["success", "error"].map((value) => ({
              value,
              label: status(value),
            })),
          ]}
        />
        <Filter
          label="Activity date range"
          value={days}
          onChange={setDays}
          options={[7, 30, 90].map((value) => ({
            value: String(value),
            label: `Last ${value} days`,
          }))}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Sampled activity · retained for 3 months. This is not a complete request
        log.
      </p>
      {analytics.error ? (
        <div role="alert">
          <p>{analytics.error}</p>
          <Button variant="outline" onClick={analytics.retry}>
            Retry activity
          </Button>
        </div>
      ) : analytics.loading ? (
        <p role="status">Loading activity…</p>
      ) : (
        <ActivityTable
          rows={rows.slice(current * 10, current * 10 + 10)}
          filtered={key !== "all" || source !== "all" || state !== "all"}
        />
      )}
      {!analytics.loading && !analytics.error && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {rows.length} matching {rows.length === 1 ? "request" : "requests"}.
            Activity is limited to the latest 100 sampled records matching these
            filters.
          </p>
          {rows.length > 10 && (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </Button>
              <span className="text-xs">Page {current + 1}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={(current + 1) * 10 >= rows.length}
                onClick={() => setPage(current + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
