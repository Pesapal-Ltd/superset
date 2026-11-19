# Semantic model: DAX measures, star schemas, what-if

Menu **Semantic Model** (`/semantic/`). Everything is stored on Superset datasets, so
charts, dashboards, permissions and exports keep working as usual.

| Feature | Stored as |
|---|---|
| DAX measure | dataset metric (compiled SQL); DAX source in `metric.extra.dax` |
| Star schema (relationships) | virtual dataset (`SELECT f.*, dim cols FROM fact LEFT JOIN dims`); definition in `dataset.extra.semantic_model` |
| What-if parameter | calculated column `whatif_*`; settings in `column.extra.whatif` |

## Setup (any environment)

In `superset_config.py` (see `docker/pythonpath_dev/superset_config.py`):

```python
FEATURE_FLAGS = {..., "ENABLE_TEMPLATE_PROCESSING": True}
JINJA_CONTEXT_ADDONS = {name: <lazy import of superset.semantic.dax.name>
                        for name in ("dax_over", "dax_ok", "dax_num", "dax_partition")}
```

Restart the web and worker processes after changing the config.

## DAX supported

- Aggregations: `SUM AVERAGE MIN MAX COUNT COUNTA COUNTBLANK COUNTROWS DISTINCTCOUNT`
- Iterators: `SUMX AVERAGEX MINX MAXX COUNTX` (row expressions; `FILTER(...)` as the table)
- `CALCULATE` with boolean filters, `IN { }`, `KEEPFILTERS`, `FILTER`, `ALL`, `REMOVEFILTERS`,
  `ALLSELECTED`, `ALLEXCEPT`
- Time intelligence (needs the chart split by the date column, e.g. x-axis + time grain):
  `TOTALYTD/QTD/MTD`, `DATESYTD/QTD/MTD`, `SAMEPERIODLASTYEAR`, `DATEADD`, `PARALLELPERIOD`,
  `PREVIOUS/NEXT YEAR|QUARTER|MONTH|DAY`
- `RANKX` (incl. `ASC`, `DENSE`), `DIVIDE`, `IF`, `SWITCH` / `SWITCH(TRUE(), ...)`, `AND OR NOT`,
  `ISBLANK`, `COALESCE`, `SELECTEDVALUE`, `HASONEVALUE`, `ABS ROUND ROUNDUP ROUNDDOWN INT POWER
  SQRT MOD EXP LN`, `& CONCATENATE`, `BLANK() TRUE() FALSE()`
- References: `[Measure]`, `Table[column]`, `'Table name'[column]`; star-schema columns as
  `customers[city]` → `customers__city`; parameters as `[Price change %]`

Verified on PostgreSQL 16 against independently computed results (785 checks), including
gaps in time series, CALCULATE overriding a grouped column, RANKX and YTD of averages.

## How it maps to SQL (and differences from Power BI)

- Filters push into the aggregate: `SUM(CASE WHEN cond THEN x END)`.
- `ALL`, time intelligence and CALCULATE filters on a column become window functions over the
  chart's grouped rows; `superset.semantic.dax` fills in `PARTITION BY` from the query's columns.
- The chart's WHERE filters (dashboard filters) always apply first, so `ALL(...)` behaves like
  `ALLSELECTED` and CALCULATE cannot bring back rows a dashboard filter removed.
- Time intelligence works per time bucket of the chart; without the date column on the chart,
  "last year" measures return blank and YTD/QTD/MTD return the total for the selected range.
- On PostgreSQL / Redshift / Snowflake / DuckDB date shifts use exact `RANGE ... INTERVAL`
  frames; other databases use row offsets (missing periods can shift results).
- `DISTINCTCOUNT` cannot be combined with `ALL` or time intelligence.
- Not supported yet: table functions returning tables to visuals (`SUMMARIZE`, `ADDCOLUMNS`,
  `VALUES` as a table), variables (`VAR`/`RETURN`), `USERELATIONSHIP` (ignored).

## What-if

1. Semantic Model → What-if parameters → e.g. *Price change %*, -20…20, step 1.
2. Use it in measures: `[Revenue] * (1 + [Price change %] / 100)`.
3. Dashboard → Filters → add **What-if parameter**, pick the dataset and the `whatif_…` column.
   Viewers get a slider; charts using those measures recalculate.
4. **What-if Scenario** chart: drivers (sliders) + formula, baseline vs scenario per group; a
   driver can follow a dashboard parameter.

Slider values are converted to numbers by `dax_num`, so they cannot inject SQL.
