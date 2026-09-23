import { createRoot } from "react-dom/client";
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
import "./styles.css";

type Row = Record<string, unknown>;
type Column = { key: string; label: string; format?: (n: number) => string };
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
                <td key={c.key}>
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
  unavailable = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
  unavailable?: boolean;
}) {
  return (
    <section className={`panel ${wide ? "wide" : ""}`}>
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
          tickFormatter={format === count ? compact : format}
          width={62}
          tickLine={false}
        />
        <EvilAreaChart.Tooltip
          formatter={(value) => (
            <span>
              {label}: {format(n(value))}
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
            { key: field, label, format },
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
const tabs = [
  "Overview",
  "Reliability",
  "Cost & models",
  "Adoption",
  "Dimensions",
] as const;
type Tab = (typeof tabs)[number];

function Dashboard({ data: d, range }: { data: AdminData; range: RangeKey }) {
  const initial = location.hash.slice(1);
  const [tab, setTab] = useState<Tab>(
    tabs.find((t) => encodeURIComponent(t) === initial) ?? "Overview",
  );
  useEffect(() => {
    const sync = () =>
      setTab(
        tabs.find((t) => encodeURIComponent(t) === location.hash.slice(1)) ??
          "Overview",
      );
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const [volume, setVolume] = useState("requests");
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
    unitCost: n(r.classifications)
      ? (n(r.usd) / n(r.classifications)) * 1000
      : null,
    batch: n(r.requests) ? n(r.classifications) / n(r.requests) : null,
  }));
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
    URL.revokeObjectURL(url);
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
      <header className="topbar">
        <a href="/" className="brand">
          classifier<span>.dev</span>
        </a>
        <span className="admin-label">Admin analytics</span>
        <a href="/admin?logout=1" className="signout">
          Sign out ↗
        </a>
      </header>
      <main>
        <div className="page-heading">
          <div>
            <h1>API analytics</h1>
            <p>
              Last {period} <span className="dot-separator">·</span> Updated{" "}
              {new Date(d.generatedAt).toISOString().slice(11, 16)} UTC
            </p>
          </div>
          <div className="actions">
            <div className="range" aria-label="Time range">
              {(["24h", "7d", "30d"] as RangeKey[]).map((r) => (
                <a
                  key={r}
                  aria-current={range === r ? "page" : undefined}
                  href={`/admin?range=${r}#${encodeURIComponent(tab)}`}
                >
                  {r}
                </a>
              ))}
            </div>
            <a
              className="control"
              href={`/admin?range=${range}#${encodeURIComponent(tab)}`}
            >
              ↻ Refresh
            </a>
            <button className="control" onClick={download}>
              Export data ↓
            </button>
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
            label="Requests"
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
            label="Upstream spend"
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
        <nav className="section-nav" aria-label="Analytics sections">
          {tabs.map((t) => (
            <button
              key={t}
              aria-current={tab === t ? "page" : undefined}
              onClick={() => {
                setTab(t);
                history.replaceState(null, "", `#${encodeURIComponent(t)}`);
              }}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="section-intro">
          <h2>
            {tab === "Overview"
              ? "Traffic & service health"
              : tab === "Reliability"
                ? "Find the friction"
                : tab === "Cost & models"
                  ? "Understand your unit economics"
                  : tab === "Adoption"
                    ? "Where usage comes from"
                    : "Multidimensional classification"}
          </h2>
          <p>
            {tab === "Overview"
              ? "Demand, throughput, and the health of the requests you serve."
              : tab === "Reliability"
                ? "Separate upstream failures from validation and quota rejections."
                : tab === "Cost & models"
                  ? "Compare provider spend, model latency, and cost per decision."
                  : tab === "Adoption"
                    ? "Observed usage across clients, tiers, countries, and classifier fingerprints."
                    : "Each item × dimension is one decision. Monitor volume and quality together."}
          </p>
        </div>
        <div className="panel-grid">
          {tab === "Overview" && (
            <>
              <div className="wide">
                <div className="chart-switch" aria-label="Traffic measure">
                  <button
                    aria-pressed={volume === "requests"}
                    onClick={() => setVolume("requests")}
                  >
                    Requests
                  </button>
                  <button
                    aria-pressed={volume === "classifications"}
                    onClick={() => setVolume("classifications")}
                  >
                    Decisions
                  </button>
                </div>
                {trend(
                  "Traffic over time",
                  volume,
                  volume === "requests" ? "Requests" : "Decisions",
                  "series",
                )}
              </div>
              {trend(
                "Accepted-request latency",
                "latency",
                "Average latency (ms)",
                "performance",
                purple,
                latency,
                `${bucket} weighted averages · successful requests and 5xx only`,
              )}
              {trend(
                "Upstream spend",
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
                    <dd>
                      {requests ? (decisions / requests).toFixed(1) : "—"}
                    </dd>
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
                  Use Reliability to investigate rejected or failed requests.
                  Low all-traffic latency can reflect fast quota rejections.
                </p>
              </Panel>
            </>
          )}
          {tab === "Reliability" && (
            <>
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
                "Accepted-request latency",
                "latency",
                "Average latency (ms)",
                "performance",
                purple,
                latency,
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
                wide
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
            </>
          )}
          {tab === "Cost & models" && (
            <>
              {trend(
                "Upstream spend",
                "spend",
                "Spend (USD)",
                "series",
                amber,
                money,
              )}
              {trend(
                "Cost per 1,000 decisions",
                "cost",
                "USD / 1k decisions",
                "series",
                green,
                money,
              )}
              <Breakdown
                title="Spend by model"
                subtitle="Top 10 models by request volume · recorded provider cost"
                rows={d.byModel}
                name="model"
                value="usd"
                color={amber}
                format={money}
                unavailable={missing("byModel")}
              />
              <Breakdown
                title="Spend by tier"
                subtitle="Compare the cost of fast and smart classification"
                rows={d.byTier}
                name="tier"
                value="usd"
                color={purple}
                format={money}
                unavailable={missing("byTier")}
              />
              <Panel
                title="Model economics"
                subtitle="Top 10 models by requests · click a column to sort"
                wide
                unavailable={missing("byModel")}
              >
                <Table
                  rows={modelRows}
                  columns={[
                    { key: "model", label: "Model" },
                    ...numeric,
                    { key: "unitCost", label: "Cost / 1k", format: money },
                    {
                      key: "batch",
                      label: "Decisions / req",
                      format: (v) => v.toFixed(1),
                    },
                  ]}
                />
              </Panel>
              <Panel
                title="Public & enterprise usage"
                subtitle="Traffic and recorded upstream spend by client class"
                wide
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
            </>
          )}
          {tab === "Adoption" && (
            <>
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
                wide
                unavailable={missing("topLabels")}
              >
                <a className="control" href="/admin?view=labels">Browse all collected labels →</a>
                <Table
                  rows={d.topLabels}
                  columns={[
                    { key: "label_names", label: "Labels" },
                    { key: "labels", label: "Classifier fingerprint" },
                    ...numeric.slice(0, 3),
                  ]}
                />
              </Panel>
            </>
          )}
          {tab === "Dimensions" && (
            <>
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
                wide
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
            </>
          )}
        </div>
        <footer>
          <p>
            Traffic, spend, and latency are sampling-adjusted estimates.
            Distinct counts are observed fingerprints, not exact totals. Caller
            identifiers rotate daily, including within a rolling 24-hour window.
          </p>
          <p>
            All times are UTC. Older events may lack spend or failure reasons.
            This dashboard reports API telemetry; it does not measure revenue or
            registered account growth.
          </p>
        </footer>
      </main>
    </div>
  );
}
const bootstrap =
  document.querySelector<HTMLScriptElement>("script[data-admin]");
const root = document.querySelector(".page");
if (bootstrap?.dataset.admin && root) {
  const props = JSON.parse(bootstrap.dataset.admin) as {
    range: RangeKey;
    data: AdminData;
  };
  createRoot(root).render(<Dashboard {...props} />);
}
