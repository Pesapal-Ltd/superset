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
import { buildNarrative, partsToText, slope, ordinal } from '../src/narrative';

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const month = (i: number) => Date.UTC(2004, i, 1);
const fmtP = (t: number) =>
  new Date(t).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

// 6 months x 3 product lines; Classic Cars jumps in the last month
const lines = {
  'Classic Cars': [100, 110, 120, 130, 140, 300],
  Ships: [50, 52, 48, 51, 60, 40],
  Trains: [10, 12, 11, 9, 10, 12],
};
const rows = Object.entries(lines).flatMap(([product_line, vals]) =>
  vals.map((v, i) => ({
    __timestamp: month(i),
    product_line,
    'SUM(sales)': v,
  })),
);

const base = {
  rows,
  metricKey: 'SUM(sales)',
  metricName: 'Revenue',
  timeKey: '__timestamp',
  dims: [{ key: 'product_line', name: 'product line' }],
  periodNoun: 'month',
  formatValue: fmt,
  formatPeriod: fmtP,
  maxInsights: 10,
};

const text = (n: ReturnType<typeof buildNarrative>) => [
  partsToText(n.headline),
  ...n.insights.map(i => partsToText(i.parts)),
];

test('headline compares last period with previous', () => {
  const n = buildNarrative(base);
  expect(partsToText(n.headline)).toBe(
    'Revenue was $352 in Jun 2004, up 67.6% vs May 2004 ($210).',
  );
});

test('finds record, anomaly, driver and offset', () => {
  const all = text(buildNarrative(base)).join('\n');
  // eslint-disable-next-line no-console
  console.log(all);
  expect(all).toContain('Jun 2004 is the highest month');
  expect(all).toContain('unusually high');
  expect(all).toContain(
    'Classic Cars accounts for the whole increase and more by product line (+$160 vs a total change of +$142).',
  );
  expect(all).toContain(
    'Ships moved the other way (−$20), partly offsetting the increase.',
  );
  expect(all).toContain('Classic Cars is the largest product line in Jun 2004');
});

test('lower is better flips tones', () => {
  const n = buildNarrative({ ...base, lowerIsBetter: true });
  const up = n.headline.find(
    p => typeof p !== 'string' && p.text.startsWith('up'),
  );
  expect(typeof up !== 'string' && up?.tone).toBe('bad');
});

test('driver share under 100%', () => {
  const r = [
    { t: month(0), p: 'A', m: 10 },
    { t: month(0), p: 'B', m: 10 },
    { t: month(1), p: 'A', m: 16 },
    { t: month(1), p: 'B', m: 14 },
  ];
  const all = text(
    buildNarrative({
      ...base,
      rows: r,
      metricKey: 'm',
      timeKey: 't',
      dims: [{ key: 'p', name: 'product' }],
    }),
  ).join('\n');
  expect(all).toContain(
    'A drove most of the increase by product (+$6, 60.0% of the change).',
  );
});

test('ranks and limits insights', () => {
  const n = buildNarrative({ ...base, maxInsights: 3 });
  expect(n.insights).toHaveLength(3);
  expect(n.insights[0].score).toBeGreaterThanOrEqual(n.insights[2].score);
});

test('streaks', () => {
  const r = [1, 2, 3, 4, 5].map((v, i) => ({ t: month(i), m: v }));
  const all = text(
    buildNarrative({
      ...base,
      rows: r,
      metricKey: 'm',
      timeKey: 't',
      dims: [],
    }),
  ).join('\n');
  expect(all).toContain(
    'Revenue has risen 4 months in a row, the 4th consecutive increase.',
  );
  expect(all).toContain('trending up');
});

test('no time column: composition only', () => {
  const r = [
    { country: 'USA', m: 60 },
    { country: 'France', m: 30 },
    { country: 'Kenya', m: 10 },
  ];
  const n = buildNarrative({
    ...base,
    rows: r,
    metricKey: 'm',
    timeKey: undefined,
    dims: [{ key: 'country', name: 'country' }],
  });
  expect(partsToText(n.headline)).toBe(
    'Revenue totals $100 across 3 country values.',
  );
  expect(text(n).join('\n')).toContain(
    'USA is the largest country at $60 (60.0% of the total)',
  );
  expect(text(n).join('\n')).toContain(
    'Kenya is the smallest country at $10; USA is 6.0× larger.',
  );
});

test('empty data', () => {
  expect(partsToText(buildNarrative({ ...base, rows: [] }).headline)).toBe(
    'No data for the current filters.',
  );
});

test('helpers', () => {
  expect(slope([1, 2, 3])).toBeCloseTo(1);
  expect(ordinal(1)).toBe('1st');
  expect(ordinal(2)).toBe('2nd');
  expect(ordinal(3)).toBe('3rd');
  expect(ordinal(11)).toBe('11th');
  expect(ordinal(22)).toBe('22nd');
});
