# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""
Jinja helpers used by DAX measures compiled on the Semantic Model page.

DAX evaluates measures in a "filter context" (the row / column of the visual).
In SQL the nearest equivalent is a window function over the grouped query, so
measures such as % of total (ALL) or same period last year are compiled to
``AGG(...) OVER (...)``. Which columns go in the PARTITION BY depends on how
the chart groups the data, which is only known when the query runs. These
helpers receive the query's ``columns`` (available in Superset's Jinja
context) and build the window clause.

They are exposed through ``JINJA_CONTEXT_ADDONS``; see ``JINJA_ADDONS``.
Requires the ``ENABLE_TEMPLATE_PROCESSING`` feature flag.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, NamedTuple, Optional

# Superset time grains -> DATE_TRUNC units
GRAIN_UNITS = {
    "PT1S": "second",
    "PT1M": "minute",
    "PT1H": "hour",
    "P1D": "day",
    "P1W": "week",
    "P1M": "month",
    "P3M": "quarter",
    "P0.25Y": "quarter",
    "P1Y": "year",
}

# how many periods of a grain make one unit (for LAG on engines without
# RANGE offsets); approximate for days
PERIODS = {
    ("year", "year"): 1,
    ("quarter", "year"): 4,
    ("month", "year"): 12,
    ("week", "year"): 52,
    ("day", "year"): 365,
    ("quarter", "quarter"): 1,
    ("month", "quarter"): 3,
    ("week", "quarter"): 13,
    ("day", "quarter"): 91,
    ("month", "month"): 1,
    ("week", "month"): 4,
    ("day", "month"): 30,
    ("week", "week"): 1,
    ("day", "week"): 7,
    ("day", "day"): 1,
}

TO_DATE_UNIT = {"ytd": "year", "qtd": "quarter", "mtd": "month"}
UNITS = {"year", "quarter", "month", "week", "day"}
RANGE_DIALECTS = {"postgresql", "postgres", "redshift", "duckdb", "snowflake"}


class GroupColumn(NamedTuple):
    label: str
    raw: str
    sql: str
    grain_unit: Optional[str]


