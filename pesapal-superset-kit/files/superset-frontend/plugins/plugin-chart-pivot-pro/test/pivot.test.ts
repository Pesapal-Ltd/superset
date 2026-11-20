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
import {
  buildColumns,
  buildHeader,
  buildPivot,
  cellValue,
  distinctValues,
  flattenRows,
  searchTree,
  sortTree,
  topN,
  valueComparator,
} from '../src/engine/pivot';

const records = [
  { line: 'Cars', country: 'USA', year: 2003, q: 'Q1', s: 100 },
  { line: 'Cars', country: 'USA', year: 2003, q: 'Q2', s: 150 },
  { line: 'Cars', country: 'France', year: 2004, q: 'Q1', s: 50 },
  { line: 'Ships', country: 'USA', year: 2003, q: 'Q1', s: 30 },
  { line: 'Ships', country: 'Spain', year: 2004, q: 'Q1', s: 70 },
  { line: 'Planes', country: 'USA', year: 2004, q: 'Q2', s: 10 },
];
const metrics = [{ key: 's', label: 'Sales' }];
const model = buildPivot({
  records,
  rowDims: ['line', 'country'],
  colDims: ['year'],
  metrics,
});

test('totals, subtotals and cells', () => {
  expect(model.get([], [], 0)).toBe(410);
  expect(model.get(['Cars'], [], 0)).toBe(300);
  expect(model.get(['Cars', 'USA'], ['2003'], 0)).toBe(250);
  expect(model.get(['Cars'], ['2004'], 0)).toBe(50);
  expect(model.get([], ['2004'], 0)).toBe(130);
  expect(model.get(['Planes'], ['2003'], 0)).toBeNull();
});

test('other aggregations', () => {
  const m = buildPivot({
    records,
    rowDims: ['line'],
    colDims: [],
    metrics,
    agg: 'avg',
  });
  expect(m.get(['Cars'], [], 0)).toBe(100);
  expect(
    buildPivot({
      records,
      rowDims: ['line'],
      colDims: [],
      metrics,
      agg: 'count',
    }).get([], [], 0),
  ).toBe(6);
  expect(
    buildPivot({
      records,
      rowDims: ['line'],
      colDims: [],
      metrics,
      agg: 'max',
    }).get(['Ships'], [], 0),
  ).toBe(70);
});

test('labels sorted naturally and value filters exclude records', () => {
  expect(model.rowRoot.children.map(c => c.label)).toEqual([
    'Cars',
    'Planes',
    'Ships',
  ]);
  const m = buildPivot({
    records,
    rowDims: ['line'],
    colDims: [],
    metrics,
    exclude: { country: ['USA'] },
  });
  // country isn't a row/col dim, so exclusion only applies to pivot dims
  expect(m.get([], [], 0)).toBe(410);
  const m2 = buildPivot({
    records,
    rowDims: ['line', 'country'],
    colDims: [],
    metrics,
    exclude: { country: ['USA'] },
  });
  expect(m2.get([], [], 0)).toBe(120);
  expect(m2.rowRoot.children.map(c => c.label)).toEqual(['Cars', 'Ships']);
});

test('sort by value, search, top N', () => {
  const m = buildPivot({
    records,
    rowDims: ['line', 'country'],
    colDims: ['year'],
    metrics,
  });
  sortTree(m.rowRoot, valueComparator(m, [], 0, 'desc'));
  expect(m.rowRoot.children.map(c => c.label)).toEqual([
    'Cars',
    'Ships',
    'Planes',
  ]);
  expect(m.rowRoot.children[0].children.map(c => c.label)).toEqual([
    'USA',
    'France',
  ]);

  const s = searchTree(m.rowRoot, 'spa');
  expect(s.children.map(c => c.label)).toEqual(['Ships']);
  expect(s.children[0].children.map(c => c.label)).toEqual(['Spain']);
  // matching a parent keeps all its children
  expect(searchTree(m.rowRoot, 'cars').children[0].children).toHaveLength(2);

  expect(topN(m, m.rowRoot, 2).children.map(c => c.label)).toEqual([
    'Cars',
    'Ships',
  ]);
  expect(topN(m, m.rowRoot, 1, 0, true).children.map(c => c.label)).toEqual([
    'Planes',
  ]);
});

