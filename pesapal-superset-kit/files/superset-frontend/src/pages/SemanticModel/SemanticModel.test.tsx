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
import fetchMock from 'fetch-mock';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from 'spec/helpers/testing-library';
import SemanticModel from '.';

// fetch-mock 7 (Superset 4.x/5.x) and fetch-mock 12 (Superset 6+) have different
// APIs; these helpers let the same tests run on both.
type Opts = Record<string, unknown> | undefined;
const fm = fetchMock as any;
const isV12 = () => typeof fm.callHistory === 'object';

function resetFetchMock() {
  if (isV12()) fm.clearHistory().removeRoutes();
  else fm.reset();
}

function fetchCalled(matcher: string, options?: Opts): boolean {
  return isV12()
    ? fm.callHistory.called(matcher, options)
    : fm.called(matcher, options);
}

/** Request body of the last call that matched. */
function lastBody(matcher: string, options?: Opts): string {
  if (isV12()) {
    return fm.callHistory.lastCall(matcher, options)?.options?.body as string;
  }
  return fm.lastCall(matcher, options)?.[1]?.body as string;
}

const dataset = {
  id: 5,
  table_name: 'cleaned_sales_data',
  schema: 'public',
  database: { id: 1, backend: 'postgresql', database_name: 'examples' },
  extra: null,
  sql: null,
  columns: [
    {
      id: 1,
      column_name: 'sales',
      is_dttm: false,
      type: 'DOUBLE PRECISION',
      changed_on: 'x',
    },
    { id: 2, column_name: 'order_date', is_dttm: true, type: 'TIMESTAMP' },
    { id: 3, column_name: 'status', is_dttm: false, type: 'VARCHAR' },
  ],
  metrics: [
    { id: 11, metric_name: 'count', expression: 'COUNT(*)', created_on: 'x' },
    {
      id: 12,
      metric_name: 'Revenue',
      verbose_name: 'Revenue',
      expression: 'SUM(sales)',
      extra: '{"dax":"SUM(Sales[sales])"}',
    },
  ],
};

const LIST = 'glob:*/api/v1/dataset/?q=*';
const GET = 'glob:*/api/v1/dataset/5';
const PUT = 'glob:*/api/v1/dataset/5';
const DATA = 'glob:*/api/v1/chart/data';

beforeEach(() => {
  resetFetchMock();
  window.history.replaceState(null, '', '/semantic/?dataset=5');
  fetchMock.get(LIST, {
    result: [{ id: 5, table_name: 'cleaned_sales_data', schema: 'public' }],
  });
  fetchMock.get(GET, { result: dataset });
});

