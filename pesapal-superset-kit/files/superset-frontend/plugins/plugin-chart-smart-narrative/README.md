# @superset-ui/plugin-chart-smart-narrative

Auto-generated commentary, like Power BI's Smart Narrative. Pick a metric, an optional
time column + grain, and up to ~3 "Explain by" columns. The chart writes:

- **Headline**: latest period vs N periods back (up/down, %, previous value)
- **Trend & streaks**: overall direction, "3rd increase in a row"
- **Records**: highest/lowest period in range, or distance from the peak
- **Unusual values**: latest period ≥ 2 standard deviations from history
- **Drivers**: which member of each Explain-by column drove the change, and what offset it
- **Composition**: largest member and top-3 share; smallest vs largest; new members

Insights are scored and the top N are shown. Colours follow "Lower is better".
"Copy text" puts the commentary on the clipboard for emails/reports.

The engine (`src/narrative.ts`) is pure and unit-tested.
