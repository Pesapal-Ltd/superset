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
  addRule,
  cellHighlight,
  loadPersonal,
  matches,
  metricToggle,
  removeFormat,
  ruleColor,
  savePersonal,
  setCellHighlight,
  setMetricToggle,
} from '../src/engine/clickFormats';

test('operators', () => {
  expect(matches('>', 2, 1)).toBe(true);
  expect(matches('>', 1, 1)).toBe(false);
  expect(matches('>=', 1, 1)).toBe(true);
  expect(matches('=', 0.1 + 0.2, 0.3)).toBe(true);
  expect(matches('<=', 1, 1)).toBe(true);
  expect(matches('<', 1, 1)).toBe(false);
});

test('cell highlight add / replace / remove', () => {
  let f = setCellHighlight([], ['Cars'], ['2003'], 'Sales', '#FFF3BF');
  expect(cellHighlight(f, ['Cars'], ['2003'], 'Sales')).toBe('#FFF3BF');
  expect(cellHighlight(f, ['Cars'], ['2004'], 'Sales')).toBeUndefined();
  f = setCellHighlight(f, ['Cars'], ['2003'], 'Sales', '#E04355');
  expect(f).toHaveLength(1);
  expect(cellHighlight(f, ['Cars'], ['2003'], 'Sales')).toBe('#E04355');
  f = setCellHighlight(f, ['Cars'], ['2003'], 'Sales', null);
  expect(f).toHaveLength(0);
});

test('rules: last match wins, scoped to metric and show-as', () => {
  let f = addRule([], 'Sales', '>', 100, 'value', 'green');
  f = addRule(f, 'Sales', '>', 500, 'value', 'blue');
  expect(ruleColor(f, 'Sales', 'value', 200)).toBe('green');
  expect(ruleColor(f, 'Sales', 'value', 600)).toBe('blue');
  expect(ruleColor(f, 'Sales', 'pct_grand', 600)).toBeUndefined();
  expect(ruleColor(f, 'Qty', 'value', 600)).toBeUndefined();
  f = removeFormat(f, f[1].id);
  expect(ruleColor(f, 'Sales', 'value', 600)).toBe('green');
});

test('rules only colour cells of the same kind', () => {
  const f = addRule([], 'Sales', '>', 100, 'value', 'green', 'total');
  expect(ruleColor(f, 'Sales', 'value', 200, 'total')).toBe('green');
  expect(ruleColor(f, 'Sales', 'value', 200, 'detail')).toBeUndefined();
  // older rules without a scope count as detail rules
  const old = [
    {
      id: 'x',
      type: 'rule' as const,
      metric: 'Sales',
      op: '>' as const,
      value: 1,
      showAs: 'value' as const,
      bg: 'red',
    },
  ];
  expect(ruleColor(old, 'Sales', 'value', 5)).toBe('red');
});

test('metric toggles override chart settings', () => {
  expect(metricToggle([], 'Sales', 'heat', true)).toBe(true);
  let f = setMetricToggle([], 'Sales', 'heat', false);
  expect(metricToggle(f, 'Sales', 'heat', true)).toBe(false);
  f = setMetricToggle(f, 'Sales', 'heat', true);
  expect(f).toHaveLength(1);
  expect(metricToggle(f, 'Sales', 'bar', false)).toBe(false);
});

test('personal storage round trip', () => {
  const f = addRule([], 'Sales', '<', 5, 'value', 'red');
  savePersonal('k', f);
  expect(loadPersonal('k')).toEqual(f);
  savePersonal('k', []);
  expect(window.localStorage.getItem('k')).toBeNull();
});
