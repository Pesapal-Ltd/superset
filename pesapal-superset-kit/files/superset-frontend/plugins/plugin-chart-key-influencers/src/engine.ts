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
/**
 * Key influencers engine.
 *
 * Numeric target (e.g. sales): for every value of every factor, compare the
 * average target when factor = value with the average for all other rows
 * (Welch's t-test). Text target (e.g. status = Cancelled): compare how often
 * the outcome happens (two-proportion z-test). Number factors are cut into
 * quartile ranges first. Only significant, big-enough groups are reported.
 */

export type Rec = Record<string, unknown>;
export type Direction = 'increase' | 'decrease';

export interface TargetSpec {
  column: string;
  kind: 'numeric' | 'category';
  /** outcome value for text targets */
  value?: string;
  direction: Direction;
}

export interface Influencer {
  factor: string;
  value: string;
  n: number;
  share: number;
  /** average (numeric) or rate (category) in the group */
  group: number;
  /** average or rate for all other rows */
  rest: number;
  /** numeric: group - rest; category: group / rest */
  effect: number;
  /** |t| or |z| */
  score: number;
}

export interface Segment {
  conditions: { factor: string; value: string }[];
  n: number;
  share: number;
  stat: number;
  score: number;
}

export interface FactorDetail {
  values: { value: string; n: number; stat: number }[];
}

export interface Analysis {
  n: number;
  overall: number;
  target: TargetSpec;
  influencers: Influencer[];
  details: Record<string, FactorDetail>;
  segments: Segment[];
}

