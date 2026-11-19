/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { compileMeasure, DaxError, Model } from '.';
import { parseMeasure } from './parser';

const model: Model = {
  dialect: 'postgresql',
  columns: [
    { name: 'sales' },
    { name: 'quantity_ordered' },
    { name: 'price_each' },
    { name: 'status' },
    { name: 'country' },
    { name: 'product_line' },
    { name: 'order_number' },
    { name: 'order_date', isDate: true },
    { name: 'customers__city' },
    { name: 'margin_pct', expression: 'msrp - price_each' },
    { name: 'whatif_price_change' },
  ],
  measures: {
    Revenue: 'SUM(sales[sales])',
    Orders: 'DISTINCTCOUNT(sales[order_number])',
    'Revenue LY':
      "CALCULATE([Revenue], SAMEPERIODLASTYEAR('Date'[order_date]))",
  },
  parameters: [
    { name: 'Price change %', column: 'whatif_price_change', default: 0 },
  ],
};
const sql = (f: string) => compileMeasure(f, model).sql;

test('parses names with symbols and comments', () => {
  const p = parseMeasure('Margin % := DIVIDE([A], [B]) // note');
  expect(p.name).toBe('Margin %');
  expect(p.expr.kind).toBe('call');
});

test('aggregations and measure references', () => {
  expect(sql('SUM(sales[sales])')).toBe('SUM(sales)');
  expect(sql('COUNTROWS(sales)')).toBe('COUNT(*)');
  expect(sql('DISTINCTCOUNT(sales[order_number])')).toBe(
    'COUNT(DISTINCT order_number)',
  );
  expect(sql('AVERAGE(sales[price_each])')).toBe('AVG(price_each)');
  expect(sql('[Revenue] / [Orders]')).toBe(
    '((SUM(sales)) * 1.0 / NULLIF((COUNT(DISTINCT order_number)), 0))',
  );
});

test('star-schema columns and calculated columns', () => {
  expect(sql('DISTINCTCOUNT(customers[city])')).toBe(
    'COUNT(DISTINCT customers__city)',
  );
  expect(sql('SUMX(sales, sales[quantity_ordered] * sales[margin_pct])')).toBe(
    'SUM((quantity_ordered * (msrp - price_each)))',
  );
});

test('DIVIDE, IF, SWITCH', () => {
  expect(sql('DIVIDE([Revenue], [Orders], 0)')).toBe(
    '(CASE WHEN (COUNT(DISTINCT order_number)) = 0 OR (COUNT(DISTINCT order_number)) IS NULL THEN 0 ELSE (SUM(sales)) * 1.0 / (COUNT(DISTINCT order_number)) END)',
  );
  expect(sql('IF([Revenue] > 1000000, "Big", "Small")')).toBe(
    "(CASE WHEN ((SUM(sales)) > 1000000) THEN 'Big' ELSE 'Small' END)",
  );
  expect(sql('SWITCH(TRUE(), [Revenue] > 10, 1, 0)')).toBe(
    '(CASE WHEN ((SUM(sales)) > 10) THEN 1 ELSE 0 END)',
  );
});

test('CALCULATE filters push into the aggregate and override the grouping on that column', () => {
  const s = sql('CALCULATE([Revenue], sales[status] = "Shipped")');
  expect(s).toContain("SUM(CASE WHEN ((status = 'Shipped')) THEN sales END)");
  expect(s).toContain(
    'dax_over(columns, time_grain, {"dialect":"postgresql","remove":["status"]})',
  );
  // KEEPFILTERS intersects instead: no window
  expect(
    sql('CALCULATE([Revenue], KEEPFILTERS(sales[status] = "Shipped"))'),
  ).toBe("(SUM(CASE WHEN ((status = 'Shipped')) THEN sales END))");
  expect(
    sql('CALCULATE(COUNTROWS(sales), sales[country] IN {"USA", "France"})'),
  ).toContain("COUNT(CASE WHEN ((country IN ('USA', 'France'))) THEN 1 END)");
});

test('% of total with ALL / ALLEXCEPT', () => {
  expect(sql('DIVIDE([Revenue], CALCULATE([Revenue], ALL(sales)))')).toContain(
    'SUM(SUM(sales)) {{ dax_over(columns, time_grain, {"dialect":"postgresql","remove":"all"}) }}',
  );
  expect(sql('CALCULATE([Revenue], ALL(sales[product_line]))')).toContain(
    '"remove":["product_line"]',
  );
  expect(
    sql('CALCULATE([Revenue], ALLEXCEPT(sales, sales[country]))'),
  ).toContain('"keep":["country"]');
});

test('time intelligence', () => {
  const ly = sql('[Revenue LY]');
  expect(ly).toContain(
    '{% if dax_ok(columns, {"dialect":"postgresql","remove":[],"shift":{"unit":"year","n":-1},"date":"order_date"}) %}',
  );
  expect(ly).toContain('{% else %}NULL{% endif %}');
  const ytd = sql("TOTALYTD([Revenue], 'Date'[order_date])");
  expect(ytd).toContain('"time":"ytd"');
  expect(ytd).toContain('{% else %}SUM(sales){% endif %}');
  expect(
    sql("CALCULATE([Revenue], DATEADD('Date'[order_date], -3, MONTH))"),
  ).toContain('"shift":{"unit":"month","n":-3}');
  expect(
    sql("CALCULATE([Revenue], PREVIOUSMONTH('Date'[order_date]))"),
  ).toContain('"shift":{"unit":"month","n":-1}');
  const yoy = compileMeasure(
    'YoY % := DIVIDE([Revenue] - [Revenue LY], [Revenue LY])',
    model,
  );
  expect(yoy.dependsOn.sort()).toEqual(['Revenue', 'Revenue LY']);
  expect(yoy.usesTemplates).toBe(true);
});

test('RANKX', () => {
  expect(sql('RANKX(ALL(sales[product_line]), [Revenue])')).toBe(
    'RANK() OVER ({{ dax_partition(columns, {"dialect":"postgresql","remove":["product_line"]}) }} ORDER BY (SUM(sales)) DESC)',
  );
});

test('what-if parameters', () => {
  expect(sql('[Revenue] * (1 + [Price change %] / 100)')).toContain(
    '{{ dax_num(filter_values("whatif_price_change"), 0) }}',
  );
  expect(sql("[Revenue] * 'Price change %'[Price change % Value]")).toContain(
    'dax_num(filter_values("whatif_price_change"), 0)',
  );
});

test('helpful errors', () => {
  const err = (f: string) => {
    try {
      compileMeasure(f, model);
    } catch (e) {
      return (e as DaxError).message;
    }
    return '';
  };
  expect(err('sales[sales] * 2')).toMatch(/needs an aggregation/);
  expect(err('SUM(sales[nope])')).toMatch(/Unknown column/);
  expect(err('SAMEPERIODLASTYEAR(sales[order_date])')).toMatch(
    /inside CALCULATE/,
  );
  expect(err('FOO(1)')).toMatch(/not supported yet/);
  expect(err('SUM(sales[sales]')).toMatch(/Expected "\)"/);
  expect(
    err('CALCULATE(DISTINCTCOUNT(sales[order_number]), ALL(sales))'),
  ).toMatch(/DISTINCTCOUNT cannot/);
  expect(err('CALCULATE([Revenue], SAMEPERIODLASTYEAR(sales[country]))')).toBe(
    '',
  );
  const loop = compileMeasure.bind(null, '[A]', {
    ...model,
    measures: { A: '[B]', B: '[A]' },
  });
  expect(loop).toThrow(/refers to itself/);
});
