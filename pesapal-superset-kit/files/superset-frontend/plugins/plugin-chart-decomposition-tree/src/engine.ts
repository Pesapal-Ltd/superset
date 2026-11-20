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
/** Decomposition tree engine: splits a metric level by level. */

export type Rec = Record<string, unknown>;
export type SplitMode = 'manual' | 'high' | 'low';

export interface Level {
  /** field to split by (manual), or null for an AI split */
  dim: string | null;
  mode: SplitMode;
  /** label of the selected bar, which the next level splits */
  selected: string | null;
}

export interface Item {
  label: string;
  value: number;
}

export interface Column {
  dim: string;
  mode: SplitMode;
  items: Item[];
  selected: string | null;
  parentValue: number;
}

export const BLANK = '(blank)';
export const label = (v: unknown) =>
  v === null || v === undefined || v === '' ? BLANK : String(v);

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const total = (rows: Rec[], metric: string) =>
  rows.reduce((a, r) => a + num(r[metric]), 0);

export function split(rows: Rec[], dim: string, metric: string): Item[] {
  const sums = new Map<string, number>();
  rows.forEach(r => {
    const k = label(r[dim]);
    sums.set(k, (sums.get(k) || 0) + num(r[metric]));
  });
  return [...sums.entries()]
    .map(([l, value]) => ({ label: l, value }))
    .sort((a, b) => b.value - a.value);
}

export const filterPath = (
  rows: Rec[],
  path: { dim: string; label: string }[],
) => rows.filter(r => path.every(p => label(r[p.dim]) === p.label));

/**
 * AI split: the field whose single biggest (high) or smallest (low) value is
 * the most extreme, i.e. where to look next to find the largest / smallest
 * contributor.
 */
export function aiPick(
  rows: Rec[],
  candidates: string[],
  metric: string,
  mode: 'high' | 'low',
): string | null {
  let best: string | null = null;
  let bestVal = mode === 'high' ? -Infinity : Infinity;
  candidates.forEach(dim => {
    const items = split(rows, dim, metric);
    if (items.length < 2) return; // a single value explains nothing
    const v = mode === 'high' ? items[0].value : items[items.length - 1].value;
    if (mode === 'high' ? v > bestVal : v < bestVal) {
      best = dim;
      bestVal = v;
    }
  });
  return best;
}

export function resolve(
  rows: Rec[],
  metric: string,
  dims: string[],
  levels: Level[],
): { rootValue: number; columns: Column[] } {
  const rootValue = total(rows, metric);
  const columns: Column[] = [];
  const path: { dim: string; label: string }[] = [];
  const used = new Set<string>();
  let parentValue = rootValue;

  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i];
    const subset = filterPath(rows, path);
    const free = dims.filter(d => !used.has(d));
    const dim =
      level.mode === 'manual'
        ? level.dim
        : aiPick(subset, free, metric, level.mode);
    if (!dim || used.has(dim) || !dims.includes(dim)) break;
    const items = split(subset, dim, metric);
    if (!items.length) break;
    let selected =
      level.selected && items.some(it => it.label === level.selected)
        ? level.selected
        : null;
    if (!selected && level.mode !== 'manual') {
      // AI splits highlight the most extreme bar
      selected =
        level.mode === 'high' ? items[0].label : items[items.length - 1].label;
    }
    columns.push({ dim, mode: level.mode, items, selected, parentValue });
    used.add(dim);
    if (!selected) break;
    path.push({ dim, label: selected });
    parentValue = items.find(it => it.label === selected)!.value;
  }
  return { rootValue, columns };
}

/** Fields still available below the last shown column. */
export const unusedDims = (dims: string[], columns: Column[]) =>
  dims.filter(d => !columns.some(c => c.dim === d));
