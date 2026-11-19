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

const render = (ui: ReactElement) =>
  rtlRender(<ThemeProvider theme={supersetTheme}>{ui}</ThemeProvider>);

const data = [
  { line: 'Cars', country: 'USA', year: 2003, s: 1000 },
  { line: 'Cars', country: 'France', year: 2004, s: 1500 },
  { line: 'Ships', country: 'USA', year: 2003, s: 300 },
  { line: 'Ships', country: 'Spain', year: 2004, s: 200 },
  { line: 'Trains', country: 'USA', year: 2004, s: 50 },
  { line: 'Planes', country: 'USA', year: 2003, s: 900 },
];

const make = (
  extra: Record<string, unknown> = {},
  setControlValue?: jest.Mock,
) =>
  transformProps(
    new ChartProps({
      formData: {
        viz_type: 'pivot_pro',
        slice_id: 7,
        groupbyRows: ['line', 'country'],
        groupbyColumns: ['year'],
        metrics: ['s'],
        valueFormat: ',d',
        lock_on_dashboard: false,
        ...extra,
      },
      width: 800,
      height: 500,
      theme: supersetTheme,
      hooks: setControlValue ? { setControlValue } : {},
      queriesData: [
        {
          data,
          colnames: ['line', 'country', 'year', 's'],
          coltypes: [1, 1, 0, 0],
        },
      ],
    }),
  );

const labels = (c: HTMLElement) =>
  [...c.querySelectorAll('tbody tr td:first-child')].map(td =>
    td.textContent?.replace(/[▸▾]/g, '').trim(),
  );

afterEach(() => window.history.pushState({}, '', '/'));

