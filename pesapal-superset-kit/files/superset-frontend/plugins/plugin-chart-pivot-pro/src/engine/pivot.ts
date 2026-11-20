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
 * Pivot engine: aggregates flat records into a row tree x column tree with
 * subtotals and totals, plus sorting, searching, value filters, top N and
 * "show values as" transforms. Pure TypeScript, no React.
 */

export type Agg = 'sum' | 'avg' | 'min' | 'max' | 'count';
export type Rec = Record<string, unknown>;

export interface MetricDef {
  key: string;
  label: string;
}

export interface TreeNode {
  /** unique key of the path */
  key: string;
  label: string;
  /** raw value used for natural sorting */
  raw: unknown;
  path: string[];
  depth: number;
  children: TreeNode[];
  childMap: Map<string, TreeNode>;
}

const SEP = '\u0001';
export const pathKey = (path: string[]) => path.map(p => SEP + p).join('');

export const BLANK = '(blank)';

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean')
    return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

class Acc {
  sum = 0;

  count = 0;

  min = Infinity;

  max = -Infinity;

  add(v: number) {
    this.sum += v;
    this.count += 1;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
  }

  value(agg: Agg): number | null {
    if (!this.count) return null;
    switch (agg) {
      case 'avg':
        return this.sum / this.count;
      case 'min':
        return this.min;
      case 'max':
        return this.max;
      case 'count':
        return this.count;
      default:
        return this.sum;
    }
  }
}

const newNode = (path: string[], label: string, raw: unknown): TreeNode => ({
  key: pathKey(path),
  label,
  raw,
  path,
  depth: path.length - 1,
  children: [],
  childMap: new Map(),
});

// ---------------------------------------------------------------- sorting

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function compareRaw(a: unknown, b: unknown): number {
  const na = num(a);
  const nb = num(b);
  if (na !== null && nb !== null) return na - nb;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return collator.compare(String(a), String(b));
}

export type Comparator = (a: TreeNode, b: TreeNode) => number;

export const labelComparator =
  (dir: 'asc' | 'desc'): Comparator =>
  (a, b) =>
    (dir === 'asc' ? 1 : -1) * compareRaw(a.raw, b.raw);

export const valueComparator =
  (
    model: PivotModel,
    colPath: string[],
    metricIdx: number,
    dir: 'asc' | 'desc',
  ): Comparator =>
  (a, b) => {
    const va = model.get(a.path, colPath, metricIdx);
    const vb = model.get(b.path, colPath, metricIdx);
    if (va === null && vb === null) return 0;
    if (va === null) return 1; // nulls last
    if (vb === null) return -1;
    return dir === 'asc' ? va - vb : vb - va;
  };

export function sortTree(node: TreeNode, cmp: Comparator) {
  node.children.sort(cmp);
  node.children.forEach(c => sortTree(c, cmp));
}

export interface PivotInput {
  records: Rec[];
  rowDims: string[];
  colDims: string[];
  metrics: MetricDef[];
  agg?: Agg;
  /** label for a dimension value (e.g. formatted date) */
  labelOf?: (dim: string, value: unknown) => string;
  /** dim -> labels to exclude */
  exclude?: Record<string, string[]>;
}

export interface PivotModel {
  rowRoot: TreeNode;
  colRoot: TreeNode;
  rowDims: string[];
  colDims: string[];
  metrics: MetricDef[];
  get: (
    rowPath: string[],
    colPath: string[],
    metricIdx: number,
  ) => number | null;
}

export const defaultLabel = (_dim: string, v: unknown) =>
  v === null || v === undefined || v === '' ? BLANK : String(v);

function insert(root: TreeNode, labels: string[], raws: unknown[]) {
  let node = root;
  labels.forEach((label, i) => {
    let child = node.childMap.get(label);
    if (!child) {
      child = newNode(labels.slice(0, i + 1), label, raws[i]);
      node.childMap.set(label, child);
      node.children.push(child);
    }
    node = child;
  });
}

