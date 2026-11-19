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
import HtmlContent from '../src/HtmlContent';

const render = (ui: ReactElement) =>
  rtlRender(<ThemeProvider theme={supersetTheme}>{ui}</ThemeProvider>);

const formData = {
  datasource: '1__table',
  viz_type: 'html_content',
  query_mode: 'raw',
  all_columns: ['order_number', 'sales'],
  viewer_filters: ['country'],
  html_page:
    '<p id="n">{{ @rowCount }}</p><script>document.title = JSON.stringify(window.supersetData.filters)</script>',
};

test('raw and aggregate queries both get the viewer filter', () => {
  const raw = buildQuery(formData as any, {
    ownState: { viewerFilters: { country: ['Kenya'] } },
  }).queries;
  expect(raw).toHaveLength(2);
  expect(raw[0].columns).toEqual(['order_number', 'sales']);
  expect(raw[0].filters).toEqual(
    expect.arrayContaining([{ col: 'country', op: 'IN', val: ['Kenya'] }]),
  );
  const agg = buildQuery(
    {
      ...formData,
      query_mode: 'aggregate',
      groupby: ['status'],
      metrics: ['m'],
    } as any,
    {
      ownState: { viewerFilters: { country: ['Kenya'] } },
    },
  ).queries;
  expect(agg[0].filters).toEqual(
    expect.arrayContaining([{ col: 'country', op: 'IN', val: ['Kenya'] }]),
  );
  expect(agg[1].columns).toEqual(['country']);
});

test('filter bar above the page; the page sees the choice', () => {
  const setDataMask = jest.fn();
  const props = transformProps(
    new ChartProps({
      formData,
      width: 600,
      height: 300,
      theme: supersetTheme,
      hooks: { setDataMask },
      ownState: { viewerFilters: { country: ['Kenya'] } },
      queriesData: [
        {
          data: [{ order_number: 1, sales: 10 }],
          colnames: ['order_number', 'sales'],
        },
        {
          data: [
            { country: 'Kenya', vf_count: 1 },
            { country: 'Uganda', vf_count: 3 },
          ],
        },
      ],
    }),
  );
  const { getByText, getByRole, container } = render(
    <HtmlContent {...props} />,
  );
  expect(getByText('country: Kenya ▾')).toBeInTheDocument();
  const doc = container.querySelector('iframe')!.getAttribute('srcdoc')!;
  expect(doc).toContain('"filters":{"country":["Kenya"]}');
  fireEvent.click(getByText('country: Kenya ▾'));
  const pop = getByRole('dialog');
  fireEvent.click(
    within(pop).getByText('Uganda').closest('label')!.querySelector('input')!,
  );
  fireEvent.click(within(pop).getByText('Apply'));
  expect(setDataMask).toHaveBeenCalledWith({
    ownState: { viewerFilters: { country: ['Kenya', 'Uganda'] } },
  });
});

test('no filter fields: no bar', () => {
  const props = transformProps(
    new ChartProps({
      formData: { ...formData, viewer_filters: [] },
      width: 600,
      height: 300,
      theme: supersetTheme,
      queriesData: [{ data: [], colnames: [] }],
    }),
  );
  const { container } = render(<HtmlContent {...props} />);
  expect(container.querySelector('.viewer-filters')).toBeNull();
});
