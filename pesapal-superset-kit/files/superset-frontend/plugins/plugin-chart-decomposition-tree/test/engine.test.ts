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
  aiPick,
  filterPath,
  resolve,
  split,
  total,
  unusedDims,
} from '../src/engine';

const rows = [
  { country: 'USA', line: 'Cars', deal: 'Large', s: 500 },
  { country: 'USA', line: 'Ships', deal: 'Small', s: 100 },
  { country: 'France', line: 'Cars', deal: 'Small', s: 200 },
  { country: 'France', line: 'Planes', deal: 'Large', s: 50 },
  { country: 'Spain', line: 'Ships', deal: 'Medium', s: 150 },
  { country: null, line: 'Cars', deal: 'Small', s: 10 },
];
const dims = ['country', 'line', 'deal'];

test('split and total', () => {
  expect(total(rows, 's')).toBe(1010);
  expect(split(rows, 'country', 's')).toEqual([
    { label: 'USA', value: 600 },
    { label: 'France', value: 250 },
    { label: 'Spain', value: 150 },
    { label: '(blank)', value: 10 },
  ]);
  expect(filterPath(rows, [{ dim: 'country', label: 'France' }])).toHaveLength(
    2,
  );
});

test('AI split picks the field with the biggest / smallest single value', () => {
  // biggest contributor: line=Cars 710 beats country=USA 600 and deal=Large 550
  expect(aiPick(rows, dims, 's', 'high')).toBe('line');
  // smallest: country (blank) 10
  expect(aiPick(rows, dims, 's', 'low')).toBe('country');
});

test('resolve manual levels; deeper levels need a selection', () => {
  const r = resolve(rows, 's', dims, [
    { dim: 'country', mode: 'manual', selected: 'USA' },
    { dim: 'line', mode: 'manual', selected: null },
    { dim: 'deal', mode: 'manual', selected: null },
  ]);
  expect(r.rootValue).toBe(1010);
  expect(r.columns.map(c => c.dim)).toEqual(['country', 'line']);
  expect(r.columns[1].items).toEqual([
    { label: 'Cars', value: 500 },
    { label: 'Ships', value: 100 },
  ]);
  expect(r.columns[1].parentValue).toBe(600);
  expect(unusedDims(dims, r.columns)).toEqual(['deal']);
});

test('AI levels auto-select their extreme bar and chain', () => {
  const r = resolve(rows, 's', dims, [
    { dim: null, mode: 'high', selected: null },
    { dim: null, mode: 'high', selected: null },
  ]);
  expect(r.columns.map(c => [c.dim, c.selected])).toEqual([
    ['line', 'Cars'],
    ['country', 'USA'],
  ]);
});

test('stale selections and duplicate fields are dropped', () => {
  const r = resolve(rows, 's', dims, [
    { dim: 'country', mode: 'manual', selected: 'Kenya' },
    { dim: 'country', mode: 'manual', selected: null },
  ]);
  expect(r.columns).toHaveLength(1);
  expect(r.columns[0].selected).toBeNull();
});