export const BLANK = '(blank)';
export const label = (v: unknown) =>
  v === null || v === undefined || v === '' ? BLANK : String(v);

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean')
    return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(v / 1e3).toFixed(1)}k`;
  return `${+v.toFixed(2)}`;
};

/** Is this column mostly numbers with enough distinct values to bin? */
export function isNumericColumn(
  rows: Rec[],
  col: string,
  minDistinct = 0,
): boolean {
  let numeric = 0;
  let present = 0;
  const distinct = new Set<number>();
  rows.forEach(r => {
    const v = r[col];
    if (v === null || v === undefined || v === '') return;
    present += 1;
    const n = num(v);
    if (n !== null) {
      numeric += 1;
      if (distinct.size <= minDistinct) distinct.add(n);
    }
  });
  return present > 0 && numeric / present >= 0.9 && distinct.size > minDistinct;
}

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Labels per row for a factor; numeric factors become quartile ranges. */
export function factorLabels(rows: Rec[], col: string): string[] {
  if (!isNumericColumn(rows, col, 8)) return rows.map(r => label(r[col]));
  const vals = rows
    .map(r => num(r[col]))
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const cuts = [
    ...new Set([
      quantile(vals, 0.25),
      quantile(vals, 0.5),
      quantile(vals, 0.75),
    ]),
  ];
  const edges = [vals[0], ...cuts, vals[vals.length - 1]];
  const names = edges
    .slice(0, -1)
    .map((lo, i) => `${compact(lo)} – ${compact(edges[i + 1])}`);
  return rows.map(r => {
    const v = num(r[col]);
    if (v === null) return BLANK;
    let i = cuts.findIndex(c => v <= c);
    if (i === -1) i = cuts.length;
    return names[i];
  });
}

interface Acc {
  n: number;
  sum: number;
  sq: number;
}
const acc = (): Acc => ({ n: 0, sum: 0, sq: 0 });
/* eslint-disable no-param-reassign */
const add = (a: Acc, y: number) => {
  a.n += 1;
  a.sum += y;
  a.sq += y * y;
};
/* eslint-enable no-param-reassign */
const mean = (a: Acc) => (a.n ? a.sum / a.n : 0);
const variance = (a: Acc) =>
  a.n > 1 ? Math.max(0, (a.sq - (a.sum * a.sum) / a.n) / (a.n - 1)) : 0;
const minus = (t: Acc, g: Acc): Acc => ({
  n: t.n - g.n,
  sum: t.sum - g.sum,
  sq: t.sq - g.sq,
});

/** Standard normal CDF (Abramowitz & Stegun 7.1.26). */
export function normCdf(z: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * |z| needed for 95% confidence when `tests` comparisons are made
 * (Bonferroni correction), so chance results are not reported.
 */
export function criticalZ(tests: number, alpha = 0.05): number {
  const p = 1 - alpha / (2 * Math.max(1, tests));
  let lo = 0;
  let hi = 10;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (normCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Test statistic for group vs rest (Welch t or two-proportion z). */
function testStat(kind: TargetSpec['kind'], g: Acc, r: Acc): number {
  if (kind === 'numeric') {
    const se = Math.sqrt(variance(g) / g.n + variance(r) / r.n);
    const d = mean(g) - mean(r);
    return se ? d / se : d === 0 ? 0 : Infinity * Math.sign(d);
  }
  const p1 = mean(g);
  const p2 = mean(r);
  const p = (g.sum + r.sum) / (g.n + r.n);
  const se = Math.sqrt(p * (1 - p) * (1 / g.n + 1 / r.n));
  return se ? (p1 - p2) / se : 0;
}

/** Work out what kind of target this is and which outcome to study. */
export function detectTarget(
  rows: Rec[],
  column: string,
  direction: Direction,
  value?: string,
): TargetSpec {
  if (value) return { column, kind: 'category', value, direction };
  if (isNumericColumn(rows, column))
    return { column, kind: 'numeric', direction };
  // text target with no outcome chosen: use the least common outcome that is not tiny
  const counts = new Map<string, number>();
  rows.forEach(r =>
    counts.set(label(r[column]), (counts.get(label(r[column])) || 0) + 1),
  );
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    column,
    kind: 'category',
    value: sorted[1]?.[0] ?? sorted[0]?.[0],
    direction,
  };
}

export function analyze(
  rows: Rec[],
  target: TargetSpec,
  factors: string[],
  {
    minGroup = 30,
    maxInfluencers = 10,
    maxSegments = 5,
    alpha = 0.05,
  }: {
    minGroup?: number;
    maxInfluencers?: number;
    maxSegments?: number;
    alpha?: number;
  } = {},
): Analysis {
  const ys: (number | null)[] = rows.map(r =>
    target.kind === 'numeric'
      ? num(r[target.column])
      : label(r[target.column]) === target.value
        ? 1
        : 0,
  );
  const keep = ys.map(y => y !== null);
  const data = rows.filter((_, i) => keep[i]);
  const y = ys.filter((v): v is number => v !== null);
  const total = acc();
  y.forEach(v => add(total, v));
  const overall = mean(total);
  const up = target.direction === 'increase';
  const usable = factors.filter(f => f !== target.column);
  const labelsBy: Record<string, string[]> = {};
  usable.forEach(f => {
    labelsBy[f] = factorLabels(data, f);
  });

  const influencers: Influencer[] = [];
  const details: Record<string, FactorDetail> = {};
  const candidates: { f: string; value: string; g: Acc; r: Acc }[] = [];
  usable.forEach(f => {
    const groups = new Map<string, Acc>();
    labelsBy[f].forEach((l, i) => {
      if (!groups.has(l)) groups.set(l, acc());
      add(groups.get(l)!, y[i]);
    });
    details[f] = {
      values: [...groups.entries()]
        .map(([value, g]) => ({ value, n: g.n, stat: mean(g) }))
        .sort((a, b) => b.stat - a.stat),
    };
    groups.forEach((g, value) => {
      const r = minus(total, g);
      if (g.n >= minGroup && r.n >= minGroup)
        candidates.push({ f, value, g, r });
    });
  });
  const threshold = criticalZ(candidates.length, alpha);
  candidates.forEach(({ f, value, g, r }) => {
    const stat = testStat(target.kind, g, r);
    if (!(up ? stat >= threshold : stat <= -threshold)) return;
    const gm = mean(g);
    const rm = mean(r);
    influencers.push({
      factor: f,
      value,
      n: g.n,
      share: g.n / total.n,
      group: gm,
      rest: rm,
      effect: target.kind === 'numeric' ? gm - rm : rm ? gm / rm : Infinity,
      score: Math.abs(stat),
    });
  });

  influencers.sort((a, b) => {
    if (target.kind === 'numeric')
      return Math.abs(b.effect) - Math.abs(a.effect);
    // likelihood: biggest ratio first (or smallest for "decrease")
    return up ? b.effect - a.effect : a.effect - b.effect;
  });

  // ---- top segments: pairs of conditions that stand out most
  const segments: Segment[] = [];
  const segCandidates: { k: string; fa: string; fb: string; g: Acc; r: Acc }[] =
    [];
  const segMin = Math.max(minGroup, Math.ceil(total.n * 0.01));
  for (let a = 0; a < usable.length; a += 1) {
    for (let b = a + 1; b < usable.length; b += 1) {
      const fa = usable[a];
      const fb = usable[b];
      const groups = new Map<string, Acc>();
      labelsBy[fa].forEach((la, i) => {
        const k = `${la}\u0001${labelsBy[fb][i]}`;
        if (!groups.has(k)) groups.set(k, acc());
        add(groups.get(k)!, y[i]);
      });
      groups.forEach((g, k) => {
        const r = minus(total, g);
        if (g.n >= segMin && r.n >= minGroup)
          segCandidates.push({ k, fa, fb, g, r });
      });
    }
  }
  const segThreshold = criticalZ(segCandidates.length, alpha);
  segCandidates.forEach(({ k, fa, fb, g, r }) => {
    const stat = testStat(target.kind, g, r);
    if (!(up ? stat >= segThreshold : stat <= -segThreshold)) return;
    const [va, vb] = k.split('\u0001');
    segments.push({
      conditions: [
        { factor: fa, value: va },
        { factor: fb, value: vb },
      ],
      n: g.n,
      share: g.n / total.n,
      stat: mean(g),
      score: Math.abs(stat),
    });
  });
  segments.sort((p, q) => (up ? q.stat - p.stat : p.stat - q.stat));

  return {
    n: total.n,
    overall,
    target,
    influencers: influencers.slice(0, maxInfluencers),
    details,
    segments: segments.slice(0, maxSegments),
  };
}
