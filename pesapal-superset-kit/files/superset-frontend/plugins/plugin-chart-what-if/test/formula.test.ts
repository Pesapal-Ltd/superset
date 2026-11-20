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
import { evaluate, parseFormula, refsOf } from '../src/formula';

test('arithmetic, precedence, functions', () => {
  const v = (f: string, vars = {}) => evaluate(parseFormula(f), vars);
  expect(v('1 + 2 * 3')).toBe(7);
  expect(v('(1 + 2) * 3')).toBe(9);
  expect(v('2 ^ 3 ^ 2')).toBe(512);
  expect(v('-[a] + 1', { a: 4 })).toBe(-3);
  expect(v('MAX(1, [a], 3)', { a: 5 })).toBe(5);
  expect(v('ROUND(2.345, 2)')).toBe(2.35);
  expect(v('IF([a] > 1, 10, 20)', { a: 2 })).toBe(10);
  expect(v('[a] / 0', { a: 2 })).toBeNull();
});

test('names with spaces and symbols, case-insensitive', () => {
  const e = parseFormula('[SUM(sales)] * (1 + [Price %] / 100)');
  expect([...refsOf(e)]).toEqual(['SUM(sales)', 'Price %']);
  expect(evaluate(e, { 'SUM(sales)': 200, 'price %': 10 })).toBeCloseTo(220);
});

test('errors', () => {
  expect(() => parseFormula('1 +')).toThrow(/ended too early/);
  expect(() => parseFormula('(1')).toThrow(/Expected "\)"/);
  expect(() => evaluate(parseFormula('[x]'), {})).toThrow(/Unknown name \[x\]/);
  expect(() => evaluate(parseFormula('FOO(1)'), {})).toThrow(
    /Unknown function FOO/,
  );
});
