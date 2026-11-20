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
 * Narrative engine: turns query rows into ranked plain-English insights.
 * Pure functions, no React / Superset dependencies, so it is easy to test.
 */

export type Row = Record<string, unknown>;
export type Tone = 'good' | 'bad' | 'neutral';
export type Part = string | { text: string; tone?: Tone; strong?: boolean };

export type InsightKind =
  | 'trend'
  | 'record'
  | 'anomaly'
  | 'average'
  | 'driver'
  | 'offset'
  | 'share'
  | 'new'
  | 'spread'
  | 'total';

export interface Insight {
  kind: InsightKind;
  /** higher = more interesting; used to pick the top N */
  score: number;
  parts: Part[];
}

export interface Narrative {
  headline: Part[];
  insights: Insight[];
}

export interface NarrativeInput {
  rows: Row[];
  metricKey: string;
  metricName: string;
  /** key of the (time-grained) x-axis column, if any */
  timeKey?: string;
  /** dimension column keys, with display names */
  dims: { key: string; name: string }[];
  lag?: number;
  lowerIsBetter?: boolean;
  maxInsights?: number;
  /** noun for one time bucket: "month", "quarter", ... */
  periodNoun?: string;
  formatValue: (n: number) => string;
  formatPeriod: (t: number) => string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pctText = (v: number) => `${(Math.abs(v) * 100).toFixed(1)}%`;

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

function toneFor(delta: number, lowerIsBetter: boolean): Tone {
  if (delta === 0) return 'neutral';
  return delta > 0 !== lowerIsBetter ? 'good' : 'bad';
}

function sumBy(rows: Row[], key: string, metricKey: string) {
  const out = new Map<string, number>();
  rows.forEach(r => {
    const v = num(r[metricKey]);
    if (v === null) return;
    const k = String(r[key] ?? 'Unknown');
    out.set(k, (out.get(k) || 0) + v);
  });
  return out;
}

const sortDesc = (m: Map<string, number>) =>
  [...m.entries()].sort((a, b) => b[1] - a[1]);

/** Least-squares slope of y over its index. */
export function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let numer = 0;
  let denom = 0;
  ys.forEach((y, i) => {
    numer += (i - mx) * (y - my);
    denom += (i - mx) ** 2;
  });
  return denom ? numer / denom : 0;
}

function shareInsights(
  rows: Row[],
  input: NarrativeInput,
  scopeLabel: string,
): Insight[] {
  const { dims, metricKey, formatValue } = input;
  const out: Insight[] = [];
  dims.forEach(dim => {
    const totals = sortDesc(sumBy(rows, dim.key, metricKey));
    if (totals.length < 2) return;
    const grand = totals.reduce((a, [, v]) => a + v, 0);
    if (!grand) return;
    const [topName, topVal] = totals[0];
    const share = topVal / grand;
    const top3 = totals.slice(0, 3).reduce((a, [, v]) => a + v, 0) / grand;
    const parts: Part[] = [
      { text: topName, strong: true },
      ` is the largest ${dim.name}${scopeLabel} at `,
      { text: formatValue(topVal), strong: true },
      ' (',
      { text: pctText(share), strong: true },
      ' of the total)',
    ];
    if (totals.length > 3) {
      parts.push('; the top 3 make up ', { text: pctText(top3), strong: true });
    }
    parts.push('.');
    out.push({ kind: 'share', score: 40 + share * 40, parts });

    const [lowName, lowVal] = totals[totals.length - 1];
    if (lowVal > 0 && topVal / lowVal >= 3) {
      out.push({
        kind: 'spread',
        score: 25,
        parts: [
          { text: lowName, strong: true },
          ` is the smallest ${dim.name} at ${formatValue(lowVal)}; ${topName} is `,
          { text: `${(topVal / lowVal).toFixed(1)}×`, strong: true },
          ' larger.',
        ],
      });
    }
  });
  return out;
}