export function buildPivot(input: PivotInput): PivotModel {
  const {
    records,
    rowDims,
    colDims,
    metrics,
    agg = 'sum',
    labelOf = defaultLabel,
    exclude = {},
  } = input;
  const excluded = new Map(
    Object.entries(exclude).map(([d, vals]) => [d, new Set(vals)]),
  );
  const rowRoot = newNode([], 'Total', null);
  const colRoot = newNode([], 'Total', null);
  const cells = new Map<string, Map<string, Acc[]>>();

  const accFor = (rk: string, ck: string) => {
    let row = cells.get(rk);
    if (!row) {
      row = new Map();
      cells.set(rk, row);
    }
    let accs = row.get(ck);
    if (!accs) {
      accs = metrics.map(() => new Acc());
      row.set(ck, accs);
    }
    return accs;
  };

  records.forEach(rec => {
    const rowLabels = rowDims.map(d => labelOf(d, rec[d]));
    const colLabels = colDims.map(d => labelOf(d, rec[d]));
    for (let i = 0; i < rowDims.length; i += 1) {
      if (excluded.get(rowDims[i])?.has(rowLabels[i])) return;
    }
    for (let i = 0; i < colDims.length; i += 1) {
      if (excluded.get(colDims[i])?.has(colLabels[i])) return;
    }
    insert(
      rowRoot,
      rowLabels,
      rowDims.map(d => rec[d]),
    );
    insert(
      colRoot,
      colLabels,
      colDims.map(d => rec[d]),
    );
    const values = metrics.map(m => num(rec[m.key]));
    for (let i = 0; i <= rowLabels.length; i += 1) {
      const rk = pathKey(rowLabels.slice(0, i));
      for (let j = 0; j <= colLabels.length; j += 1) {
        const accs = accFor(rk, pathKey(colLabels.slice(0, j)));
        values.forEach((v, m) => {
          if (v !== null) accs[m].add(v);
        });
      }
    }
  });

  const get = (rowPath: string[], colPath: string[], metricIdx: number) =>
    cells
      .get(pathKey(rowPath))
      ?.get(pathKey(colPath))
      ?.[metricIdx]?.value(agg) ?? null;

  const model = { rowRoot, colRoot, rowDims, colDims, metrics, get };
  sortTree(rowRoot, labelComparator('asc'));
  sortTree(colRoot, labelComparator('asc'));
  return model;
}

// ---------------------------------------------------------------- filtering

/** Keep nodes whose label (or an ancestor's / descendant's) matches. */
export function searchTree(root: TreeNode, query: string): TreeNode {
  const q = query.trim().toLowerCase();
  if (!q) return root;
  const walk = (node: TreeNode, ancestorHit: boolean): TreeNode | null => {
    const hit = ancestorHit || node.label.toLowerCase().includes(q);
    const kids = node.children
      .map(c => walk(c, hit))
      .filter((c): c is TreeNode => c !== null);
    if (hit || kids.length) return { ...node, children: kids };
    return null;
  };
  const kids = root.children
    .map(c => walk(c, false))
    .filter((c): c is TreeNode => c !== null);
  return { ...root, children: kids };
}

/** Keep the top (or bottom) N first-level rows by their row total. */
export function topN(
  model: PivotModel,
  root: TreeNode,
  n: number,
  metricIdx = 0,
  bottom = false,
): TreeNode {
  if (!n || root.children.length <= n) return root;
  const ranked = [...root.children].sort(
    valueComparator(model, [], metricIdx, bottom ? 'asc' : 'desc'),
  );
  const keep = new Set(ranked.slice(0, n).map(c => c.key));
  return { ...root, children: root.children.filter(c => keep.has(c.key)) };
}

/** Distinct labels per dimension (for the filter menus), with counts. */
export function distinctValues(
  records: Rec[],
  dims: string[],
  labelOf = defaultLabel,
): Record<string, { label: string; raw: unknown; count: number }[]> {
  const out: Record<
    string,
    Map<string, { label: string; raw: unknown; count: number }>
  > = {};
  dims.forEach(d => {
    out[d] = new Map();
  });
  records.forEach(r =>
    dims.forEach(d => {
      const label = labelOf(d, r[d]);
      const e = out[d].get(label);
      if (e) e.count += 1;
      else out[d].set(label, { label, raw: r[d], count: 1 });
    }),
  );
  return Object.fromEntries(
    Object.entries(out).map(([d, m]) => [
      d,
      [...m.values()].sort((a, b) => compareRaw(a.raw, b.raw)),
    ]),
  );
}

// ---------------------------------------------------------------- layout

