# @superset-ui/plugin-chart-html-content

Power BI "HTML Content"–style visual for Superset. Two modes:

## Full HTML page (default)

Paste any complete HTML document (inline `<script>`, `<style>`, CDN libraries such as Chart.js
or ECharts). It runs in a sandboxed iframe and receives the query results as:

```js
window.supersetData.rows     // [{ region: 'Nairobi', amount: 1200 }, ...]
window.supersetData.columns  // ['region', 'amount']
```

`{{ placeholders }}` (see below) also work anywhere in the page.
The iframe has no `allow-same-origin`, so the page cannot read Superset cookies, the DOM or the API.
Scripts get Superset's CSP nonce so they are allowed to run.

Example with Chart.js:

```html
<canvas id="c"></canvas>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
  const { rows } = window.supersetData;
  new Chart(document.getElementById('c'), {
    type: 'bar',
    data: {
      labels: rows.map(r => r.region),
      datasets: [{ label: 'Amount', data: rows.map(r => r.amount) }],
    },
  });
</script>
```

### Linking to other pages

- **Hidden view in the same chart**: render a second `<div hidden>` and toggle it with a button
  (see `examples/sales-morning-briefing.html` → "Products that dropped").
- **Another dashboard**: `<a href="/superset/dashboard/<slug or id>/" target="_top">Open</a>`.
  Top-level navigation is allowed only on a user click. Put a matching link on the other
  dashboard to come back.

## Row template (sanitized, no scripts)

### Templates

| Field | Rendered |
|---|---|
| Header HTML | once, before rows |
| Row HTML | once per row |
| Footer HTML | once, after rows |
| CSS | scoped to this chart (shadow DOM) |

Leave all three HTML fields empty for an automatic table.

### Placeholder syntax

- `{{ column }}` – value, HTML-escaped. `{{{ column }}}` – inserted as HTML (still sanitized).
- `{{ sum(amount) }}`, `avg`, `min`, `max`, `count()`, `distinct(col)` – over all rows.
- `{{ @number }}` / `{{ @index }}` / `{{ @rowCount }}`.
- Filters, chainable with `|`:
  `number:,.2f` · `percent` · `currency:KES` · `date:%d %b %Y` · `round:1` · `abs` ·
  `upper` · `lower` · `truncate:30` · `default:-` · `pctOfMax` · `pctOfTotal` ·
  `gt:0:green:red` · `lt:N:a:b` · `eq:Paid:a:b`

### Example: KPI tiles with data bars

Header: `<div class="grid">`

Row:
```html
<div class="tile">
  <div class="label">{{ region }}</div>
  <div class="value">{{ total_amount | currency:KES }}</div>
  <div class="delta" style="color: {{ growth | gt:0:#2B8A3E:#C92A2A }}">
    {{ growth | percent:+.1% }}
  </div>
  <div class="bar"><span style="width: {{ total_amount | pctOfMax }}%"></span></div>
</div>
```
Footer: `</div><p class="total">Total: {{ sum(total_amount) | number:,.0f }}</p>`

CSS:
```css
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.tile { border: 1px solid #eee; border-radius: 8px; padding: 12px; }
.label { font-size: 12px; color: #666; text-transform: uppercase; }
.value { font-size: 24px; font-weight: 600; }
.bar { height: 6px; background: #eee; border-radius: 3px; margin-top: 8px; }
.bar span { display: block; height: 100%; background: #20A7C9; border-radius: 3px; }
```

### Security (row template mode)

Output is sanitized: no `<script>`, `<iframe>`, event handlers (`onclick`…) or `javascript:` URLs.
Inline styles, classes, `data-*`/`aria-*` attributes and inline SVG are allowed.
Sanitization follows Superset's `HTML_SANITIZATION` config (on by default).