def _quote(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def _trunc(unit: str, expr: str, dialect: str) -> str:
    if dialect == "bigquery":
        return f"TIMESTAMP_TRUNC({expr}, {unit.upper()})"
    return f"DATE_TRUNC('{unit}', {expr})"


def group_columns(
    columns: Optional[Iterable[Any]], dialect: str = "postgresql"
) -> list[GroupColumn]:
    """The query's GROUP BY columns as SQL expressions."""
    out: list[GroupColumn] = []
    for col in columns or []:
        if isinstance(col, str):
            out.append(GroupColumn(col, col, _quote(col), None))
        elif isinstance(col, dict):
            raw = col.get("sqlExpression") or col.get("label") or ""
            label = col.get("label") or raw
            unit = GRAIN_UNITS.get(col.get("timeGrain") or "")
            sql = _trunc(unit, raw, dialect) if unit else raw
            out.append(GroupColumn(label, raw, sql, unit))
    return out


def _spec(spec: Optional[dict[str, Any]]) -> dict[str, Any]:
    spec = dict(spec or {})
    remove = spec.get("remove") or []
    spec["remove"] = "all" if remove == "all" else [str(r) for r in remove]
    spec["dialect"] = str(spec.get("dialect") or "postgresql").lower()
    return spec


def _date_column(
    cols: list[GroupColumn], date: Optional[str]
) -> Optional[GroupColumn]:
    if not date:
        return None
    for col in cols:
        if date in (col.label, col.raw):
            return col
    return None


def _partition(
    cols: list[GroupColumn], s: dict[str, Any], exclude: Optional[GroupColumn] = None
) -> list[str]:
    remove = s["remove"]
    keep = s.get("keep")
    out = []
    for col in cols:
        if col is exclude:
            continue
        if keep is not None:
            if col.label in keep or col.raw in keep:
                out.append(col.sql)
            continue
        if remove == "all" or col.label in remove or col.raw in remove:
            continue
        out.append(col.sql)
    return out


def dax_partition(
    columns: Optional[Iterable[Any]], spec: Optional[dict[str, Any]]
) -> str:
    """Just the PARTITION BY part (used by RANKX, which adds its own ORDER BY)."""
    s = _spec(spec)
    part = _partition(group_columns(columns, s["dialect"]), s)
    return "PARTITION BY " + ", ".join(part) if part else ""


def dax_ok(columns: Optional[Iterable[Any]], spec: Optional[dict[str, Any]]) -> bool:
    """
    False when a time-intelligence measure is used in a query that is not
    split by its date column (the measure then falls back, see compiler).
    """
    s = _spec(spec)
    if not (s.get("time") or s.get("shift")):
        return True
    return _date_column(group_columns(columns, s["dialect"]), s.get("date")) is not None


def dax_over(
    columns: Optional[Iterable[Any]],
    time_grain: Optional[str],
    spec: Optional[dict[str, Any]],
) -> str:
    """
    Window clause for a measure.

    spec:
      remove  "all" or list of column names to ignore (DAX ALL / REMOVEFILTERS)
      time    "ytd" | "qtd" | "mtd" | "running"  (TOTALYTD, DATESYTD, ...)
      shift   {"unit": "year", "n": -1}           (SAMEPERIODLASTYEAR, DATEADD)
      date    name of the date column
      dialect database backend (postgresql default)
    """
    s = _spec(spec)
    dialect = s["dialect"]
    cols = group_columns(columns, dialect)
    remove = s["remove"]
    timed = bool(s.get("time") or s.get("shift"))
    date_col = _date_column(cols, s.get("date")) if timed else None
    if timed and date_col is None:
        return ""

    partition = _partition(cols, s, exclude=date_col)
    order = ""
    frame = ""
    if timed and date_col is not None:
        order = f"ORDER BY {date_col.sql}"
        kind = s.get("time")
        if kind in TO_DATE_UNIT:
            partition.append(_trunc(TO_DATE_UNIT[kind], date_col.sql, dialect))
        if kind:
            frame = "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW"
        else:
            shift = s["shift"] or {}
            unit = str(shift.get("unit", "year")).lower()
            if unit not in UNITS:
                unit = "year"
            n = int(shift.get("n", -1))
            if n == 0:
                return ""
            if dialect in RANGE_DIALECTS and date_col.grain_unit:
                k = abs(n)
                side = "PRECEDING" if n < 0 else "FOLLOWING"
                interval = f"INTERVAL '{k} {unit}'"
                frame = f"RANGE BETWEEN {interval} {side} AND {interval} {side}"
            else:
                grain = date_col.grain_unit or "day"
                k = abs(n) * PERIODS.get((grain, unit), 1)
                side = "PRECEDING" if n < 0 else "FOLLOWING"
                frame = f"ROWS BETWEEN {k} {side} AND {k} {side}"
    parts = []
    if partition:
        parts.append("PARTITION BY " + ", ".join(partition))
    if order:
        parts.append(order)
    if frame:
        parts.append(frame)
    return "OVER (" + " ".join(parts) + ")"


def dax_num(values: Any, default: Any = 0) -> str:
    """
    A what-if parameter value as a safe SQL number literal. Values come from
    the dashboard (filter_values), so anything that is not a finite number
    falls back to the default.
    """
    candidates = values if isinstance(values, (list, tuple)) else [values]
    for value in list(candidates) + [default]:
        try:
            num = float(value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(num):
            return repr(int(num)) if num.is_integer() else repr(num)
    return "0"


JINJA_ADDONS = {
    "dax_over": dax_over,
    "dax_ok": dax_ok,
    "dax_num": dax_num,
    "dax_partition": dax_partition,
}
