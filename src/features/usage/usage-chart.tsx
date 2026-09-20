import { useId } from "react";
import {
  Area,
  Bar,
  ComposedChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { dailyUsage, UsageMetric, UsageGranularity } from "./usage-data";

/* Focused adaptation of EvilCharts' Recharts area chart: per-instance SVG
 * color gradient + masked fade, linear interpolation and flat axes.
 * https://evilcharts.com/docs/recharts/area-chart/static
 * https://github.com/legions-developer/evilcharts (MIT, Copyright (c) 2026 Gurbinder; see EVILCHARTS-LICENSE)
 * The full compound component's selection, brush and animation are not needed here.
 */
export function UsageChart({
  data,
  metric,
  granularity,
}: {
  data: ReturnType<typeof dailyUsage>;
  metric: UsageMetric;
  granularity: UsageGranularity;
}) {
  const id = `usage-${useId().replaceAll(":", "")}`;
  const label =
    metric === "spend" ? "Spend" : metric === "tokens" ? "Tokens" : "Requests";
  const format = (value: number) =>
    metric === "spend"
      ? value.toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 5,
        })
      : value.toLocaleString("en-US");
  const maximum = Math.max(0, ...data.map((point) => point[metric] ?? 0));
  // Tick steps cannot be smaller than one billable unit, or tiny dollar
  // amounts round to the same label on adjacent grid lines.
  const scale = metric === "spend" ? 100_000 : 1;
  const step = Math.max(1, Math.ceil((maximum * scale) / 4));
  const ticks = Array.from(
    { length: Math.max(1, Math.ceil((maximum * scale) / step)) + 1 },
    (_, index) => (index * step) / scale,
  );
  return (
    <div
      className="h-64 w-full min-w-0 text-muted-foreground sm:h-72"
      aria-label={`${label} by ${granularity === "hourly" ? "hour" : "day"}, in UTC`}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart
          data={data}
          accessibilityLayer
          margin={{ top: 16, right: 12, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={`${id}-color`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--foreground)" />
              <stop offset="100%" stopColor="var(--foreground)" />
            </linearGradient>
            <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="white" stopOpacity={0.12} />
              <stop offset="100%" stopColor="white" stopOpacity={0} />
            </linearGradient>
            <mask id={`${id}-mask`}>
              <rect width="100%" height="100%" fill={`url(#${id}-fade)`} />
            </mask>
            <pattern
              id={`${id}-fill`}
              patternUnits="userSpaceOnUse"
              width="100%"
              height="100%"
            >
              <rect
                width="100%"
                height="100%"
                fill={`url(#${id}-color)`}
                mask={`url(#${id}-mask)`}
              />
            </pattern>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="var(--border)"
            strokeOpacity={0.5}
            strokeDasharray="3 5"
          />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            minTickGap={40}
            tickMargin={12}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(day) =>
              new Date(
                granularity === "hourly" ? day : `${day}T00:00:00Z`,
              ).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                ...(granularity === "hourly"
                  ? { hour: "numeric" as const }
                  : {}),
                timeZone: "UTC",
              })
            }
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            width={metric === "spend" ? 86 : 60}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={format}
            allowDecimals={metric === "spend"}
            domain={[0, ticks[ticks.length - 1]]}
            ticks={ticks}
          />
          <Tooltip
            cursor={{
              stroke: "var(--muted-foreground)",
              strokeDasharray: "3 3",
              strokeWidth: 0.8,
            }}
            content={({ active, payload, label: day }) =>
              active && payload?.length ? (
                <div className="rounded-lg bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10">
                  <p className="text-muted-foreground">
                    {new Date(
                      granularity === "hourly"
                        ? String(day)
                        : `${day}T00:00:00Z`,
                    ).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                      ...(granularity === "hourly"
                        ? { hour: "numeric", minute: "2-digit" }
                        : {}),
                    })}{" "}
                    · UTC
                  </p>
                  <p className="mt-1 font-medium tabular-nums">
                    {label}: {format(Number(payload[0].value))}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {payload[0].payload.requests.toLocaleString("en-US")}{" "}
                    requests ·{" "}
                    {payload[0].payload.tokens === null
                      ? "Tokens unavailable"
                      : `${payload[0].payload.tokens.toLocaleString("en-US")} tokens`}
                  </p>
                </div>
              ) : null
            }
          />
          {granularity === "hourly" ? (
            <Bar
              dataKey={metric}
              fill="var(--foreground)"
              fillOpacity={0.85}
              maxBarSize={12}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          ) : (
            <Area
              type="linear"
              dataKey={metric}
              stroke={`url(#${id}-color)`}
              fill={`url(#${id}-fill)`}
              strokeWidth={1.5}
              dot={false}
              activeDot={{
                r: 4,
                fill: "var(--foreground)",
                stroke: "var(--background)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
              connectNulls={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
