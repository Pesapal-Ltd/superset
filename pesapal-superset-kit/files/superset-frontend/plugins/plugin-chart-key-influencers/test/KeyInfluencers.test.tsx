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
import KeyInfluencers from '../src/KeyInfluencers';
import transformProps from '../src/plugin/transformProps';
import buildQuery from '../src/plugin/buildQuery';

const render = (ui: ReactElement) =>
  rtlRender(<ThemeProvider theme={supersetTheme}>{ui}</ThemeProvider>);

let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const rows = Array.from({ length: 2000 }, () => {
  const deal_size = ['Small', 'Medium', 'Large'][Math.floor(rnd() * 3)];
  const country = ['USA', 'France', 'Spain'][Math.floor(rnd() * 3)];
  return {
    sales:
      (deal_size === 'Large' ? 6000 : deal_size === 'Medium' ? 3500 : 2000) +
      rnd() * 500,
    status:
      rnd() < (country === 'Spain' ? 0.3 : 0.04) ? 'Cancelled' : 'Shipped',
    deal_size,
    country,
  };
});

const make = (extra: Record<string, unknown> = {}) =>
  transformProps(
    new ChartProps({
      formData: {
        viz_type: 'key_influencers',
        target: 'sales',
        groupby: ['deal_size', 'country'],
        target_name: 'Sales',
        y_axis_format: '$,.0f',
        ...extra,
      },
      width: 900,
      height: 500,
      theme: supersetTheme,
      queriesData: [{ data: rows }],
    }),
  );

test('query fetches the target and the explain-by fields as rows', () => {
  const q = buildQuery({
    datasource: '1__table',
    viz_type: 'x',
    target: 'sales',
    groupby: ['deal_size', 'sales'],
  } as any).queries[0];
  expect(q.columns).toEqual(['sales', 'deal_size']);
  expect(q.metrics).toBeUndefined();
});

test('numeric target lists influencers with a detail chart', () => {
  const { container, getByRole, getByText } = render(
    <KeyInfluencers {...make()} />,
  );
  expect(container).toHaveTextContent(/What influences Sales to/);
  const first = container.querySelector('.ki-item')!;
  expect(first).toHaveTextContent(
    /When deal_size is Large, the average Sales increases by \$\d/,
  );
  expect(getByRole('img', { name: 'Influencer detail' })).toBeInTheDocument();
  expect(getByText(/^average \$/)).toBeInTheDocument();
  // country is noise here
  expect(container).not.toHaveTextContent(/country is/);
});

test('switch to decrease', () => {
  const { container, getByLabelText } = render(<KeyInfluencers {...make()} />);
  fireEvent.change(getByLabelText('Direction'), {
    target: { value: 'decrease' },
  });
  expect(container.querySelector('.ki-item')!).toHaveTextContent(
    /deal_size is Small, the average Sales decreases/,
  );
});

test('text target: likelihood of an outcome', () => {
  const { container } = render(
    <KeyInfluencers
      {...make({
        target: 'status',
        target_value: 'Cancelled',
        target_name: 'status',
      })}
    />,
  );
  expect(container.querySelector('.ki-item')!).toHaveTextContent(
    /When country is Spain, status is \d+\.\d\d× more likely to be Cancelled/,
  );
});

test('top segments tab', () => {
  const { getByText, container } = render(<KeyInfluencers {...make()} />);
  fireEvent.click(getByText(/^Top segments/));
  expect(container.querySelector('.ki-seg')!).toHaveTextContent(
    /deal_size is Large/,
  );
  expect(container.querySelector('.ki-seg')!).toHaveTextContent(/vs average/);
});

test('viewers cannot switch when not allowed; empty states', () => {
  const { queryByLabelText } = render(
    <KeyInfluencers {...make({ allow_direction: false })} />,
  );
  expect(queryByLabelText('Direction')).not.toBeInTheDocument();
  const e = render(<KeyInfluencers {...make({ groupby: [] })} />);
  expect(e.container).toHaveTextContent(/at least one field to Explain by/);
});