test('lists measures and compiles DAX as you type', async () => {
  render(<SemanticModel />, { useRedux: true, useRouter: true });
  expect(
    await screen.findByRole('button', { name: /Revenue DAX/ }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /count SQL/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /New measure/ }));
  fireEvent.change(screen.getByLabelText('Measure name'), {
    target: { value: 'Shipped Revenue' },
  });
  fireEvent.change(screen.getByLabelText('DAX formula'), {
    target: { value: 'CALCULATE([Revenue], Sales[stat] = "Shipped")' },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('Unknown column');
  fireEvent.change(screen.getByLabelText('DAX formula'), {
    target: { value: 'CALCULATE([Revenue], Sales[status] = "Shipped")' },
  });
  expect(screen.getByText(/Compiles to SQL/)).toBeInTheDocument();
  expect(screen.getByText(/uses \[Revenue\]/)).toBeInTheDocument();
});

test('saving sends every metric with compiled SQL and the DAX source', async () => {
  fetchMock.put(PUT, { result: {} });
  render(<SemanticModel />, { useRedux: true, useRouter: true });
  await screen.findByRole('button', { name: /Revenue DAX/ });
  fireEvent.click(screen.getByRole('button', { name: /New measure/ }));
  fireEvent.change(screen.getByLabelText('Measure name'), {
    target: { value: 'Revenue LY' },
  });
  fireEvent.change(screen.getByLabelText('DAX formula'), {
    target: {
      value: "CALCULATE([Revenue], SAMEPERIODLASTYEAR('Date'[order_date]))",
    },
  });
  fireEvent.change(screen.getByLabelText('Format'), {
    target: { value: '$,.0f' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save measure' }));
  await waitFor(() => expect(fetchCalled(PUT, { method: 'PUT' })).toBe(true));
  const body = JSON.parse(lastBody(PUT, { method: 'PUT' }));
  expect(body.metrics.map((m: any) => m.metric_name)).toEqual([
    'count',
    'Revenue',
    'Revenue LY',
  ]);
  expect(body.metrics[0]).toEqual({
    id: 11,
    metric_name: 'count',
    expression: 'COUNT(*)',
  });
  expect(body.metrics[2].expression).toContain('dax_over');
  expect(body.metrics[2].d3format).toBe('$,.0f');
  expect(JSON.parse(body.metrics[2].extra).dax).toContain('SAMEPERIODLASTYEAR');
  expect(await screen.findByText(/Saved\./)).toBeInTheDocument();
});

test('run calls the chart data API split by month', async () => {
  fetchMock.post(DATA, {
    result: [
      {
        data: [
          { order_date: 2, Revenue: 20 },
          { order_date: 1, Revenue: 10 },
        ],
      },
    ],
  });
  render(<SemanticModel />, { useRedux: true, useRouter: true });
  await screen.findByRole('button', { name: /Revenue DAX/ });
  fireEvent.click(screen.getByRole('button', { name: /Revenue DAX/ }));
  fireEvent.change(screen.getByLabelText('Test split'), {
    target: { value: 'order_date|P1M' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Run test/ }));
  const table = await screen.findByRole('table', { name: 'Test result' });
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  const req = JSON.parse(lastBody(DATA));
  expect(req.queries[0].columns[0]).toMatchObject({
    columnType: 'BASE_AXIS',
    sqlExpression: 'order_date',
    timeGrain: 'P1M',
  });
  expect(req.queries[0].metrics[0].sqlExpression).toBe('SUM(sales)');
});

test('what-if parameter becomes a calculated column', async () => {
  fetchMock.put(PUT, { result: {} });
  render(<SemanticModel />, { useRedux: true, useRouter: true });
  await screen.findByRole('button', { name: /Revenue DAX/ });
  fireEvent.click(screen.getByRole('tab', { name: /What-if parameters/ }));
  fireEvent.change(screen.getByLabelText('Parameter name'), {
    target: { value: 'Price change %' },
  });
  expect(screen.getAllByText('whatif_price_change_pct').length).toBeGreaterThan(
    0,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save parameter' }));
  await waitFor(() => expect(fetchCalled(PUT, { method: 'PUT' })).toBe(true));
  const body = JSON.parse(lastBody(PUT, { method: 'PUT' }));
  expect(body.columns.map((c: any) => c.column_name)).toEqual([
    'sales',
    'order_date',
    'status',
    'whatif_price_change_pct',
  ]);
  expect(body.columns[0]).not.toHaveProperty('changed_on');
  expect(body.columns[3].expression).toBe(
    '{{ dax_num(filter_values("whatif_price_change_pct"), 0) }}',
  );
});

test('build a star-schema model: SQL preview, key check and create', async () => {
  fetchMock.get('glob:*/api/v1/database/?q=*', {
    result: [{ id: 1, database_name: 'examples', backend: 'postgresql' }],
  });
  fetchMock.get('glob:*/api/v1/database/1/schemas/', { result: ['public'] });
  fetchMock.get('glob:*/api/v1/database/1/tables/?q=*', {
    result: [{ value: 'orders' }, { value: 'customers' }],
  });
  fetchMock.get('glob:*/api/v1/database/1/table_metadata/?name=orders*', {
    columns: [
      { name: 'order_id' },
      { name: 'customer_id' },
      { name: 'amount' },
    ],
  });
  fetchMock.get('glob:*/api/v1/database/1/table_metadata/?name=customers*', {
    columns: [{ name: 'id' }, { name: 'city' }, { name: 'country' }],
  });
  fetchMock.post('glob:*/api/v1/sqllab/execute/', {
    data: [{ row_count: 120, key_count: 120 }],
  });
  fetchMock.post('glob:*/api/v1/dataset/', { id: 77 });
  fetchMock.put('glob:*/api/v1/dataset/77', { result: {} });
  fetchMock.put('glob:*/api/v1/dataset/77/refresh', { message: 'OK' });
  fetchMock.get('glob:*/api/v1/dataset/77', {
    result: { ...dataset, id: 77, table_name: 'sales_model' },
  });

  render(<SemanticModel />, { useRedux: true, useRouter: true });
  await screen.findByRole('button', { name: /Revenue DAX/ });
  fireEvent.click(screen.getByRole('tab', { name: 'Relationships' }));
  fireEvent.click(
    screen.getByRole('button', { name: /New star-schema model/ }),
  );
  fireEvent.change(screen.getByLabelText('Model name'), {
    target: { value: 'sales_model' },
  });
  await screen.findByRole('option', { name: 'examples' });
  fireEvent.change(screen.getByLabelText('Schema'), {
    target: { value: 'public' },
  });
  await screen.findByRole('option', { name: 'orders' });
  fireEvent.change(screen.getByLabelText('Fact table'), {
    target: { value: 'orders' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Add dimension/ }));
  fireEvent.change(screen.getByLabelText('Dimension 1 table'), {
    target: { value: 'customers' },
  });
  await screen.findByRole('option', { name: 'customer_id' });
  fireEvent.change(screen.getByLabelText('Dimension 1 fact key'), {
    target: { value: 'customer_id' },
  });
  await screen.findAllByRole('option', { name: 'id' });
  fireEvent.change(screen.getByLabelText('Dimension 1 key'), {
    target: { value: 'id' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'city' }));
  expect(
    screen.getByText(/d1\."city" AS "customers__city"/),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Check join keys' }));
  expect(
    await screen.findByText(/customers\.id is unique \(120 rows\)/),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Create model' }));
  await waitFor(() =>
    expect(fetchCalled('glob:*/api/v1/dataset/77/refresh')).toBe(true),
  );
  const created = JSON.parse(
    lastBody('glob:*/api/v1/dataset/', { method: 'POST' }),
  );
  expect(created).toMatchObject({
    database: 1,
    schema: 'public',
    table_name: 'sales_model',
  });
  expect(created.sql).toContain(
    'LEFT JOIN "public"."customers" AS d1\n  ON f."customer_id" = d1."id"',
  );
  const extra = JSON.parse(
    JSON.parse(lastBody('glob:*/api/v1/dataset/77', { method: 'PUT' })).extra,
  );
  expect(extra.semantic_model.dimensions[0]).toMatchObject({
    table: 'customers',
    columns: ['city'],
  });
});