export function buildNarrative(input: NarrativeInput): Narrative {
  const {
    rows,
    metricKey,
    metricName,
    timeKey,
    dims,
    lag = 1,
    lowerIsBetter = false,
    maxInsights = 6,
    periodNoun = 'period',
    formatValue,
    formatPeriod,
  } = input;
  const insights: Insight[] = [];
  const valid = rows.filter(r => num(r[metricKey]) !== null);

  if (!valid.length) {
    return { headline: ['No data for the current filters.'], insights: [] };
  }

  // ---------------- no time column: composition only ----------------
  if (!timeKey) {
    const total = valid.reduce((a, r) => a + (num(r[metricKey]) as number), 0);
    insights.push(...shareInsights(valid, input, ''));
    return {
      headline: [
        `${metricName} totals `,
        { text: formatValue(total), strong: true },
        dims.length
          ? ` across ${sumBy(valid, dims[0].key, metricKey).size} ${dims[0].name} values.`
          : '.',
      ],
      insights: insights
        .sort((a, b) => b.score - a.score)
        .slice(0, maxInsights),
    };
  }

  // ---------------- time series ----------------
  const byTime = new Map<number, Row[]>();
  valid.forEach(r => {
    const t = num(r[timeKey]) ?? Date.parse(String(r[timeKey]));
    if (!Number.isFinite(t)) return;
    if (!byTime.has(t)) byTime.set(t, []);
    byTime.get(t)!.push(r);
  });
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const series = times.map(t =>
    byTime.get(t)!.reduce((a, r) => a + (num(r[metricKey]) as number), 0),
  );
  const n = times.length;
  const last = series[n - 1];
  const lastT = times[n - 1];
  const prevIdx = n - 1 - Math.max(1, Math.floor(lag) || 1);
  const hasPrev = prevIdx >= 0;
  const prev = hasPrev ? series[prevIdx] : 0;
  const delta = last - prev;
  const change = hasPrev && prev !== 0 ? delta / Math.abs(prev) : null;
  const total = series.reduce((a, b) => a + b, 0);

  // headline
  let headline: Part[];
  if (hasPrev) {
    const tone = toneFor(delta, lowerIsBetter);
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    headline = [
      `${metricName} was `,
      { text: formatValue(last), strong: true },
      ` in ${formatPeriod(lastT)}, `,
      dir === 'flat'
        ? { text: 'unchanged', strong: true, tone }
        : {
            text: `${dir} ${change === null ? formatValue(Math.abs(delta)) : pctText(change)}`,
            strong: true,
            tone,
          },
      ` vs ${formatPeriod(times[prevIdx])} (${formatValue(prev)}).`,
    ];
  } else {
    headline = [
      `${metricName} was `,
      { text: formatValue(last), strong: true },
      ` in ${formatPeriod(lastT)}.`,
    ];
  }

  // total over range
  if (n > 1) {
    insights.push({
      kind: 'total',
      score: 20,
      parts: [
        `Across ${n} ${periodNoun}s (${formatPeriod(times[0])} – ${formatPeriod(lastT)}), ${metricName} totals `,
        { text: formatValue(total), strong: true },
        '.',
      ],
    });
  }

  // trend + streak
  if (n >= 4) {
    const mean = total / n;
    const rel = mean ? slope(series) / Math.abs(mean) : 0;
    if (Math.abs(rel) >= 0.02) {
      insights.push({
        kind: 'trend',
        score: 50 + Math.min(30, Math.abs(rel) * 300),
        parts: [
          `Overall ${metricName} is `,
          {
            text: rel > 0 ? 'trending up' : 'trending down',
            strong: true,
            tone: toneFor(rel, lowerIsBetter),
          },
          `, by about ${pctText(rel)} of the average per ${periodNoun}.`,
        ],
      });
    }
    let streak = 0;
    const up = series[n - 1] > series[n - 2];
    for (let i = n - 1; i > 0; i -= 1) {
      if (series[i] > series[i - 1] === up && series[i] !== series[i - 1]) {
        streak += 1;
      } else break;
    }
    if (streak >= 3) {
      insights.push({
        kind: 'trend',
        score: 60 + streak * 3,
        parts: [
          `${metricName} has `,
          {
            text: `${up ? 'risen' : 'fallen'} ${streak} ${periodNoun}s in a row`,
            strong: true,
            tone: toneFor(up ? 1 : -1, lowerIsBetter),
          },
          `, the ${ordinal(streak)} consecutive ${up ? 'increase' : 'decrease'}.`,
        ],
      });
    }
  }

  // records
  if (n >= 3) {
    const maxV = Math.max(...series);
    const minV = Math.min(...series);
    if (last === maxV) {
      insights.push({
        kind: 'record',
        score: 85,
        parts: [
          `${formatPeriod(lastT)} is the `,
          {
            text: `highest ${periodNoun}`,
            strong: true,
            tone: toneFor(1, lowerIsBetter),
          },
          ` in the selected range.`,
        ],
      });
    } else if (last === minV) {
      insights.push({
        kind: 'record',
        score: 85,
        parts: [
          `${formatPeriod(lastT)} is the `,
          {
            text: `lowest ${periodNoun}`,
            strong: true,
            tone: toneFor(-1, lowerIsBetter),
          },
          ` in the selected range.`,
        ],
      });
    } else {
      const peakI = series.indexOf(maxV);
      insights.push({
        kind: 'record',
        score: 30,
        parts: [
          `The peak was `,
          { text: formatValue(maxV), strong: true },
          ` in ${formatPeriod(times[peakI])}; ${formatPeriod(lastT)} is `,
          { text: pctText((maxV - last) / (maxV || 1)), strong: true },
          ' below it.',
        ],
      });
    }
  }

  // vs average + anomaly
  if (n >= 4) {
    const history = series.slice(0, n - 1);
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const sd = Math.sqrt(
      history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length,
    );
    const z = sd ? (last - mean) / sd : 0;
    if (Math.abs(z) >= 2) {
      insights.push({
        kind: 'anomaly',
        score: 90 + Math.min(10, Math.abs(z)),
        parts: [
          `${formatPeriod(lastT)} is `,
          {
            text: `unusually ${z > 0 ? 'high' : 'low'}`,
            strong: true,
            tone: toneFor(z, lowerIsBetter),
          },
          `: ${Math.abs(z).toFixed(1)} standard deviations from the typical ${periodNoun}.`,
        ],
      });
    } else if (mean) {
      const vsAvg = (last - mean) / Math.abs(mean);
      if (Math.abs(vsAvg) >= 0.05) {
        insights.push({
          kind: 'average',
          score: 35 + Math.min(20, Math.abs(vsAvg) * 40),
          parts: [
            `That is `,
            {
              text: `${pctText(vsAvg)} ${vsAvg > 0 ? 'above' : 'below'}`,
              strong: true,
              tone: toneFor(vsAvg, lowerIsBetter),
            },
            ` the average of the previous ${history.length} ${periodNoun}s (${formatValue(mean)}).`,
          ],
        });
      }
    }
  }

  // drivers of the change, per dimension
  if (hasPrev && delta !== 0) {
    const lastRows = byTime.get(lastT)!;
    const prevRows = byTime.get(times[prevIdx])!;
    dims.forEach(dim => {
      const cur = sumBy(lastRows, dim.key, metricKey);
      const before = sumBy(prevRows, dim.key, metricKey);
      const keys = new Set([...cur.keys(), ...before.keys()]);
      const deltas = [...keys]
        .map(k => ({ k, d: (cur.get(k) || 0) - (before.get(k) || 0) }))
        .sort((a, b) => b.d - a.d);
      if (deltas.length < 2) return;
      const same = delta > 0 ? deltas[0] : deltas[deltas.length - 1];
      const opp = delta > 0 ? deltas[deltas.length - 1] : deltas[0];
      if (same.d && Math.sign(same.d) === Math.sign(delta)) {
        const share = same.d / delta;
        const word = delta > 0 ? 'increase' : 'decrease';
        const amount: Part = {
          text: `${same.d > 0 ? '+' : '−'}${formatValue(Math.abs(same.d))}`,
          strong: true,
          tone: toneFor(same.d, lowerIsBetter),
        };
        insights.push({
          kind: 'driver',
          score: 70 + Math.min(25, share * 25),
          parts:
            share >= 1
              ? [
                  { text: same.k, strong: true },
                  ` accounts for the whole ${word} and more by ${dim.name} (`,
                  amount,
                  ` vs a total change of ${delta > 0 ? '+' : '−'}${formatValue(Math.abs(delta))}).`,
                ]
              : [
                  { text: same.k, strong: true },
                  ` drove ${share >= 0.5 ? 'most' : 'the largest part'} of the ${word} by ${dim.name} (`,
                  amount,
                  `, ${pctText(share)} of the change).`,
                ],
        });
      }
      if (opp.d && Math.sign(opp.d) !== Math.sign(delta)) {
        insights.push({
          kind: 'offset',
          score: 45 + Math.min(20, Math.abs(opp.d / delta) * 20),
          parts: [
            { text: opp.k, strong: true },
            ` moved the other way (`,
            {
              text: `${opp.d > 0 ? '+' : '−'}${formatValue(Math.abs(opp.d))}`,
              strong: true,
              tone: toneFor(opp.d, lowerIsBetter),
            },
            `), partly offsetting the ${delta > 0 ? 'increase' : 'decrease'}.`,
          ],
        });
      }
      const fresh = [...cur.keys()].filter(k => !before.has(k));
      if (fresh.length) {
        insights.push({
          kind: 'new',
          score: 40,
          parts: [
            { text: `${fresh.length} new ${dim.name}`, strong: true },
            ` value${fresh.length > 1 ? 's' : ''} appeared in ${formatPeriod(lastT)}: ${fresh.slice(0, 3).join(', ')}${fresh.length > 3 ? '…' : ''}.`,
          ],
        });
      }
    });
  }

  // composition in the latest period
  insights.push(
    ...shareInsights(byTime.get(lastT)!, input, ` in ${formatPeriod(lastT)}`),
  );

  return {
    headline,
    insights: insights.sort((a, b) => b.score - a.score).slice(0, maxInsights),
  };
}

/** Plain-text version (for copy to clipboard / tests). */
export const partsToText = (parts: Part[]) =>
  parts.map(p => (typeof p === 'string' ? p : p.text)).join('');
