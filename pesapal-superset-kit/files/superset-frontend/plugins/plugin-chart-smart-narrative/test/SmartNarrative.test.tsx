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
import { render as rtlRender } from '@testing-library/react';
import { ChartProps, ThemeProvider, supersetTheme } from '@superset-ui/core';
import SmartNarrative from '../src/SmartNarrative';
import transformProps from '../src/plugin/transformProps';
import buildQuery from '../src/plugin/buildQuery';

const render = (ui: ReactElement) =>
  rtlRender(<ThemeProvider theme={supersetTheme}>{ui}</ThemeProvider>);

const formData = {
  datasource: '1__table',
  viz_type: 'smart_narrative',
  metric: 'sum__sales',
  x_axis: 'order_date',
  time_grain_sqla: 'P3M',
  groupby: ['product_line'],
  metric_name: 'Revenue',
  y_axis_format: ',d',
};

const chartProps = new ChartProps({
  formData,
  width: 400,
  height: 300,
  theme: supersetTheme,
  queriesData: [
    {
      data: [
        {
          order_date: Date.UTC(2004, 0, 1),
          product_line: 'Ships',
          sum__sales: 100,
        },
        {
          order_date: Date.UTC(2004, 3, 1),
          product_line: 'Ships',
          sum__sales: 150,
        },
        {
          order_date: Date.UTC(2004, 3, 1),
          product_line: 'Planes',
          sum__sales: 50,
        },
      ],
    },
  ],
});

test('buildQuery groups by time and explain-by columns', () => {
  const q = buildQuery(formData as any).queries[0];
  expect(q.columns).toHaveLength(2);
  expect(q.metrics).toEqual(['sum__sales']);
});

test('transformProps writes quarter-aware commentary', () => {
  const props = transformProps(chartProps);
  const headline = props.narrative.headline
    .map(p => (typeof p === 'string' ? p : p.text))
    .join('');
  expect(headline).toBe(
    'Revenue was 200 in Q2 2004, up 100.0% vs Q1 2004 (100).',
  );
  expect(props.rowCount).toBe(3);
});

test('renders headline, insights and footer', () => {
  const { getByText, container } = render(
    <SmartNarrative {...transformProps(chartProps)} />,
  );
  expect(getByText('Commentary')).toBeInTheDocument();
  expect(container).toHaveTextContent(/Revenue was 200 in Q2 2004/);
  expect(container.querySelectorAll('li').length).toBeGreaterThan(0);
  expect(container).toHaveTextContent(/Written automatically from 3 rows/);
});
