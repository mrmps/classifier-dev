EvilCharts Recharts components from https://evilcharts.com/r/ (2026-09-20).
Upstream: https://github.com/legions-developer/evilcharts (MIT; see LICENSE).

Installed registry items: recharts-area-chart, recharts-bar-chart, and their
chart, tooltip, legend, dot, brush, and background dependencies.

Local adaptations: import aliases point to components/evilcharts; area and bar
Tooltip parts forward the existing ChartTooltipContent formatter so admin
values retain their currency, latency, and percentage units.
