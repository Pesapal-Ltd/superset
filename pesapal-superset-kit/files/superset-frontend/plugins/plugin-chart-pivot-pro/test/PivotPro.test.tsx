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
import { fireEvent, render as rtlRender, within } from '@testing-library/react';
import { ChartProps, ThemeProvider, supersetTheme } from '@superset-ui/core';
import PivotPro from '../src/PivotPro';
import transformProps from '../src/plugin/transformProps';
import buildQuery from '../src/plugin/buildQuery';

const render = (ui: ReactElement) =>
  rtlRender(<ThemeProvider theme={supersetTheme}>{ui}</ThemeProvider>);

const data = [
  {
    product_line: 'Classic Cars',
    country: 'USA',
    year: 2003,
    'SUM(sales)': 1000,
  },
  {
    product_line: 'Classic Cars',
    country: 'France',
    year: 2003,
    'SUM(sales)': 400,
  },
  {
    product_line: 'Classic Cars',
    country: 'USA',
    year: 2004,
    'SUM(sales)': 1500,
  },
  { product_line: 'Ships', country: 'USA', year: 2003, 'SUM(sales)': 300 },
  { product_line: 'Ships', country: 'Spain', year: 2004, 'SUM(sales)': 200 },
  { product_line: 'Trains', country: 'France', year: 2004, 'SUM(sales)': 50 },
];

const formData = {
  datasource: '1__table',
  viz_type: 'pivot_pro',
  groupbyRows: ['product_line', 'country'],
  groupbyColumns: ['year'],
  metrics: ['SUM(sales)'],
  valueFormat: ',d',
  heatmap_metrics: ['SUM(sales)'],
  icon_metrics: ['SUM(sales)'],
  lock_on_dashboard: false,
};

const props = () =>
  transformProps(
    new ChartProps({
      formData,
      width: 800,
      height: 500,
      theme: supersetTheme,
      queriesData: [
        {
          data,
          colnames: ['product_line', 'country', 'year', 'SUM(sales)'],
          coltypes: [1, 1, 0, 0],
        },
      ],
    }),
  );

const bodyRows = (c: HTMLElement) =>
  [...c.querySelectorAll('tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td =>
      td.textContent?.replace(/[▲►▼▸▾]/g, '').trim(),
    ),
  );

test('buildQuery groups by rows and columns', () => {
  const q = buildQuery(formData as any).queries[0];
  expect(q.columns).toEqual(['product_line', 'country', 'year']);
});

test('renders tree with subtotals, totals and headers', () => {
  const { container } = render(<PivotPro {...props()} />);
  const heads = [...container.querySelectorAll('thead th')].map(
    th => th.textContent,
  );
  expect(heads).toEqual([
    'product_line / country',
    '2003',
    '2004',
    'Grand total',
  ]);
  const rows = bodyRows(container);
  expect(rows[0]).toEqual(['Classic Cars', '1,400', '1,500', '2,900']);
  expect(rows[1]).toEqual(['France', '400', '–', '400']);
  expect(rows[rows.length - 1]).toEqual([
    'Grand total',
    '1,700',
    '1,750',
    '3,450',
  ]);
});

test('heatmap and icons decorate leaf cells only', () => {
  const { container } = render(<PivotPro {...props()} />);
  const usaRow = [...container.querySelectorAll('tbody tr')][2];
  const cell = usaRow.querySelectorAll('td')[1] as HTMLElement;
  expect(cell).not.toHaveStyle({ background: '' });
  expect(cell.querySelector('.pp-icon')).not.toBeNull();
  const parentCell = container.querySelector(
    'tbody tr td:nth-child(2)',
  ) as HTMLElement;
  expect(parentCell.querySelector('.pp-icon')).toBeNull();
});

test('search, collapse, sort, top N, show-as, swap', () => {
  const { container, getByPlaceholderText, getByText, getByTitle } = render(
    <PivotPro {...props()} />,
  );
  fireEvent.change(getByPlaceholderText('Search rows…'), {
    target: { value: 'spain' },
  });
  expect(bodyRows(container).map(r => r[0])).toEqual([
    'Ships',
    'Spain',
    'Grand total',
  ]);
  fireEvent.change(getByPlaceholderText('Search rows…'), {
    target: { value: '' },
  });

  fireEvent.click(getByText('Collapse all'));
  expect(bodyRows(container).map(r => r[0])).toEqual([
    'Classic Cars',
    'Ships',
    'Trains',
    'Grand total',
  ]);

  // sort by Grand total desc then asc
  fireEvent.click(getByText('Grand total', { selector: 'th' }));
  expect(bodyRows(container).map(r => r[0])).toEqual([
    'Classic Cars',
    'Ships',
    'Trains',
    'Grand total',
  ]);
  fireEvent.click(getByText(/Grand total/, { selector: 'th' }));
  expect(bodyRows(container).map(r => r[0])).toEqual([
    'Trains',
    'Ships',
    'Classic Cars',
    'Grand total',
  ]);

  fireEvent.change(getByTitle('Top / bottom N'), { target: { value: '-5' } });
  fireEvent.change(getByTitle('Top / bottom N'), { target: { value: '0' } });

  fireEvent.change(getByTitle('Show values as'), {
    target: { value: 'pct_grand' },
  });
  expect(bodyRows(container).find(r => r[0] === 'Classic Cars')![3]).toBe(
    '84.1%',
  );

  fireEvent.click(getByText('⇄ Swap'));
  const heads = [...container.querySelectorAll('thead th')].map(
    th => th.textContent,
  );
  expect(heads[0]).toContain('year');
  expect(heads).toContain('Classic Cars');
});

test('value filter panel excludes values', () => {
  const { container, getByText } = render(<PivotPro {...props()} />);
  fireEvent.click(getByText('Filters'));
  const panel = container.querySelector('.pp-panel') as HTMLElement;
  const usa = within(panel)
    .getByText('USA')
    .closest('label')!
    .querySelector('input')!;
  fireEvent.click(usa);
  expect(getByText('Filters').querySelector('.pp-badge')?.textContent).toBe(
    '1',
  );
  const rows = bodyRows(container);
  expect(rows.map(r => r[0])).not.toContain('USA');
  expect(rows[rows.length - 1]).toEqual(['Grand total', '400', '250', '650']);
});

test('CSV export downloads a file', () => {
  const create = jest.fn(() => 'blob:x');
  (URL as any).createObjectURL = create;
  (URL as any).revokeObjectURL = jest.fn();
  const click = jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  const { getByText } = render(<PivotPro {...props()} />);
  fireEvent.click(getByText('Export CSV'));
  expect(create).toHaveBeenCalled();
  expect(click).toHaveBeenCalled();
  click.mockRestore();
});
