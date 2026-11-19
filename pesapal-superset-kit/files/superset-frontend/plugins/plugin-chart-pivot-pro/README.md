# @superset-ui/plugin-chart-pivot-pro

Zoho Analytics–style pivot table for Superset.

## Viewer toolbar (on the dashboard)
- **Search rows**: matches any level; parents of matches stay visible
- **Filters**: tick/untick values of every row and column field, with counts and search
- **Sort**: click a column header (desc → asc → off); click the row header to sort labels
- **Top / Bottom N**: by row total (or by the sorted column's metric)
- **Show values as**: actual · % of grand / row / column / parent total · difference and
  % difference from previous column · running total · rank within parent
- **Expand all / Collapse all**, ▸/▾ per group
- **⇄ Swap** rows and columns
- **Export CSV** of the current view (opens in Excel)
- **Reset** everything back to the chart's defaults

## Build the view once, show it ready-made

While editing the chart, everything you do in the preview is saved into the chart:
click a column header to sort, pick Top / Bottom N or "show values as", collapse or open
groups, untick values in Filters, swap rows/columns, and click cells to colour them.
Click **Save** and the dashboard opens exactly that view. **Reset** (in the editor)
clears the saved view.

Side-panel equivalents: *Sort rows*, *Sort by metric*, *Show rows* (Top/Bottom N),
*Show values as*, *Rows open by default*, *Swap rows and columns*.

**Lock table on dashboards** (on by default): viewers get exactly the saved view, read-only —
no toolbar, header sorting, cell colouring or expand/collapse. Untick it to allow:

Dashboard options: *Show toolbar on dashboards* (off = fixed table) and
*Viewers can colour cells* (their colours are saved only for them).
On a dashboard, viewer changes are temporary; Reset returns to the saved view.

## Chart settings
- Rows and Columns (multi-level), several metrics, time grain for date fields
- Totals use: Sum / Average / Min / Max / Count
- Grand total row/column, column subtotals (row groups always show their subtotal)
- Rows open by default, default "show values as", swap by default, hide toolbar
- Value, currency and date formats

## Conditional formatting
- **Colour scale (heatmap)** per metric, 5 palettes
- **Data bars** per metric (negative values in red), colour picker
- **Icon sets** (arrows, traffic lights, flags) by top / middle / bottom third, "lower is better"
- **Colour rules** (Superset's rule editor: >, <, between, …) on actual values

Scales are calculated per metric over the visible detail cells; totals are not coloured.
