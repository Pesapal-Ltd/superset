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
  analyze,
  criticalZ,
  detectTarget,
  factorLabels,
  isNumericColumn,
  normCdf,
} from '../src/engine';

// deterministic pseudo-random numbers
let seed = 42;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

// Large deals sell ~2x; Spain cancels a lot more; country/product otherwise noise
const sizes = ['Small', 'Medium', 'Large'];
const countries = ['USA', 'France', 'Spain', 'UK'];
const lines = ['Cars', 'Ships', 'Planes'];
const rows = Array.from({ length: 3000 }, () => {
  const deal = sizes[Math.floor(rnd() * 3)];
  const country = countries[Math.floor(rnd() * 4)];
  const line = lines[Math.floor(rnd() * 3)];
  const qty = Math.round(10 + rnd() * 90);
  const sales =
    (deal === 'Large' ? 6000 : deal === 'Medium' ? 3500 : 2000) +
    rnd() * 800 +
    qty * 5;
  const cancelled = rnd() < (country === 'Spain' ? 0.3 : 0.05);
  return {
    deal,
    country,
    line,
    qty,
    sales,
    status: cancelled ? 'Cancelled' : 'Shipped',
  };
});

test('Bonferroni threshold grows with the number of tests', () => {
  expect(criticalZ(1)).toBeCloseTo(1.96, 1);
  expect(criticalZ(20)).toBeCloseTo(3.02, 1);
  expect(normCdf(0)).toBeCloseTo(0.5);
});

test('number detection and quartile ranges', () => {
  expect(isNumericColumn(rows, 'sales')).toBe(true);
  expect(isNumericColumn(rows, 'country')).toBe(false);
  const bins = new Set(factorLabels(rows, 'qty'));
  expect(bins.size).toBe(4);
  expect([...bins].every(b => b.includes(' – '))).toBe(true);
});

test('numeric target: Large deals increase sales, Small decrease', () => {
  const up = analyze(rows, detectTarget(rows, 'sales', 'increase'), [
    'deal',
    'country',
    'line',
    'qty',
  ]);
  expect(up.target.kind).toBe('numeric');
  expect(up.influencers[0]).toMatchObject({ factor: 'deal', value: 'Large' });
  expect(up.influencers[0].effect).toBeGreaterThan(2500);
  // noise factors are not reported
  expect(
    up.influencers.some(i => i.factor === 'country' || i.factor === 'line'),
  ).toBe(false);
  const down = analyze(rows, detectTarget(rows, 'sales', 'decrease'), [
    'deal',
    'country',
    'line',
  ]);
  expect(down.influencers[0]).toMatchObject({ factor: 'deal', value: 'Small' });
  expect(down.influencers[0].effect).toBeLessThan(0);
});

test('text target: Spain makes Cancelled several times more likely', () => {
  const t = detectTarget(rows, 'status', 'increase', 'Cancelled');
  const a = analyze(rows, t, ['deal', 'country', 'line']);
  expect(a.overall).toBeGreaterThan(0.08);
  expect(a.overall).toBeLessThan(0.15);
  expect(a.influencers[0]).toMatchObject({ factor: 'country', value: 'Spain' });
  expect(a.influencers[0].effect).toBeGreaterThan(3);
  expect(a.influencers).toHaveLength(1);
});

test('text target without a chosen outcome picks the second most common', () => {
  expect(detectTarget(rows, 'status', 'increase').value).toBe('Cancelled');
});

test('top segments combine two conditions', () => {
  const a = analyze(rows, detectTarget(rows, 'sales', 'increase'), [
    'deal',
    'country',
  ]);
  expect(a.segments.length).toBeGreaterThan(0);
  expect(a.segments[0].conditions.map(c => c.factor)).toEqual([
    'deal',
    'country',
  ]);
  expect(a.segments[0].conditions[0].value).toBe('Large');
  expect(a.segments[0].stat).toBeGreaterThan(a.overall);
});

test('small groups are ignored and details list every value', () => {
  const a = analyze(
    rows.slice(0, 40),
    detectTarget(rows, 'sales', 'increase'),
    ['deal'],
    { minGroup: 30 },
  );
  expect(a.influencers).toHaveLength(0);
  expect(a.details.deal.values.map(v => v.value).sort()).toEqual([
    'Large',
    'Medium',
    'Small',
  ]);
});

test('the target column is never its own influencer', () => {
  const a = analyze(rows, detectTarget(rows, 'sales', 'increase'), [
    'sales',
    'deal',
  ]);
  expect(a.influencers.every(i => i.factor !== 'sales')).toBe(true);
});
