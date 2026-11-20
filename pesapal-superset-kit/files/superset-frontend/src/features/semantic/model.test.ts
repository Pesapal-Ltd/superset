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
import {
  ApiDataset,
  columnsPayload,
  measuresOf,
  metricsPayload,
  parametersOf,
  starSchemaSql,
} from './model';

const ds: ApiDataset = {
  id: 5,
  table_name: 'cleaned_sales_data',
  database: { id: 1, backend: 'postgresql' },
  columns: [
    { id: 1, column_name: 'sales', type: 'DOUBLE PRECISION', is_dttm: false },
    { id: 2, column_name: 'order_date', type: 'TIMESTAMP', is_dttm: true },
    { id: 3, column_name: 'status', type: 'VARCHAR', is_dttm: false },
    {
      id: 9,
      column_name: 'whatif_price_change_pct',
      expression: '{{ dax_num(filter_values("whatif_price_change_pct"), 0) }}',
      extra:
        '{"whatif":{"name":"Price change %","min":-20,"max":20,"step":1,"default":0,"suffix":"%"}}',
    },
  ],
  metrics: [
    { id: 11, metric_name: 'count', expression: 'COUNT(*)' },
    {
      id: 12,
      metric_name: 'Revenue',
      verbose_name: 'Revenue',
      expression: 'SUM(sales)',
      extra: '{"dax":"SUM(sales[sales])","certification":{"certified_by":"x"}}',
    },
  ],
};

test('reads measures and parameters from a dataset', () => {
  const ms = measuresOf(ds);
  expect(ms.map(m => [m.name, !!m.sqlOnly])).toEqual([
    ['count', true],
    ['Revenue', false],
  ]);
  expect(parametersOf(ds)).toEqual([
    {
      name: 'Price change %',
      column: 'whatif_price_change_pct',
      default: 0,
      min: -20,
      max: 20,
      step: 1,
      suffix: '%',
    },
  ]);
});

test('saving recompiles every DAX measure, keeps SQL metrics and extra', () => {
  const ms = [
    ...measuresOf(ds),
    {
      name: 'Shipped Revenue',
      formula: 'CALCULATE([Revenue], sales[status] = "Shipped")',
      format: '$,.0f',
    },
    { name: 'Projected', formula: '[Revenue] * (1 + [Price change %] / 100)' },
  ];
  const { metrics, errors } = metricsPayload(ds, ms, parametersOf(ds));
  expect(errors).toEqual({});
  expect(metrics.map(m => m.metric_name)).toEqual([
    'count',
    'Revenue',
    'Shipped Revenue',
    'Projected',
  ]);
  expect(metrics[0]).toEqual({
    id: 11,
    metric_name: 'count',
    expression: 'COUNT(*)',
  });
  expect(metrics[1].id).toBe(12);
  expect(JSON.parse(metrics[1].extra!)).toEqual({
    dax: 'SUM(sales[sales])',
    certification: { certified_by: 'x' },
  });
  expect(metrics[2].d3format).toBe('$,.0f');
  expect(metrics[3].expression).toContain(
    'dax_num(filter_values("whatif_price_change_pct"), 0)',
  );
});

test('compile errors are reported per measure and nothing is saved for them', () => {
  const { metrics, errors } = metricsPayload(
    ds,
    [{ name: 'Bad', formula: 'SUM(sales[nope])' }],
    [],
  );
  expect(metrics).toEqual([]);
  expect(errors.Bad).toMatch(/Unknown column/);
});

test('parameters become calculated columns; other columns untouched', () => {
  const cols = columnsPayload(ds, [
    {
      name: 'Price change %',
      column: 'whatif_price_change_pct',
      default: 5,
      min: -20,
      max: 20,
      step: 1,
      suffix: '%',
    },
    {
      name: 'Volume',
      column: 'whatif_volume',
      default: 0,
      min: 0,
      max: 50,
      step: 5,
    },
  ]);
  expect(cols.slice(0, 3).map(c => c.id)).toEqual([1, 2, 3]);
  expect(cols[3]).toMatchObject({
    id: 9,
    column_name: 'whatif_price_change_pct',
    expression: '{{ dax_num(filter_values("whatif_price_change_pct"), 5) }}',
  });
  expect(cols[4]).toMatchObject({
    column_name: 'whatif_volume',
    type: 'NUMERIC',
    filterable: true,
  });
  expect(cols[4].id).toBeUndefined();
  // removing a parameter drops its column
  expect(columnsPayload(ds, []).map(c => c.column_name)).toEqual([
    'sales',
    'order_date',
    'status',
  ]);
});

test('star schema SQL', () => {
  const sql = starSchemaSql(
    {
      name: 'Sales model',
      databaseId: 1,
      schema: 'public',
      fact: 'orders',
      dimensions: [
        {
          table: 'customers',
          alias: 'd1',
          factKey: 'customer_id',
          dimKey: 'id',
          columns: ['city', 'country'],
          prefix: 'customers',
        },
        {
          table: 'products',
          alias: 'd2',
          factKey: 'product_code',
          dimKey: 'code',
          columns: ['product_line'],
          prefix: 'product',
        },
      ],
    },
    'postgresql',
  );
  expect(sql).toBe(
    [
      'SELECT',
      '  f.*,',
      '  d1."city" AS "customers__city",',
      '  d1."country" AS "customers__country",',
      '  d2."product_line" AS "product__product_line"',
      'FROM "public"."orders" AS f',
      'LEFT JOIN "public"."customers" AS d1',
      '  ON f."customer_id" = d1."id"',
      'LEFT JOIN "public"."products" AS d2',
      '  ON f."product_code" = d2."code"',
    ].join('\n'),
  );
  expect(
    starSchemaSql(
      { name: 'm', databaseId: 1, fact: 'o', dimensions: [] },
      'mysql',
    ),
  ).toBe('SELECT\n  f.*\nFROM `o` AS f');
});
