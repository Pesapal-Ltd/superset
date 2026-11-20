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
import '@testing-library/jest-dom';
import { ReactElement } from 'react';
import { fireEvent, render as rtlRender } from '@testing-library/react';
import { ChartProps, ThemeProvider, supersetTheme } from '@superset-ui/core';
import WhatIfScenario from '../src/WhatIfScenario';
import transformProps from '../src/plugin/transformProps';
import buildQuery from '../src/plugin/buildQuery';
import { runScenario, valuesFromDashboard } from '../src/scenario';
import { parseFormula } from '../src/formula';

const render = (ui: ReactElement) =>
  rtlRender(<ThemeProvider theme={supersetTheme}>{ui}</ThemeProvider>);

const data = [
  { product_line: 'Classic Cars', 'SUM(sales)': 1000, 'SUM(cost)': 600 },
  { product_line: 'Ships', 'SUM(sales)': 500, 'SUM(cost)': 400 },
];
const formula =
  '[SUM(sales)] * (1 + [Price %] / 100) * (1 + [Volume %] / 100) - [SUM(cost)] * (1 + [Volume %] / 100)';
const drivers = [
  {
    name: 'Price %',
    min: -20,
    max: 20,
    step: 1,
    default: 0,
    param: 'whatif_price_change_pct',
    suffix: '%',
  },
  { name: 'Volume %', min: -50, max: 50, step: 5, default: 0, suffix: '%' },
];

test('baseline uses planned values, scenario the slider values', () => {
  const r = runScenario(
    data,
    'product_line',
    ['SUM(sales)', 'SUM(cost)'],
    parseFormula(formula),
    drivers,
    { 'Price %': 10 },
  );
  // baseline profit: (1000-600) + (500-400) = 500; +10% price adds 150
  expect(r.baseline).toBe(500);
  expect(r.scenario).toBeCloseTo(650);
  expect(r.pct).toBeCloseTo(0.3);
  expect(r.rows[1]).toEqual({
    label: 'Ships',
    baseline: 100,
    scenario: expect.closeTo(150, 6),
  });
});

test('drivers can follow dashboard what-if parameters (clamped)', () => {
  expect(
    valuesFromDashboard(drivers, [
      { col: 'whatif_price_change_pct', op: '==', val: 15 },
    ]),
  ).toEqual({ 'Price %': 15 });
  expect(
    valuesFromDashboard(drivers, [
      { col: 'whatif_price_change_pct', op: '==', val: 99 },
    ]),
  ).toEqual({ 'Price %': 20 });
  expect(valuesFromDashboard(drivers, [{ col: 'other', val: 1 }])).toEqual({});
});

const make = (extra: Record<string, unknown> = {}) =>
  transformProps(
    new ChartProps({
      formData: {
        viz_type: 'what_if',
        metrics: ['SUM(sales)', 'SUM(cost)'],
        groupby: ['product_line'],
        scenario_formula: formula,
        driver_1_name: 'Price %',
        driver_1_min: '-20',
        driver_1_max: '20',
        driver_1_step: '1',
        driver_1_default: '0',
        driver_1_param: 'whatif_price_change_pct',
        driver_2_name: 'Volume %',
        driver_2_min: '-50',
        driver_2_max: '50',
        driver_2_step: '5',
        driver_2_default: '0',
        y_axis_format: ',d',
        ...extra,
      },
      width: 700,
      height: 400,
      theme: supersetTheme,
      queriesData: [{ data }],
    }),
  );

test('query groups by the breakdown and sorts by the first metric', () => {
  const q = buildQuery({
    datasource: '1__table',
    viz_type: 'what_if',
    metrics: ['m'],
    groupby: ['g'],
  } as any).queries[0];
  expect(q.columns).toEqual(['g']);
  expect(q.orderby).toEqual([['m', false]]);
});

test('moving a slider updates the scenario', () => {
  const { getByLabelText, container } = render(<WhatIfScenario {...make()} />);
  expect(container).toHaveTextContent(/Baseline500/);
  fireEvent.change(getByLabelText('Volume %'), { target: { value: '10' } });
  // +10% volume: profit 500 -> 550
  expect(container).toHaveTextContent(/Scenario550/);
  expect(container).toHaveTextContent(/\+50/);
  expect(container).toHaveTextContent(/\+10\.0%/);
  expect(container.querySelectorAll('svg g')).toHaveLength(2);
});

test('slider starts at the dashboard parameter value', () => {
  const { getByLabelText, container } = render(
    <WhatIfScenario
      {...make({
        extra_form_data: {
          filters: [{ col: 'whatif_price_change_pct', op: '==', val: 10 }],
        },
      })}
    />,
  );
  expect((getByLabelText('Price %') as HTMLInputElement).value).toBe('10');
  expect(container).toHaveTextContent(/from dashboard/);
  expect(container).toHaveTextContent(/Scenario650/);
});

test('unknown names in the formula are explained', () => {
  const { container } = render(
    <WhatIfScenario {...make({ scenario_formula: '[Revenue] * 2' })} />,
  );
  expect(container).toHaveTextContent(/Unknown name: \[Revenue\]/);
  expect(container).toHaveTextContent(
    /You can use: \[SUM\(sales\)\], \[SUM\(cost\)\], \[Price %\], \[Volume %\]/,
  );
});