test('flatten respects expansion', () => {
  const all = flattenRows(model.rowRoot, () => true);
  expect(all.map(r => r.node.label)).toEqual([
    'Cars',
    'France',
    'USA',
    'Planes',
    'USA',
    'Ships',
    'Spain',
    'USA',
  ]);
  const top = flattenRows(model.rowRoot, () => false);
  expect(top.map(r => r.node.label)).toEqual(['Cars', 'Planes', 'Ships']);
  expect(top[0].hasChildren).toBe(true);
});

test('columns, subtotals and header spans', () => {
  const m = buildPivot({
    records,
    rowDims: ['line'],
    colDims: ['year', 'q'],
    metrics,
  });
  const cols = buildColumns(m.colRoot, 2, 1, true, true);
  expect(cols.map(c => `${c.kind}:${c.path.join('/')}`)).toEqual([
    'leaf:2003/Q1',
    'leaf:2003/Q2',
    'subtotal:2003',
    'leaf:2004/Q1',
    'leaf:2004/Q2',
    'subtotal:2004',
    'grand:',
  ]);
  const header = buildHeader(cols, 2, ['Sales'], false);
  expect(header[0].map(h => [h.label, h.colSpan, h.rowSpan])).toEqual([
    ['2003', 3, 1],
    ['2004', 3, 1],
    ['Grand total', 1, 2],
  ]);
  expect(header[1].map(h => [h.label, h.colSpan])).toEqual([
    ['Q1', 1],
    ['Q2', 1],
    ['2003 total', 1],
    ['Q1', 1],
    ['Q2', 1],
    ['2004 total', 1],
  ]);
  // two metrics add a metric row and double the columns
  const cols2 = buildColumns(m.colRoot, 2, 2, false, true);
  expect(cols2).toHaveLength(10);
  const h2 = buildHeader(cols2, 2, ['A', 'B'], true);
  expect(h2[2].map(h => h.label).slice(0, 4)).toEqual(['A', 'B', 'A', 'B']);
  expect(h2[0][0]).toMatchObject({ label: '2003', colSpan: 4 });
});

test('show values as', () => {
  const m = buildPivot({
    records,
    rowDims: ['line'],
    colDims: ['year'],
    metrics,
  });
  const cols = buildColumns(m.colRoot, 1, 1, false, true);
  const cars = m.rowRoot.children.find(c => c.label === 'Cars')!;
  const v = (mode: any, i: number) =>
    cellValue(m, cars, cols, i, mode, m.rowRoot.children);
  expect(v('value', 0)).toBe(250);
  expect(v('pct_grand', 0)).toBeCloseTo(250 / 410);
  expect(v('pct_row', 0)).toBeCloseTo(250 / 300);
  expect(v('pct_col', 1)).toBeCloseTo(50 / 130);
  expect(v('pct_parent', 0)).toBeCloseTo(250 / 280);
  expect(v('diff_prev', 0)).toBeNull();
  expect(v('diff_prev', 1)).toBe(-200);
  expect(v('pct_diff_prev', 1)).toBeCloseTo(-0.8);
  expect(v('running', 1)).toBe(300);
  expect(v('rank', 0)).toBe(1);
  const ships = m.rowRoot.children.find(c => c.label === 'Ships')!;
  expect(cellValue(m, ships, cols, 1, 'rank', m.rowRoot.children)).toBe(1);
  expect(cellValue(m, ships, cols, 0, 'rank', m.rowRoot.children)).toBe(2);
});

test('distinct values for filter menus', () => {
  const d = distinctValues(records, ['line', 'year']);
  expect(d.line.map(x => [x.label, x.count])).toEqual([
    ['Cars', 3],
    ['Planes', 1],
    ['Ships', 2],
  ]);
  expect(d.year.map(x => x.label)).toEqual(['2003', '2004']);
});
