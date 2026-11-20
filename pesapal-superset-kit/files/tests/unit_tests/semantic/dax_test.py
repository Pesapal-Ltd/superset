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
from superset.semantic.dax import (
    dax_num,
    dax_ok,
    dax_over,
    dax_partition,
    group_columns,
)

X_MONTH = {
    "columnType": "BASE_AXIS",
    "sqlExpression": "order_date",
    "label": "order_date",
    "expressionType": "SQL",
    "timeGrain": "P1M",
}


def test_group_columns() -> None:
    cols = group_columns(["country", X_MONTH])
    assert [c.sql for c in cols] == ['"country"', "DATE_TRUNC('month', order_date)"]


def test_percent_of_total() -> None:
    assert dax_over(["country", "deal_size"], None, {"remove": "all"}) == "OVER ()"
    assert (
        dax_over(["country", "deal_size"], None, {"remove": ["deal_size"]})
        == 'OVER (PARTITION BY "country")'
    )


def test_ytd() -> None:
    assert dax_over(["country", X_MONTH], "P1M", {"time": "ytd", "date": "order_date"}) == (
        "OVER (PARTITION BY \"country\", DATE_TRUNC('year', DATE_TRUNC('month', order_date)) "
        "ORDER BY DATE_TRUNC('month', order_date) "
        "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)"
    )


def test_same_period_last_year() -> None:
    spec = {"shift": {"unit": "year", "n": -1}, "date": "order_date"}
    assert dax_over([X_MONTH], "P1M", spec) == (
        "OVER (ORDER BY DATE_TRUNC('month', order_date) "
        "RANGE BETWEEN INTERVAL '1 year' PRECEDING AND INTERVAL '1 year' PRECEDING)"
    )
    # engines without RANGE offsets use rows: 12 months back
    assert "ROWS BETWEEN 12 PRECEDING AND 12 PRECEDING" in dax_over(
        [X_MONTH], "P1M", {**spec, "dialect": "mysql"}
    )


def test_time_measure_without_date_column() -> None:
    spec = {"time": "ytd", "date": "order_date"}
    assert dax_ok(["country"], spec) is False
    assert dax_over(["country"], None, spec) == ""
    assert dax_ok([X_MONTH], spec) is True
    assert dax_ok(["country"], {"remove": "all"}) is True


def test_dax_num_is_injection_safe() -> None:
    assert dax_num([10]) == "10"
    assert dax_num(["2.5"]) == "2.5"
    assert dax_num(["1); DROP TABLE x; --"], 0) == "0"
    assert dax_num([], -5) == "-5"
    assert dax_num(["nan"], 3) == "3"
    assert dax_num(None, 1) == "1"


def test_allexcept_and_rank_partition() -> None:
    cols = ["country", "deal_size", X_MONTH]
    assert dax_over(cols, None, {"keep": ["country"]}) == 'OVER (PARTITION BY "country")'
    assert dax_partition(cols, {"remove": ["deal_size"]}) == (
        "PARTITION BY \"country\", DATE_TRUNC('month', order_date)"
    )
    assert dax_partition(["deal_size"], {"remove": ["deal_size"]}) == ""