describe('dashboard opens with the saved view', () => {
  test('sort by total, top N, collapsed, hidden values, show-as', () => {
    const { container } = render(
      <PivotPro
        {...make({
          sort_rows: 'total_desc',
          default_top_n: 2,
          expandDepth: '0',
          hidden_values: { country: ['France'] },
          defaultShowAs: 'pct_grand',
        })}
      />,
    );
    // Cars without France = 1000, Planes 900, Ships 500 → top 2
    expect(labels(container)).toEqual(['Cars', 'Planes', 'Grand total']);
    expect(container.querySelector('tbody tr td:last-child')?.textContent).toBe(
      '40.8%',
    );
    expect(
      (
        container.querySelector(
          'select[title="Show values as"]',
        ) as HTMLSelectElement
      ).value,
    ).toBe('pct_grand');
  });

  test('custom column sort and opened groups', () => {
    const { container } = render(
      <PivotPro
        {...make({
          sort_rows: 'custom',
          pivot_sort: { by: 'value', path: ['2004'], metric: 's', dir: 'desc' },
          expandDepth: '0',
          expanded_groups: { '\u0001Ships': true },
        })}
      />,
    );
    expect(labels(container)).toEqual([
      'Cars',
      'Ships',
      'Spain',
      'USA',
      'Trains',
      'Planes',
      'Grand total',
    ]);
    const th = [...container.querySelectorAll('thead th')].find(t =>
      t.textContent?.startsWith('2004'),
    );
    expect(th?.textContent).toBe('2004 ▼');
  });

  test('swap rows and columns by default', () => {
    const { container } = render(
      <PivotPro {...make({ transposePivot: true })} />,
    );
    expect(container.querySelector('thead th')?.textContent).toBe('year');
  });

  test('toolbar can be hidden and cell colouring switched off for viewers', () => {
    const { container, queryByPlaceholderText, queryByRole } = render(
      <PivotPro
        {...make({ showToolbar: false, allow_viewer_formatting: false })}
      />,
    );
    expect(queryByPlaceholderText('Search rows…')).not.toBeInTheDocument();
    fireEvent.click(
      container.querySelectorAll('tbody tr')[1].querySelectorAll('td')[1],
    );
    expect(queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('locked on dashboards (default)', () => {
  const locked = (extra: Record<string, unknown> = {}) =>
    transformProps(
      new ChartProps({
        formData: {
          viz_type: 'pivot_pro',
          slice_id: 7,
          groupbyRows: ['line', 'country'],
          groupbyColumns: ['year'],
          metrics: ['s'],
          valueFormat: ',d',
          sort_rows: 'total_desc',
          expandDepth: '0',
          ...extra,
        },
        width: 800,
        height: 500,
        theme: supersetTheme,
        queriesData: [
          {
            data,
            colnames: ['line', 'country', 'year', 's'],
            coltypes: [1, 1, 0, 0],
          },
        ],
      }),
    );

  test('shows the saved view and nothing can be changed', () => {
    window.localStorage.setItem(
      'superset-pivot-pro-formats:7',
      JSON.stringify([
        {
          id: 'p',
          type: 'cell',
          rowPath: ['Cars'],
          colPath: ['2003'],
          metric: 's',
          bg: '#E04355',
        },
      ]),
    );
    const props = locked();
    expect(props.locked).toBe(true);
    const { container, queryByPlaceholderText, queryByRole } = render(
      <PivotPro {...props} />,
    );
    expect(labels(container)).toEqual([
      'Cars',
      'Planes',
      'Ships',
      'Trains',
      'Grand total',
    ]);
    expect(queryByPlaceholderText('Search rows…')).not.toBeInTheDocument();
    expect(container.querySelector('button.pp-toggle')).toBeNull();
    expect(container.querySelector('th.sortable')).toBeNull();
    fireEvent.click(
      [...container.querySelectorAll('thead th')].find(
        t => t.textContent === '2003',
      )!,
    );
    expect(labels(container)[0]).toBe('Cars');
    const cell = container
      .querySelectorAll('tbody tr')[0]
      .querySelectorAll('td')[1] as HTMLElement;
    fireEvent.click(cell);
    expect(queryByRole('dialog')).not.toBeInTheDocument();
    expect(cell).toHaveStyle({ background: '' });
    window.localStorage.clear();
  });

  test('colours saved in the chart still show when locked', () => {
    const { container } = render(
      <PivotPro
        {...locked({
          cell_formats: [
            {
              id: 'c',
              type: 'cell',
              rowPath: ['Cars'],
              colPath: ['2003'],
              metric: 's',
              bg: '#5AC189',
            },
          ],
        })}
      />,
    );
    const cell = container
      .querySelectorAll('tbody tr')[0]
      .querySelectorAll('td')[1] as HTMLElement;
    expect(cell).toHaveStyle({ background: 'rgb(90, 193, 137)' });
  });

  test('the chart editor is never locked', () => {
    window.history.pushState({}, '', '/explore/');
    const p = make({ lock_on_dashboard: true }, jest.fn());
    expect(p.locked).toBe(false);
    const { getByText } = render(<PivotPro {...p} />);
    expect(getByText(/On dashboards it is shown locked/)).toBeInTheDocument();
  });
});

describe('in the chart editor, what you set is saved into the chart', () => {
  beforeEach(() => window.history.pushState({}, '', '/explore/?slice_id=7'));

  test('toolbar and header clicks write chart settings', () => {
    const set = jest.fn();
    const { container, getByText, getByTitle } = render(
      <PivotPro {...make({ showToolbar: false }, set)} />,
    );
    expect(getByText(/Building: the sort/)).toHaveTextContent(
      'the toolbar is hidden on dashboards',
    );

    fireEvent.click(
      [...container.querySelectorAll('thead th')].find(
        t => t.textContent === '2004',
      )!,
    );
    expect(set).toHaveBeenCalledWith('sort_rows', 'custom');
    expect(set).toHaveBeenCalledWith('pivot_sort', {
      by: 'value',
      path: ['2004'],
      metric: 's',
      dir: 'desc',
    });

    fireEvent.click(
      [...container.querySelectorAll('thead th')].find(
        t => t.textContent === 'Grand total',
      )!,
    );
    expect(set).toHaveBeenCalledWith('sort_rows', 'total_desc');
    expect(set).toHaveBeenCalledWith('sort_metric', 's');

    fireEvent.change(getByTitle('Top / bottom N'), { target: { value: '10' } });
    expect(set).toHaveBeenCalledWith('default_top_n', 10);

    fireEvent.change(getByTitle('Show values as'), {
      target: { value: 'pct_row' },
    });
    expect(set).toHaveBeenCalledWith('defaultShowAs', 'pct_row');

    fireEvent.click(getByText('Collapse all'));
    expect(set).toHaveBeenCalledWith('expandDepth', '0');
    fireEvent.click(container.querySelector('.pp-toggle')!);
    expect(set).toHaveBeenCalledWith(
      'expanded_groups',
      expect.objectContaining({}),
    );

    fireEvent.click(getByText('Filters'));
    const panel = container.querySelector('.pp-panel') as HTMLElement;
    fireEvent.click(
      within(panel)
        .getByText('Spain')
        .closest('label')!
        .querySelector('input')!,
    );
    expect(set).toHaveBeenCalledWith('hidden_values', { country: ['Spain'] });

    fireEvent.click(getByText('⇄ Swap'));
    expect(set).toHaveBeenCalledWith('transposePivot', true);

    set.mockClear();
    fireEvent.click(getByText('Reset'));
    expect(set).toHaveBeenCalledWith('sort_rows', 'none');
    expect(set).toHaveBeenCalledWith('default_top_n', 0);
    expect(set).toHaveBeenCalledWith('hidden_values', {});
    expect(set).toHaveBeenCalledWith('transposePivot', false);
  });

  test('cell colours go into the chart', () => {
    const set = jest.fn();
    const { container, getByRole } = render(<PivotPro {...make({}, set)} />);
    fireEvent.click(
      container.querySelectorAll('tbody tr')[1].querySelectorAll('td')[1],
    );
    fireEvent.click(
      within(getByRole('dialog')).getAllByLabelText('Colour #5AC189')[0],
    );
    expect(set).toHaveBeenCalledWith('cell_formats', [
      expect.objectContaining({ type: 'cell', bg: '#5AC189' }),
    ]);
  });
});