export interface VisibleRow {
  node: TreeNode;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

export function flattenRows(
  root: TreeNode,
  isExpanded: (node: TreeNode) => boolean,
): VisibleRow[] {
  const out: VisibleRow[] = [];
  const walk = (node: TreeNode) => {
    node.children.forEach(c => {
      const hasChildren = c.children.length > 0;
      const expanded = hasChildren && isExpanded(c);
      out.push({ node: c, depth: c.depth, hasChildren, expanded });
      if (expanded) walk(c);
    });
  };
  walk(root);
  return out;
}

export type ColKind = 'leaf' | 'subtotal' | 'grand';

export interface DisplayCol {
  path: string[];
  kind: ColKind;
  metricIdx: number;
}

export function buildColumns(
  colRoot: TreeNode,
  colDepth: number,
  metricCount: number,
  subtotals: boolean,
  totals: boolean,
): DisplayCol[] {
  const groups: { path: string[]; kind: ColKind }[] = [];
  if (colDepth === 0) {
    groups.push({ path: [], kind: 'grand' });
  } else {
    const walk = (node: TreeNode) => {
      node.children.forEach(c => {
        if (c.depth === colDepth - 1)
          groups.push({ path: c.path, kind: 'leaf' });
        else {
          walk(c);
          if (subtotals) groups.push({ path: c.path, kind: 'subtotal' });
        }
      });
    };
    walk(colRoot);
    if (totals) groups.push({ path: [], kind: 'grand' });
  }
  const out: DisplayCol[] = [];
  groups.forEach(g => {
    for (let m = 0; m < metricCount; m += 1) out.push({ ...g, metricIdx: m });
  });
  return out;
}

export interface HeaderCell {
  label: string;
  colSpan: number;
  rowSpan: number;
  /** index of the first display column it covers */
  start: number;
  kind: ColKind | 'metric';
}

const samePrefix = (a: string[], b: string[], n: number) => {
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return false;
  return a.length >= n && b.length >= n;
};

export function buildHeader(
  cols: DisplayCol[],
  colDepth: number,
  metricLabels: string[],
  showMetricRow: boolean,
): HeaderCell[][] {
  const rows: HeaderCell[][] = [];
  for (let level = 0; level < colDepth; level += 1) {
    const cells: HeaderCell[] = [];
    let i = 0;
    while (i < cols.length) {
      const col = cols[i];
      let j = i + 1;
      if (col.path.length < level) {
        while (
          j < cols.length &&
          cols[j].kind === col.kind &&
          pathKey(cols[j].path) === pathKey(col.path)
        )
          j += 1;
      } else if (col.path.length === level) {
        while (
          j < cols.length &&
          cols[j].kind === col.kind &&
          pathKey(cols[j].path) === pathKey(col.path)
        )
          j += 1;
        cells.push({
          label: level === 0 ? 'Grand total' : `${col.path[level - 1]} total`,
          colSpan: j - i,
          rowSpan: colDepth - level,
          start: i,
          kind: col.kind,
        });
      } else {
        while (
          j < cols.length &&
          cols[j].path.length > level &&
          samePrefix(cols[j].path, col.path, level + 1)
        )
          j += 1;
        cells.push({
          label: col.path[level],
          colSpan: j - i,
          rowSpan: 1,
          start: i,
          kind: 'leaf',
        });
      }
      i = j;
    }
    rows.push(cells);
  }
  if (showMetricRow) {
    rows.push(
      cols.map((c, i) => ({
        label: metricLabels[c.metricIdx],
        colSpan: 1,
        rowSpan: 1,
        start: i,
        kind: 'metric' as const,
      })),
    );
  }
  return rows;
}

// ---------------------------------------------------------------- show values as

export type ShowAs =
  | 'value'
  | 'pct_grand'
  | 'pct_row'
  | 'pct_col'
  | 'pct_parent'
  | 'diff_prev'
  | 'pct_diff_prev'
  | 'running'
  | 'rank';

export const SHOW_AS_LABELS: Record<ShowAs, string> = {
  value: 'Actual values',
  pct_grand: '% of grand total',
  pct_row: '% of row total',
  pct_col: '% of column total',
  pct_parent: '% of parent row',
  diff_prev: 'Difference from previous column',
  pct_diff_prev: '% difference from previous column',
  running: 'Running total across columns',
  rank: 'Rank within parent (largest = 1)',
};

/** How a transformed value should be formatted. */
export const showAsKind = (s: ShowAs): 'value' | 'pct' | 'rank' | 'diff' =>
  s === 'rank'
    ? 'rank'
    : s === 'diff_prev'
      ? 'diff'
      : s.startsWith('pct')
        ? 'pct'
        : 'value';

const div = (a: number | null, b: number | null) =>
  a === null || b === null || b === 0 ? null : a / b;

/**
 * Value of one cell after the "show values as" transform.
 * `siblings` are the visible nodes sharing the row's parent (for rank).
 */
export function cellValue(
  model: PivotModel,
  row: TreeNode,
  cols: DisplayCol[],
  colIdx: number,
  showAs: ShowAs,
  siblings: TreeNode[] = [],
): number | null {
  const col = cols[colIdx];
  const m = col.metricIdx;
  const raw = model.get(row.path, col.path, m);
  switch (showAs) {
    case 'pct_grand':
      return div(raw, model.get([], [], m));
    case 'pct_row':
      return div(raw, model.get(row.path, [], m));
    case 'pct_col':
      return div(raw, model.get([], col.path, m));
    case 'pct_parent':
      return div(raw, model.get(row.path.slice(0, -1), col.path, m));
    case 'diff_prev':
    case 'pct_diff_prev':
    case 'running': {
      if (col.kind !== 'leaf') return showAs === 'running' ? raw : null;
      const leafIdx = cols
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.kind === 'leaf' && c.metricIdx === m);
      const pos = leafIdx.findIndex(({ i }) => i === colIdx);
      if (showAs === 'running') {
        let total: number | null = null;
        for (let k = 0; k <= pos; k += 1) {
          const v = model.get(row.path, leafIdx[k].c.path, m);
          if (v !== null) total = (total ?? 0) + v;
        }
        return total;
      }
      if (pos <= 0) return null;
      const prev = model.get(row.path, leafIdx[pos - 1].c.path, m);
      if (raw === null || prev === null) return null;
      return showAs === 'diff_prev'
        ? raw - prev
        : div(raw - prev, Math.abs(prev));
    }
    case 'rank': {
      if (raw === null) return null;
      const better = siblings.filter(s => {
        const v = model.get(s.path, col.path, m);
        return v !== null && v > raw;
      }).length;
      return better + 1;
    }
    default:
      return raw;
  }
}
