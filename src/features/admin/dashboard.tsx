import { useEffect, useState, type ReactNode } from "react";
import { EvilAreaChart } from "@/components/evilcharts/charts/recharts-area-chart";
import { EvilBarChart } from "@/components/evilcharts/charts/recharts-bar-chart";
import type { ChartConfig } from "@/components/evilcharts/ui/recharts-chart";
import type { AdminData, RangeKey } from "../../admin";
import {
  number as n,
  count,
  compact,
  money,
  latency,
  percent,
  sum,
  change,
  timeline,
} from "./analytics";
import { reasonText } from "./reasons";

type Row = Record<string, unknown>;
type Column = {
  key: string;
  label: string;
  format?: (n: number) => string;
  numeric?: boolean;
};
const blue = "#8caaff",
  green = "#77d8b0",
  amber = "#edc27b",
  red = "#ff929a",
  purple = "#bca0f5";
const config = (key: string, label: string, color: string): ChartConfig => ({
  [key]: { label, colors: { light: [color], dark: [color] } },
});

function Table({ rows, columns }: { rows: Row[]; columns: Column[] }) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const sorted = sort
    ? [...rows].sort(
        (a, b) =>
          (typeof a[sort.key] === "number" ||
          columns.find((c) => c.key === sort.key)?.format
            ? n(a[sort.key]) - n(b[sort.key])
            : String(a[sort.key] ?? "").localeCompare(
                String(b[sort.key] ?? ""),
              )) * (sort.desc ? -1 : 1),
      )
    : rows;
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      aria-label="Scrollable data table"
    >
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ textAlign: c.format || c.numeric ? "right" : "left" }}
                aria-sort={
                  sort?.key === c.key
                    ? sort.desc
                      ? "descending"
                      : "ascending"
                    : "none"
                }
              >
                <button
                  onClick={() =>
                    setSort({
                      key: c.key,
                      desc: sort?.key === c.key ? !sort.desc : true,
                    })
                  }
                >
                  {c.label}
                  {sort?.key === c.key ? (sort.desc ? " ↓" : " ↑") : " ↕"}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    textAlign: c.format || c.numeric ? "right" : "left",
                  }}
                >
                  {r[c.key] == null
                    ? "—"
                    : c.format
                      ? c.format(n(r[c.key]))
                      : c.key === "reason"
                        ? reasonText(String(r[c.key] || "")) || "None"
                        : String(r[c.key] || "Unspecified")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="empty-state">No activity recorded in this period.</p>
      )}
    </div>
  );
}
function Panel({
  title,
  subtitle,
  children,
  wide = false,
  className = "",
  unavailable = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
  unavailable?: boolean;
}) {
  return (
    <section className={`panel ${wide ? "wide" : ""} ${className}`}>
      <h2>{title}</h2>
      {subtitle && <p className="description">{subtitle}</p>}
      {unavailable ? (
        <p className="empty-state">
          Data unavailable. Refresh to retry this panel.
        </p>
      ) : (
        children
      )}
    </section>
  );
}
function Trend({
  title,
  subtitle,
  rows,
  field,
  label,
  color = blue,
  format = count,
  unavailable = false,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  field: string;
  label: string;
  color?: string;
  format?: (n: number) => string;
  unavailable?: boolean;
}) {
  const durationInSeconds =
    format === latency && rows.some((r) => n(r[field]) >= 1000);
  const displayValue =
    format === latency
      ? (v: number) =>
          durationInSeconds ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`
      : format;
  const hasData = rows.some((r) => r[field] != null && n(r[field]) !== 0);
  return (
    <Panel title={title} subtitle={subtitle} unavailable={unavailable}>
      {!hasData && (
        <p className="chart-note">
          {rows.some((r) => r[field] != null)
            ? "No nonzero values in this period."
            : "No samples in this period."}
        </p>
      )}
      <EvilAreaChart
        data={rows}
        config={config(field, label, color)}
        className="admin-chart"
        animationType="none"
        curveType="linear"
      >
        <EvilAreaChart.Grid vertical={false} />
        <EvilAreaChart.XAxis
          dataKey="time"
          minTickGap={36}
          tickFormatter={(v) => String(v).slice(5)}
          tickLine={false}
        />
        <EvilAreaChart.YAxis
          interval={0}
          tickFormatter={format === count ? compact : displayValue}
          width={62}
          tickLine={false}
        />
        <EvilAreaChart.Tooltip
          formatter={(value) => (
            <span>
              {label}: {displayValue(n(value))}
            </span>
          )}
        />
        <EvilAreaChart.Area
          dataKey={field}
          variant="gradient"
          strokeVariant="solid"
          strokeWidth={2}
        />
      </EvilAreaChart>
      <details>
        <summary>View data</summary>
        <Table
          rows={rows}
          columns={[
            { key: "time", label: "Bucket (UTC)" },
            { key: field, label, format: displayValue },
          ]}
        />
      </details>
    </Panel>
  );
}
function Breakdown({
  title,
  subtitle,
  rows,
  name,
  value = "requests",
  format = count,
  color = blue,
  unavailable = false,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  name: string;
  value?: string;
  format?: (n: number) => string;
  color?: string;
  unavailable?: boolean;
}) {
  const chartRows = rows.map((r) => ({
    ...r,
    name: String(r[name] || "Unspecified"),
    [value]: n(r[value]),
  }));
  return (
    <Panel title={title} subtitle={subtitle} unavailable={unavailable}>
      {rows.length ? (
        <>
          <EvilBarChart
            data={chartRows}
            config={config(value, title, color)}
            className="admin-chart"
            animationType="none"
            layout="horizontal"
          >
            <EvilBarChart.Grid horizontal={false} />
            <EvilBarChart.XAxis
              tickFormatter={value === "usd" ? money : compact}
            />
            <EvilBarChart.YAxis
              dataKey="name"
              width={110}
              tickFormatter={(v) =>
                String(v).length > 17 ? String(v).slice(0, 16) + "…" : String(v)
              }
            />
            <EvilBarChart.Tooltip
              formatter={(value) => (
                <span>
                  {title}: {format(n(value))}
                </span>
              )}
            />
            <EvilBarChart.Bar dataKey={value} variant="gradient" />
          </EvilBarChart>
          <details>
            <summary>View all values</summary>
            <Table
              rows={chartRows}
              columns={[
                { key: "name", label: title },
                {
                  key: value,
                  label: value === "usd" ? "Spend" : "Requests",
                  format,
                },
              ]}
            />
          </details>
        </>
      ) : (
        <p className="empty-state">No activity recorded in this period.</p>
      )}
    </Panel>
  );
}
function Metric({
  label,
  value,
  note,
  color,
}: {
  label: string;
  value: string;
  note: string;
  color?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong style={{ color }}>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
const numeric: Column[] = [
  { key: "requests", label: "Requests", format: count },
  { key: "classifications", label: "Decisions", format: count },
  { key: "usd", label: "Spend", format: money },
  { key: "avg_ms", label: "Avg latency", format: latency },
];
const sectionId = (name: string) => name.replaceAll(" ", "-");
const sections = [
  "Overview",
  "Chat",
  "Reliability",
  "Cost & models",
  "Adoption",
  "Dimensions",
] as const;

export function Dashboard({
  data: d,
  range,
}: {
  data: AdminData;
  range: RangeKey;
}) {
  // Old section links still land on the same section after the chart island mounts.
  useEffect(() => {
    const section = sections.find((name) =>
      [name, sectionId(name)].some(
        (id) => encodeURIComponent(id) === location.hash.slice(1),
      ),
    );
    if (section) document.getElementById(sectionId(section))?.scrollIntoView();
  }, []);
  const [selectedModel, setSelectedModel] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const t = d.totals[0] ?? {},
    prev = d.previous[0] ?? {},
    requests = n(t.requests),
    decisions = n(t.classifications),
    spend = n(t.usd);
  const missing = (...keys: string[]) =>
    keys.some((k) => d.unavailable.includes(k));
  const ok = sum(
    d.byStatus.filter((r) => String(r.status) === "200"),
    "requests",
  );
  const failures = sum(
    d.byStatus.filter((r) => String(r.status).startsWith("5")),
    "requests",
  );
  const rejected = sum(
    d.byStatus.filter((r) => String(r.status).startsWith("4")),
    "requests",
  );
  const series = timeline(d, range);
  const chatAccepted = d.chatOutcomes.filter((row) =>
    ["completed", "failed", "stopped"].includes(String(row.outcome)),
  );
  const chatTurns = sum(chatAccepted, "turns");
  const modelCalls = sum(chatAccepted, "modelCalls");
  const costCalls = modelCalls - sum(chatAccepted, "unknownCostCalls");
  const tokenCalls = modelCalls - sum(chatAccepted, "unknownTokenCalls");
  const chatToolRows = [
    ["Classification", "classifyCalls"],
    ["Web search", "webSearches"],
    ["Page reads", "pageReads"],
    ["Clock", "clockCalls"],
  ].map(([tool, key]) => ({ tool, calls: sum(chatAccepted, key) }));
  const comparison = (key: string) =>
    missing("totals", "previous")
      ? "Comparison unavailable"
      : change(n(t[key]), n(prev[key]));
  const bucket =
    range === "24h" ? "Hourly" : range === "7d" ? "6-hour" : "Daily";
  const period =
    range === "24h" ? "24 hours" : range === "7d" ? "7 days" : "30 days";
  const modelRows = d.byModel.map((r) => ({
    ...r,
    share: requests ? n(r.requests) / requests * 100 : null,
    success: n(r.ok) + n(r.failures) ? n(r.ok) / (n(r.ok) + n(r.failures)) * 100 : null,
    coverage: n(r.requests) ? n(r.token_requests) / n(r.requests) * 100 : null,
    unitCost: r.cost_basis !== "Hourly GPU excluded" && n(r.classifications)
      ? (n(r.usd) / n(r.classifications)) * 1000
      : null,
    batch: n(r.ok) ? n(r.classifications) / n(r.ok) : null,
    recordedCost: r.cost_basis === "Hourly GPU excluded" ? null : n(r.usd),
  }));
  const selectedSeries = new Map<string, number>();
  for (const row of d.modelSeries) {
    if (!selectedModel || String(row.model || "Unattributed") === selectedModel) {
      const key = String(row.t).replace("T", " ").slice(0, 16);
      selectedSeries.set(key, (selectedSeries.get(key) ?? 0) + n(row.requests));
    }
  }
  const modelTimeline = series.map(row => ({time: row.time, requests: selectedSeries.get(row.time) ?? 0}));
  const visibleModels = modelRows.filter(row => !selectedModel || row.model === selectedModel);
  const reasons = new Map<string, number>();
  for (const r of d.byReason)
    reasons.set(
      String(r.reason),
      (reasons.get(String(r.reason)) ?? 0) + n(r.requests),
    );
  const reasonRows = [...reasons]
    .map(([reason, requests]) => ({ reason: reasonText(reason), requests }))
    .sort((a, b) => b.requests - a.requests);
  const dimRequests = sum(d.dimensionTraffic, "requests"),
    dimDecisions = sum(d.dimensionTraffic, "classifications"),
    dimSpend = sum(d.dimensionTraffic, "usd");
  const dimFailed = sum(
    d.dimensionTraffic.filter((r) => String(r.status).startsWith("5")),
    "requests",
  );
  const dimOk = sum(
    d.dimensionTraffic.filter((r) => String(r.status) === "200"),
    "requests",
  );
  function download() {
    const blob = new Blob([JSON.stringify({ range, ...d }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `classifier-analytics-${range}-${d.generatedAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setExportStatus("Snapshot exported");
  }
  const trend = (
    title: string,
    field: string,
    label: string,
    key: string,
    color = blue,
    format = count,
    subtitle = `${bucket} buckets · UTC · first and last buckets are partial`,
  ) => (
    <Trend
      title={title}
      subtitle={subtitle}
      rows={series}
      field={field}
      label={label}
      color={color}
      format={format}
      unavailable={missing(key)}
    />
  );
  return (
    <div className="admin-app dark">
      <main>
        <div className="page-heading">
          <div>
            <h1>Service analytics</h1>
            <p>
              classifier.dev · Last {period}{" "}
              <span className="dot-separator">·</span> Updated{" "}
              {new Date(d.generatedAt).toISOString().slice(11, 16)} UTC
            </p>
          </div>
          <div className="actions">
            <div className="range" aria-label="Time range">
              {(["24h", "7d", "30d"] as RangeKey[]).map((r) => (
                <a
                  key={r}
                  aria-current={range === r ? "page" : undefined}
                  href={`/admin?range=${r}`}
                >
                  {r}
                </a>
              ))}
            </div>
            <a className="control" href={`/admin?range=${range}`}>
              ↻ Refresh
            </a>
            <button className="control" onClick={download}>
              Export ↓
            </button>
            <a className="signout" href="/admin?logout=1">
              Sign out ↗
            </a>
          </div>
        </div>
        <span className="sr-only" role="status">
          {exportStatus}
        </span>
        {d.errors.length > 0 && (
          <div className="notice" role="alert">
            <strong>Some analytics are unavailable.</strong> Affected panels are
            marked below. <a href={`/admin?range=${range}`}>Refresh to retry</a>
            <details>
              <summary>Query details</summary>
              {d.unavailable.join(", ")}
            </details>
          </div>
        )}
        <div className="metrics">
          <Metric
            label="API requests"
            value={missing("totals") ? "—" : count(requests)}
            note={comparison("requests")}
          />
          <Metric
            label="Classification decisions"
            value={missing("totals") ? "—" : count(decisions)}
            note={comparison("classifications")}
          />
          <Metric
            label="Server success"
            value={missing("byStatus") ? "—" : percent(ok, ok + failures)}
            note={
              missing("byStatus")
                ? "Status data unavailable"
                : `${count(failures)} failures · excludes 4xx`
            }
            color={green}
          />
          <Metric
            label="API upstream spend"
            value={missing("totals") ? "—" : money(spend)}
            note={comparison("usd")}
          />
          <Metric
            label="Cost / 1k decisions"
            value={
              missing("totals") || !decisions
                ? "—"
                : money((spend / decisions) * 1000)
            }
            note="Recorded upstream cost, not revenue"
          />
          <Metric
            label="Observed caller-days"
            value={missing("visitors") ? "—" : count(d.visitors)}
            note="Identifiers rotate at midnight UTC"
          />
        </div>
        <nav className="section-nav" aria-label="Jump to analytics section">
          {sections.map((name) => (
            <a key={name} href={`#${encodeURIComponent(sectionId(name))}`}>
              {name}
            </a>
          ))}
          <span>All sections on this page · Ctrl / ⌘ F to find</span>
        </nav>
        <section className="analytics-section" id="Overview">
          <h2 className="section-heading">Traffic & service health</h2>
          <div className="panel-grid">
            {trend("Requests over time", "requests", "Requests", "series")}
            {trend(
              "Classification decisions",
              "classifications",
              "Decisions",
              "series",
              green,
            )}
            {trend(
              "Accepted-request latency",
              "latency",
              "Average latency",
              "performance",
              purple,
              latency,
              `${bucket} weighted averages · successful requests and 5xx only`,
            )}
            {trend(
              "API upstream spend",
              "spend",
              "Spend (USD)",
              "series",
              amber,
              money,
            )}
            <Breakdown
              title="HTTP outcomes"
              subtitle="All traffic, including validation and quota rejections"
              rows={d.byStatus}
              name="status"
              color={green}
              unavailable={missing("byStatus")}
            />
            <Panel
              title="At a glance"
              subtitle="A few useful signals behind the totals"
              unavailable={missing("totals", "byStatus", "labelSets")}
            >
              <dl className="signals">
                <div>
                  <dt>Requests rejected (4xx)</dt>
                  <dd>
                    {count(rejected)}{" "}
                    <small>{percent(rejected, requests)} of traffic</small>
                  </dd>
                </div>
                <div>
                  <dt>Decisions / received request</dt>
                  <dd>{requests ? (decisions / requests).toFixed(1) : "—"}</dd>
                </div>
                <div>
                  <dt>Active classifier fingerprints</dt>
                  <dd>{count(d.labelSets)}</dd>
                </div>
                <div>
                  <dt>Average latency, all traffic</dt>
                  <dd>{requests ? latency(n(t.avg_ms)) : "—"}</dd>
                </div>
              </dl>
              <p className="description">
                Use Reliability to investigate rejected or failed requests. Low
                all-traffic latency can reflect fast quota rejections.
              </p>
            </Panel>
          </div>
        </section>
        <section className="analytics-section" id="Chat">
          <h2 className="section-heading">Chat usage</h2>
          <p className="description">
            Completed, failed, and stopped turns. Tracking starts with this
            release; earlier chat activity is unavailable. Conversations are not
            stored.
          </p>
          <div className="metrics">
            <Metric
              label="Chat turns"
              value={missing("chatOutcomes") ? "—" : count(chatTurns)}
              note={
                missing("chatOutcomes")
                  ? "Data unavailable"
                  : `${count(sum(chatAccepted, "starts"))} starts · ${count(chatTurns - sum(chatAccepted, "starts"))} follow-ups`
              }
            />
            <Metric
              label="Completed turns"
              value={
                missing("chatOutcomes")
                  ? "—"
                  : percent(
                      sum(
                        d.chatOutcomes.filter(
                          (row) => row.outcome === "completed",
                        ),
                        "turns",
                      ),
                      chatTurns,
                    )
              }
              note="Excludes rejected requests"
              color={green}
            />
            <Metric
              label="Average turn"
              value={
                missing("chatOutcomes") || !chatTurns
                  ? "—"
                  : latency(sum(chatAccepted, "ms") / chatTurns)
              }
              note="Includes tool execution"
            />
            <Metric
              label="Model spend reported"
              value={
                missing("chatOutcomes") || !costCalls
                  ? "—"
                  : money(sum(chatAccepted, "usd"))
              }
              note={
                missing("chatOutcomes")
                  ? "Data unavailable"
                  : `${count(costCalls)} / ${count(modelCalls)} calls returned cost`
              }
            />
            <Metric
              label="Tool calls"
              value={
                missing("chatOutcomes")
                  ? "—"
                  : count(sum(chatAccepted, "toolCalls"))
              }
              note={
                missing("chatOutcomes")
                  ? "Data unavailable"
                  : `${count(sum(chatAccepted, "toolErrors"))} tool errors`
              }
            />
            <Metric
              label="Chat caller-days"
              value={missing("chatCallers") ? "—" : count(d.chatCallers)}
              note="Daily fingerprints, not unique people"
            />
          </div>
          <div className="panel-grid">
            {trend(
              "Chat turns over time",
              "chatTurns",
              "Turns",
              "chatSeries",
              blue,
            )}
            {trend(
              "Chat response time",
              "chatLatency",
              "Turn duration",
              "chatSeries",
              purple,
              latency,
            )}
            <Panel
              title="Chat outcomes"
              subtitle="Rejected attempts are listed separately from accepted turns"
              unavailable={missing("chatOutcomes")}
            >
              <Table
                rows={d.chatOutcomes}
                columns={[
                  { key: "outcome", label: "Outcome" },
                  { key: "turns", label: "Turns", format: count },
                  { key: "modelCalls", label: "Model calls", format: count },
                ]}
              />
            </Panel>
            <Panel
              title="Chat tools"
              subtitle="Counts of attempted tool calls"
              unavailable={missing("chatOutcomes")}
            >
              <Table
                rows={chatToolRows}
                columns={[
                  { key: "tool", label: "Tool" },
                  { key: "calls", label: "Calls", format: count },
                ]}
              />
            </Panel>
            <Panel
              title="Chat model accounting"
              subtitle="Reported model usage only. Classification spend is in API totals; web-tool charges are excluded."
              className="span-two"
              unavailable={missing("chatOutcomes")}
            >
              <Table
                rows={[
                  {
                    input: tokenCalls ? sum(chatAccepted, "inputTokens") : null,
                    output: tokenCalls
                      ? sum(chatAccepted, "outputTokens")
                      : null,
                    usd: costCalls ? sum(chatAccepted, "usd") : null,
                    tokenCoverage: `${count(tokenCalls)} / ${count(modelCalls)}`,
                    costCoverage: `${count(costCalls)} / ${count(modelCalls)}`,
                  },
                ]}
                columns={[
                  { key: "input", label: "Input tokens", format: count },
                  { key: "output", label: "Output tokens", format: count },
                  { key: "usd", label: "Reported spend", format: money },
                  {
                    key: "tokenCoverage",
                    label: "Calls with tokens",
                    numeric: true,
                  },
                  {
                    key: "costCoverage",
                    label: "Calls with cost",
                    numeric: true,
                  },
                ]}
              />
              <p className="description">
                Missing usage stays unknown. Totals include only calls that
                returned accounting; they are lower bounds when coverage is
                incomplete.
              </p>
            </Panel>
          </div>
        </section>
        <section className="analytics-section" id="Reliability">
          <h2 className="section-heading">Reliability</h2>
          <div className="panel-grid">
            {trend(
              "Server error rate",
              "errorRate",
              "Server errors (%)",
              "outcomes",
              red,
              (v) => `${v.toFixed(2)}%`,
              "5xx ÷ (successful requests + 5xx) · excludes 4xx",
            )}
            {trend(
              "Server failures",
              "failed",
              "5xx requests",
              "outcomes",
              red,
            )}
            {trend(
              "Validation & quota rejections",
              "rejected",
              "4xx requests",
              "outcomes",
              amber,
            )}
            <Breakdown
              title="Failure causes"
              subtitle="Top recorded cause, status, and client combinations, aggregated by cause"
              rows={reasonRows}
              name="reason"
              color={red}
              unavailable={missing("byReason")}
            />
            <Panel
              title="Failure detail"
              subtitle="Top 60 cause / status / client combinations"
              unavailable={missing("byReason")}
            >
              <Table
                rows={d.byReason}
                columns={[
                  { key: "reason", label: "Cause" },
                  { key: "status", label: "HTTP" },
                  { key: "agent", label: "Client" },
                  { key: "requests", label: "Requests", format: count },
                  {
                    key: "avg_inputs",
                    label: "Avg inputs",
                    format: (v) => v.toFixed(1),
                  },
                ]}
              />
            </Panel>
            <Panel
              title="Classifiers with failures"
              subtitle="Top 12 fingerprints and failure causes · label names expire after 90 days"
              unavailable={missing("failLabels")}
            >
              <Table
                rows={d.failLabels}
                columns={[
                  { key: "label_names", label: "Labels" },
                  { key: "labels", label: "Classifier fingerprint" },
                  { key: "reason", label: "Cause" },
                  { key: "requests", label: "Requests", format: count },
                ]}
              />
            </Panel>
          </div>
        </section>
        <section className="analytics-section" id="Cost-&-models">
          <h2 className="section-heading">Cost & models</h2>
          <div className="panel-grid">
              <Panel title="Usage by model" subtitle="Share of recorded requests · combinations represent requests answered by multiple models" wide unavailable={missing("byModel")}>
                <div className="model-filter">
                  <label htmlFor="model-filter">Explore a model</label>
                  <select id="model-filter" value={selectedModel} onChange={event => setSelectedModel(event.target.value)}>
                    <option value="">All models</option>
                    {modelRows.map(row => <option key={row.model} value={row.model}>{row.model}</option>)}
                  </select>
                </div>
                <Table rows={visibleModels} columns={[
                  {key:"model", label:"Model / combination"},
                  {key:"provider", label:"Provider"},
                  {key:"requests", label:"Requests", format:count},
                  {key:"share", label:"Traffic share", format:v => `${v.toFixed(1)}%`},
                  {key:"classifications", label:"Decisions", format:count},
                  {key:"batch", label:"Decisions / success", format:v => v.toFixed(1)},
                  {key:"image_requests", label:"Recorded image requests", format:count},
                ]}/>
                <p className="description">Historical blank models are Unattributed; older SDK traffic remains “typesafe.” Image and provider details start with this release. Before an answer exists, failed requests use the selected route name.</p>
              </Panel>
              <Trend title={selectedModel ? `${selectedModel} requests` : "Model traffic over time"}
                subtitle={`${bucket} request counts · UTC · includes rejections`}
                rows={modelTimeline} field="requests" label="Requests" unavailable={missing("modelSeries")} />
              <Breakdown title="Most used models" subtitle="Request counts for the selected period" rows={d.byModel}
                name="model" unavailable={missing("byModel")} />
              <Panel title="Model reliability" subtitle="Server success and average latency exclude 4xx; rejections are shown separately" wide unavailable={missing("byModel")}>
                <Table rows={visibleModels} columns={[
                  {key:"model", label:"Model / combination"},
                  {key:"success", label:"Server success", format:v => `${v.toFixed(2)}%`},
                  {key:"avg_ms", label:"Avg latency", format:latency},
                  {key:"failures", label:"Server failures", format:count},
                  {key:"rejected", label:"Rejected (4xx)", format:count},
                ]}/>
              </Panel>
              <Panel title="Tokens & cost" subtitle="Reported upstream tokens and API charges; hourly RunPod GPUs and hosting are excluded" wide unavailable={missing("byModel")}>
                <Table rows={visibleModels} columns={[
                  {key:"model", label:"Model / combination"},
                  {key:"input_tokens", label:"Input tokens", format:count},
                  {key:"output_tokens", label:"Output tokens", format:count},
                  {key:"coverage", label:"Token coverage", format:v => `${v.toFixed(1)}%`},
                  {key:"calls", label:"Answered calls", format:count},
                  {key:"recordedCost", label:"API cost", format:money},
                  {key:"unitCost", label:"API cost / 1k decisions", format:money},
                  {key:"cost_basis", label:"Cost basis"},
                ]}/>
                <p className="description">Token coverage is the share of requests with complete input and output counts. Totals include available counts and can be partial; — means unknown. Answered calls exclude attempts without usage. Combined-model cost and tokens belong to the whole request, not each model.</p>
              </Panel>
              {trend("Cost per 1,000 decisions", "cost", "USD / 1k decisions", "series", green, money,
                "Recorded API cost only; hourly GPUs excluded")}
              <Breakdown title="Spend by tier" subtitle="Recorded API cost; hourly GPUs excluded" rows={d.byTier}
                name="tier" value="usd" color={purple} format={money} unavailable={missing("byTier")} />
              <Panel title="Failures by model" subtitle="Top 50 model, status and cause combinations" wide unavailable={missing("modelFailures")}>
                <Table rows={d.modelFailures.filter(row => !selectedModel || String(row.model || "Unattributed") === selectedModel)} columns={[
                  {key:"model", label:"Model / route"}, {key:"status", label:"HTTP status"},
                  {key:"reason", label:"Cause"}, {key:"requests", label:"Requests", format:count},
                ]}/>
              </Panel>
            <Panel
              title="Public & enterprise usage"
              subtitle="Traffic and recorded upstream spend by client class"
              unavailable={missing("byClient")}
            >
              <Table
                rows={d.byClient}
                columns={[
                  { key: "client", label: "Client class" },
                  ...numeric.slice(0, 3),
                ]}
              />
            </Panel>
          </div>
        </section>
        <section className="analytics-section" id="Adoption">
          <h2 className="section-heading">Adoption</h2>
          <div className="panel-grid">
            <Breakdown
              title="Usage by client"
              subtitle="Top 10 detected client families"
              rows={d.byAgent}
              name="agent"
              unavailable={missing("byAgent")}
            />
            <Breakdown
              title="Usage by country"
              subtitle="Top 10 countries by request volume"
              rows={d.byCountry}
              name="country"
              color={green}
              unavailable={missing("byCountry")}
            />
            <Breakdown
              title="Usage by tier"
              subtitle="Requests across classification tiers"
              rows={d.byTier}
              name="tier"
              color={purple}
              unavailable={missing("byTier")}
            />
            {trend(
              "Decisions per accepted request",
              "batch",
              "Decisions / request",
              "performance",
              amber,
              (v) => v.toFixed(1),
              "Successful decisions ÷ (successful requests + 5xx)",
            )}
            <Panel
              title="Busiest classifiers"
              subtitle="Aggregate label names · caller identity and source text are not retained here"
              className="span-two"
              unavailable={missing("topLabels")}
            >
              <a className="control" href="/admin?view=labels">
                Browse all collected labels →
              </a>
              <Table
                rows={d.topLabels}
                columns={[
                  { key: "label_names", label: "Labels" },
                  { key: "labels", label: "Classifier fingerprint" },
                  ...numeric.slice(0, 3),
                ]}
              />
            </Panel>
          </div>
        </section>
        <section className="analytics-section" id="Dimensions">
          <h2 className="section-heading">Multidimensional classification</h2>
          <div className="panel-grid">
            <Panel
              title="Volume & quality"
              subtitle="Quality counts reflect successful decisions; caller-days are not unique people"
              wide
              unavailable={missing("dimensionTraffic")}
            >
              <div className="dimension-metrics">
                <Metric
                  label="Dimension requests"
                  value={count(dimRequests)}
                  note={
                    missing("totals")
                      ? "Traffic share unavailable"
                      : `${percent(dimRequests, requests)} of traffic`
                  }
                />
                <Metric
                  label="Successful items"
                  value={count(sum(d.dimensionTraffic, "items"))}
                  note={`${count(dimDecisions)} decisions`}
                />
                <Metric
                  label="Uncertain fields"
                  value={count(sum(d.dimensionTraffic, "uncertain"))}
                  note={`${percent(sum(d.dimensionTraffic, "uncertain"), dimDecisions)} of decisions`}
                  color={amber}
                />
                <Metric
                  label="Fallback fields"
                  value={count(sum(d.dimensionTraffic, "fallback"))}
                  note={`${percent(sum(d.dimensionTraffic, "fallback"), dimDecisions)} of decisions`}
                />
                <Metric
                  label="Server success"
                  value={percent(dimOk, dimOk + dimFailed)}
                  note={`${count(dimFailed)} server failures`}
                  color={green}
                />
                <Metric
                  label="Upstream spend"
                  value={money(dimSpend)}
                  note={`${dimDecisions ? money((dimSpend / dimDecisions) * 1000) : "—"} / 1k decisions`}
                />
              </div>
            </Panel>
            {trend(
              "Dimension decisions",
              "decisions",
              "Decisions",
              "dimensionSeries",
            )}
            {trend(
              "Dimension requests",
              "dimensionRequests",
              "Requests",
              "dimensionSeries",
              purple,
            )}
            <Panel
              title="Dimension outcomes"
              subtitle={`${missing("dimensionCallers") ? "Caller data unavailable" : `${count(d.dimensionCallers)} observed caller-days`} · uncertainty means confidence < 0.7 or unscored; fallback means Jev unavailable`}
              unavailable={missing("dimensionTraffic")}
            >
              <Table
                rows={d.dimensionTraffic}
                columns={[
                  { key: "status", label: "HTTP" },
                  { key: "reason", label: "Cause" },
                  ...numeric.slice(0, 3),
                  { key: "uncertain", label: "Uncertain", format: count },
                  { key: "fallback", label: "Fallback", format: count },
                ]}
              />
            </Panel>
          </div>
        </section>
        <footer>
          <p>
            Traffic, spend, and latency are sampling-adjusted estimates.
            Distinct counts are observed fingerprints, not exact totals. Caller
            identifiers rotate daily, including within a rolling 24-hour window.
          </p>
          <p>
            All times are UTC. Older events may lack spend or failure reasons.
            This dashboard reports API and chat telemetry; it does not measure
            revenue or registered account growth.
          </p>
        </footer>
      </main>
    </div>
  );
}
