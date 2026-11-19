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
import DecompositionTree from '../src/DecompositionTree';
import transformProps from '../src/plugin/transformProps';
import buildQuery from '../src/plugin/buildQuery';

const render = (ui: ReactElement) =>
  rtlRender(<ThemeProvider theme={supersetTheme}>{ui}</ThemeProvider>);

const data = [
  { country: 'USA', product_line: 'Classic Cars', 'SUM(sales)': 500 },
  { country: 'USA', product_line: 'Ships', 'SUM(sales)': 100 },
  { country: 'France', product_line: 'Classic Cars', 'SUM(sales)': 200 },
  { country: 'France', product_line: 'Planes', 'SUM(sales)': 50 },
];

const make = (
  extra: Record<string, unknown> = {},
  setControlValue?: jest.Mock,
) =>
  transformProps(
    new ChartProps({
      formData: {
        viz_type: 'decomposition_tree',
        metric: 'SUM(sales)',
        groupby: ['country', 'product_line'],
        y_axis_format: ',d',
        metric_name: 'Revenue',
        ...extra,
      },
      width: 900,
      height: 400,
      theme: supersetTheme,
      hooks: setControlValue ? { setControlValue } : {},
      queriesData: [{ data }],
    }),
  );

const columnTitles = (c: HTMLElement) =>
  [...c.querySelectorAll('svg > g > text:first-child')].map(t => t.textContent);
const item = (c: HTMLElement, label: string) =>
  c.querySelector(`g[data-label="${label}"]`) as Element;

afterEach(() => window.history.pushState({}, '', '/'));

test('query groups by every explain-by field', () => {
  expect(
    buildQuery({
      datasource: '1__table',
      viz_type: 'x',
      metric: 'm',
      groupby: ['a', 'b'],
    } as any).queries[0].columns,
  ).toEqual(['a', 'b']);
});

test('starts at the total; + adds a level; clicking a bar drills in', () => {
  const { container, getByLabelText, getByRole } = render(
    <DecompositionTree {...make()} />,
  );
  expect(columnTitles(container)).toEqual(['Revenue']);
  expect(container).toHaveTextContent(/850/);

  fireEvent.click(getByLabelText('Break down further'));
  fireEvent.click(getByRole('menuitem', { name: 'country' }));
  expect(columnTitles(container)).toEqual(['Revenue', 'country']);
  expect(container).toHaveTextContent(/Click a bar to break it down further/);

  fireEvent.click(item(container, 'France'));
  fireEvent.click(getByLabelText('Break down further'));
  fireEvent.click(getByRole('menuitem', { name: 'product_line' }));
  expect(columnTitles(container)).toEqual([
    'Revenue',
    'country',
    'product_line',
  ]);
  expect(item(container, 'Planes')).not.toBeNull();
  expect(item(container, 'Ships')).toBeNull(); // only France's products
  // no fields left → no more +
  expect(
    container.querySelector('[aria-label="Break down further"]'),
  ).toBeNull();
  // connectors drawn: 2 (root→countries) + 2 (France→products)
  expect(container.querySelectorAll('svg > path')).toHaveLength(4);
});

test('✨ High value picks the field with the biggest contributor', () => {
  const { container, getByLabelText, getByRole } = render(
    <DecompositionTree {...make()} />,
  );
  fireEvent.click(getByLabelText('Break down further'));
  fireEvent.click(getByRole('menuitem', { name: /High value/ }));
  // Classic Cars (700) beats USA (600)
  expect(columnTitles(container)).toEqual(['Revenue', 'product_line']);
  expect(container).toHaveTextContent(/✨ High value/);
});

test('✕ removes a level', () => {
  const { container } = render(
    <DecompositionTree
      {...make({
        decomp_levels: [
          { dim: 'country', mode: 'manual', selected: 'USA' },
          { dim: 'product_line', mode: 'manual', selected: null },
        ],
      })}
    />,
  );
  expect(columnTitles(container)).toEqual([
    'Revenue',
    'country',
    'product_line',
  ]);
  const removeBtns = [...container.querySelectorAll('text.dt-act')];
  fireEvent.click(removeBtns[0]);
  expect(columnTitles(container)).toEqual(['Revenue']);
});

test('read-only for viewers when exploring is switched off', () => {
  const { container, queryByLabelText } = render(
    <DecompositionTree
      {...make({
        allow_explore: false,
        decomp_levels: [{ dim: 'country', mode: 'manual', selected: 'USA' }],
      })}
    />,
  );
  expect(queryByLabelText('Break down further')).not.toBeInTheDocument();
  fireEvent.click(item(container, 'France'));
  expect(
    item(container, 'USA').querySelector('rect')!.getAttribute('fill'),
  ).not.toBe('transparent');
  expect(container.querySelector('text.dt-act')).toBeNull();
});

test('in the chart editor the tree path is saved into the chart', () => {
  window.history.pushState({}, '', '/explore/');
  const set = jest.fn();
  const { getByLabelText, getByRole } = render(
    <DecompositionTree {...make({ allow_explore: false }, set)} />,
  );
  fireEvent.click(getByLabelText('Break down further'));
  fireEvent.click(getByRole('menuitem', { name: 'country' }));
  expect(set).toHaveBeenCalledWith('decomp_levels', [
    { dim: 'country', mode: 'manual', selected: null },
  ]);
});
