# @superset-ui/plugin-chart-zoho-kpi

A KPI card in the style of Zoho Analytics widgets:

- Large headline number (latest period, total, or average)
- Change vs N periods back with ▲/▼ badge, green/red ("Lower is better" flips colours)
- Optional target with progress bar (green = met, amber = within 10%, red = missed)
- Sparkline trend, accent colour, title/subtitle, number & currency formats

Set a **time column (X-axis)** + time grain to get comparison and sparkline. Without one,
the card shows the aggregated metric (and target, if set).

Registered in `src/visualizations/presets/MainPreset.js` under the key `zoho_kpi`.
