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
import { PivotProProps } from '../src/types';

const render = (ui: ReactElement) =>
  rtlRender(<ThemeProvider theme={supersetTheme}>{ui}</ThemeProvider>);

const data = [
  { line: 'Cars', year: 2003, s: 1000 },
  { line: 'Cars', year: 2004, s: 1500 },
  { line: 'Ships', year: 2003, s: 300 },
  { line: 'Ships', year: 2004, s: 200 },
  { line: 'Trains', year: 2004, s: 50 },
];

const base = (): PivotProProps =>
  transformProps(
    new ChartProps({
      formData: {
        viz_type: 'pivot_pro',
        slice_id: 42,
        groupbyRows: ['line'],
        groupbyColumns: ['year'],
        metrics: ['s'],
        valueFormat: ',d',
        lock_on_dashboard: false,
      },
      width: 800,
      height: 500,
      theme: supersetTheme,
      queriesData: [
        { data, colnames: ['line', 'year', 's'], coltypes: [1, 0, 0] },
      ],
    }),
  );

const cell = (c: HTMLElement, row: string, col: number) => {
  const tr = [...c.querySelectorAll('tbody tr')].find(t =>
    t.querySelector('td')?.textContent?.includes(row),
  )!;
  return tr.querySelectorAll('td')[col] as HTMLElement;
};

beforeEach(() => window.localStorage.clear());

test('storage key uses the chart id', () => {
  expect(base().storageKey).toBe('superset-pivot-pro-formats:42');
  expect(base().persistToChart).toBeUndefined(); // not in the chart editor
});

test('click a cell, highlight it, saved for the viewer', () => {
  const { container, getByRole } = render(<PivotPro {...base()} />);
  fireEvent.click(cell(container, 'Cars', 1));
  const pop = getByRole('dialog', { name: 'Format cell' });
  expect(pop).toHaveTextContent('Cars · 2003 = 1,000');
  fireEvent.click(within(pop).getAllByLabelText('Colour #FFF3BF')[0]);
  expect(cell(container, 'Cars', 1)).toHaveStyle({
    background: 'rgb(255, 243, 191)',
  });
  expect(cell(container, 'Ships', 1)).toHaveStyle({ background: '' });
  expect(
    JSON.parse(window.localStorage.getItem('superset-pivot-pro-formats:42')!),
  ).toHaveLength(1);
  expect(pop).toHaveTextContent('Saved for you in this browser.');
  // remove it again
  fireEvent.click(within(pop).getByTitle('No colour'));
  expect(cell(container, 'Cars', 1)).toHaveStyle({ background: '' });
});

test('rule from the clicked value colours matching cells', () => {
  const { container, getByRole } = render(<PivotPro {...base()} />);
  fireEvent.click(cell(container, 'Ships', 1)); // 300
  const pop = getByRole('dialog');
  fireEvent.click(within(pop).getByTitle('at least'));
  fireEvent.click(within(pop).getAllByLabelText('Colour #5AC189')[1]);
  expect(cell(container, 'Cars', 1)).toHaveStyle({
    background: 'rgb(90, 193, 137)',
  }); // 1000
  expect(cell(container, 'Ships', 1)).toHaveStyle({
    background: 'rgb(90, 193, 137)',
  }); // 300
  expect(cell(container, 'Ships', 2)).toHaveStyle({ background: '' }); // 200
  expect(pop).toHaveTextContent('at least 300');
  fireEvent.click(within(pop).getByTitle('Remove rule'));
  expect(cell(container, 'Cars', 1)).toHaveStyle({ background: '' });
});

test('turn on a colour scale and icons for the whole metric', () => {
  const { container, getByRole } = render(<PivotPro {...base()} />);
  fireEvent.click(cell(container, 'Cars', 1));
  const pop = getByRole('dialog');
  fireEvent.click(within(pop).getByText('Colour scale'));
  fireEvent.click(within(pop).getByText('Icons'));
  expect(cell(container, 'Trains', 2)).not.toHaveStyle({ background: '' });
  expect(cell(container, 'Cars', 2).querySelector('.pp-icon')).not.toBeNull();
  expect(within(pop).getByText(/Colour scale/)).toHaveTextContent('✓');
});

test('formats persist across reloads for the viewer', () => {
  const first = render(<PivotPro {...base()} />);
  fireEvent.click(cell(first.container, 'Cars', 1));
  fireEvent.click(
    within(first.getByRole('dialog')).getAllByLabelText('Colour #E04355')[0],
  );
  first.unmount();
  const second = render(<PivotPro {...base()} />);
  expect(cell(second.container, 'Cars', 1)).toHaveStyle({
    background: 'rgb(224, 67, 85)',
  });
});

test('in the chart editor formats go into the chart', () => {
  const persist = jest.fn();
  const { container, getByRole } = render(
    <PivotPro {...base()} persistToChart={persist} />,
  );
  fireEvent.click(cell(container, 'Cars', 1));
  const pop = getByRole('dialog');
  expect(pop).toHaveTextContent('Saved in the chart. Click Save to keep it.');
  fireEvent.click(within(pop).getAllByLabelText('Colour #D0EBFF')[0]);
  expect(persist).toHaveBeenCalledWith([
    expect.objectContaining({
      type: 'cell',
      rowPath: ['Cars'],
      colPath: ['2003'],
      bg: '#D0EBFF',
    }),
  ]);
  expect(window.localStorage.length).toBe(0);
});

test('saved chart formats survive swapping rows and columns', () => {
  const props = {
    ...base(),
    savedFormats: [
      {
        id: 'a',
        type: 'cell' as const,
        rowPath: ['Cars'],
        colPath: ['2003'],
        metric: 's',
        bg: '#E04355',
      },
    ],
  };
  const { container, getByText } = render(<PivotPro {...props} />);
  expect(cell(container, 'Cars', 1)).toHaveStyle({
    background: 'rgb(224, 67, 85)',
  });
  fireEvent.click(getByText('⇄ Swap'));
  // now rows are years, columns are lines: Cars is column 1 of row 2003
  expect(cell(container, '2003', 1)).toHaveStyle({
    background: 'rgb(224, 67, 85)',
  });
});

test('Escape closes the menu', () => {
  const { container, queryByRole } = render(<PivotPro {...base()} />);
  fireEvent.click(cell(container, 'Cars', 1));
  expect(queryByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(queryByRole('dialog')).not.toBeInTheDocument();
});
