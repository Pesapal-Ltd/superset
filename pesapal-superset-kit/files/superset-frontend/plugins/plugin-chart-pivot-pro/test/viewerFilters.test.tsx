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
import buildQuery from '../src/plugin/buildQuery';
import transformProps from '../src/plugin/transformProps';
import PivotPro from '../src/PivotPro';
import { activeSelection, parseFilterFields } from '../src/viewerFilters';

const render = (ui: ReactElement) =>
  rtlRender(<ThemeProvider theme={supersetTheme}>{ui}</ThemeProvider>);

const formData = {
  datasource: '1__table',
  viz_type: 'pivot_pro',
  slice_id: 3,
  groupbyRows: ['line'],
  groupbyColumns: ['year'],
  metrics: ['s'],
  viewer_filters: ['country', 'deal_size'],
  viewer_filter_defaults: { country: ['USA'] },
};

describe('query', () => {
  test('defaults apply when the viewer has not chosen anything', () => {
    const qs = buildQuery(formData as any).queries;
    expect(qs).toHaveLength(3); // main + one value list per field
    expect(qs[0].filters).toEqual(
      expect.arrayContaining([{ col: 'country', op: 'IN', val: ['USA'] }]),
    );
    // value-list queries are not narrowed by the viewer's own choice
    expect(qs[1].columns).toEqual(['country']);
    expect(
      qs[1].filters?.some(f => f.col === 'country' && f.op === 'IN'),
    ).toBeFalsy();
    expect(qs[2].columns).toEqual(['deal_size']);
  });

  test("the viewer's choice replaces the defaults; empty means all", () => {
    const q1 = buildQuery(formData as any, {
      ownState: { viewerFilters: { deal_size: ['Large', 'Medium'] } },
    }).queries[0];
    expect(q1.filters).toEqual(
      expect.arrayContaining([
        { col: 'deal_size', op: 'IN', val: ['Large', 'Medium'] },
      ]),
    );
    expect(q1.filters?.some(f => f.col === 'country')).toBe(false);
    const q2 = buildQuery(formData as any, { ownState: { viewerFilters: {} } })
      .queries[0];
    expect(q2.filters?.some(f => f.op === 'IN')).toBeFalsy();
  });

  test('unknown fields in a selection are ignored', () => {
    expect(
      activeSelection(formData as any, {
        viewerFilters: { secret: ['x'], country: [] },
      }),
    ).toEqual({});
  });

  test('value lists are parsed, blanks dropped, sorted', () => {
    const fields = parseFilterFields(
      formData as any,
      [
        { data: [] },
        {
          data: [
            { country: 'USA', vf_count: 5 },
            { country: 'France', vf_count: 2 },
            { country: null, vf_count: 1 },
          ],
        },
        { data: [{ deal_size: 'Small' }, { deal_size: 'Large' }] },
      ],
      1,
      { country: 'Country' },
    );
    expect(fields[0]).toMatchObject({ key: 'country', label: 'Country' });
    expect(fields[0].options.map(o => [o.label, o.count])).toEqual([
      ['France', 2],
      ['USA', 5],
    ]);
    expect(fields[1].options.map(o => o.value)).toEqual(['Large', 'Small']);
  });
});

describe('filter bar on the chart', () => {
  const make = (
    setDataMask: jest.Mock,
    setControlValue?: jest.Mock,
    extra = {},
  ) =>
    transformProps(
      new ChartProps({
        formData: { ...formData, ...extra },
        width: 800,
        height: 400,
        theme: supersetTheme,
        hooks: { setDataMask, ...(setControlValue ? { setControlValue } : {}) },
        queriesData: [
          {
            data: [{ line: 'Cars', year: 2003, s: 10 }],
            colnames: ['line', 'year', 's'],
            coltypes: [1, 0, 0],
          },
          {
            data: [
              { country: 'USA', vf_count: 5 },
              { country: 'France', vf_count: 2 },
            ],
          },
          { data: [{ deal_size: 'Small' }, { deal_size: 'Large' }] },
        ],
      }),
    );

  afterEach(() => window.history.pushState({}, '', '/'));

  test('shown on a locked dashboard table; Apply re-runs only this chart', () => {
    const setDataMask = jest.fn();
    const props = make(setDataMask);
    expect(props.locked).toBe(true);
    const { getByText, getByRole, queryByPlaceholderText } = render(
      <PivotPro {...props} />,
    );
    expect(queryByPlaceholderText('Search rows…')).not.toBeInTheDocument(); // toolbar locked away
    expect(getByText('country: USA ▾')).toBeInTheDocument();
    fireEvent.click(getByText('deal_size: All ▾'));
    const pop = getByRole('dialog', { name: 'Filter deal_size' });
    fireEvent.click(
      within(pop).getByText('Large').closest('label')!.querySelector('input')!,
    );
    fireEvent.click(within(pop).getByText('Apply'));
    expect(setDataMask).toHaveBeenCalledWith({
      ownState: { viewerFilters: { country: ['USA'], deal_size: ['Large'] } },
    });
  });

  test('Clear filters removes every choice', () => {
    const setDataMask = jest.fn();
    const { getByText } = render(<PivotPro {...make(setDataMask)} />);
    fireEvent.click(getByText('Clear filters'));
    expect(setDataMask).toHaveBeenCalledWith({
      ownState: { viewerFilters: {} },
    });
  });

  test('in the chart editor the choice also becomes the default', () => {
    window.history.pushState({}, '', '/explore/');
    const setDataMask = jest.fn();
    const setControlValue = jest.fn();
    const { getByText, getByRole } = render(
      <PivotPro {...make(setDataMask, setControlValue)} />,
    );
    fireEvent.click(getByText('country: USA ▾'));
    const pop = getByRole('dialog', { name: 'Filter country' });
    fireEvent.click(
      within(pop).getByText('France').closest('label')!.querySelector('input')!,
    );
    fireEvent.click(within(pop).getByText('Apply'));
    expect(setControlValue).toHaveBeenCalledWith('viewer_filter_defaults', {
      country: ['USA', 'France'],
    });
  });
});
