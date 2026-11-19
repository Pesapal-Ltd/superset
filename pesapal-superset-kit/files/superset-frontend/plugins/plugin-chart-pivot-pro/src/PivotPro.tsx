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
import { useEffect, useMemo, useRef, useState } from 'react';
import { getNumberFormatter, styled, useTheme } from '@superset-ui/core';
import {
  buildColumns,
  buildHeader,
  buildPivot,
  cellValue,
  DisplayCol,
  distinctValues,
  flattenRows,
  labelComparator,
  pathKey,
  searchTree,
  SHOW_AS_LABELS,
  ShowAs,
  showAsKind,
  sortTree,
  topN,
  TreeNode,
  valueComparator,
} from './engine/pivot';
import { barWidth, heat, icon, stats, Stats, textOn } from './engine/format';
import {
  addRule,
  CellFormat,
  cellHighlight,
  loadPersonal,
  MetricStyle,
  metricToggle,
  Op,
  OP_LABELS,
  OPS,
  removeFormat,
  ruleColor,
  Scope,
  savePersonal,
  setCellHighlight,
  setMetricToggle,
  SWATCHES,
} from './engine/clickFormats';
import ViewerFilterBar from './ViewerFilterBar';
import { FACTORY_VIEW, PivotProProps, PivotView, SortSpec } from './types';

const pctFmt = getNumberFormatter('.1%');

const Wrapper = styled.div<{ w: number; h: number }>`
  ${({ theme, w, h }) => `
  width: ${w}px;
  height: ${h}px;
  display: flex;
  flex-direction: column;
  position: relative;
  font-family: ${theme.typography.families.sansSerif};
  font-size: ${theme.typography.sizes.s}px;
  color: ${theme.colors.grayscale.dark1};
  .pp-toolbar {
    display: flex; flex-wrap: wrap; gap: ${theme.gridUnit * 1.5}px; align-items: center;
    padding: 0 0 ${theme.gridUnit * 2}px;
  }
  .pp-toolbar input[type='search'] {
    width: 160px; padding: 3px 8px; border: 1px solid ${theme.colors.grayscale.light2};
    border-radius: ${theme.gridUnit}px; font: inherit;
  }
  .pp-toolbar select { max-width: 210px; }
  .pp-toolbar select, .pp-btn {
    font: inherit; padding: 3px 8px; border: 1px solid ${theme.colors.grayscale.light2};
    border-radius: ${theme.gridUnit}px; background: ${theme.colors.grayscale.light5};
    color: ${theme.colors.grayscale.dark1}; cursor: pointer;
  }
  .pp-btn:hover { background: ${theme.colors.grayscale.light4}; }
  .pp-btn.on { border-color: ${theme.colors.primary.base}; color: ${theme.colors.primary.dark1}; }
  .pp-badge {
    display: inline-block; min-width: 16px; padding: 0 4px; margin-left: 4px; border-radius: 8px;
    background: ${theme.colors.primary.base}; color: ${theme.colors.grayscale.light5}; font-size: 10px; text-align: center;
  }
  .pp-scroll { flex: 1; overflow: auto; min-height: 0; border: 1px solid ${theme.colors.grayscale.light2}; border-radius: ${theme.gridUnit}px; }
  table { border-collapse: separate; border-spacing: 0; min-width: 100%; }
  th, td {
    padding: 4px 10px; white-space: nowrap; border-bottom: 1px solid ${theme.colors.grayscale.light3};
    border-right: 1px solid ${theme.colors.grayscale.light3};
  }
  thead { position: sticky; top: 0; z-index: 3; }
  thead th {
    background: ${theme.colors.grayscale.light4}; font-weight: ${theme.typography.weights.bold};
    text-align: center; border-bottom: 1px solid ${theme.colors.grayscale.light2};
  }
  thead th.sortable { cursor: pointer; user-select: none; }
  thead th.sortable:hover { background: ${theme.colors.grayscale.light3}; }
  thead th.total { background: ${theme.colors.grayscale.light3}; }
  th.rowhead, td.rowlabel {
    position: sticky; left: 0; z-index: 2; text-align: left;
    background: ${theme.colors.grayscale.light5};
  }
  thead th.rowhead { z-index: 4; background: ${theme.colors.grayscale.light4}; vertical-align: bottom; }
  td { text-align: right; font-variant-numeric: tabular-nums; position: relative; }
  td.parent, td.rowlabel.parent { font-weight: ${theme.typography.weights.bold}; }
  td.totalcol { background: ${theme.colors.grayscale.light4}; font-weight: ${theme.typography.weights.bold}; }
  tr.grand td { font-weight: ${theme.typography.weights.bold}; background: ${theme.colors.grayscale.light3}; border-top: 2px solid ${theme.colors.grayscale.light1}; }
  tbody tr:hover td { filter: brightness(0.97); }
  .pp-toggle {
    border: 0; background: none; cursor: pointer; padding: 0 4px 0 0; font: inherit;
    color: ${theme.colors.grayscale.base}; width: 16px;
  }
  .pp-null { color: ${theme.colors.grayscale.light1}; }
  .pp-icon { margin-right: 6px; font-size: 0.9em; }
  .pp-bar { position: absolute; left: 2px; top: 3px; bottom: 3px; border-radius: 2px; opacity: 0.35; }
  .pp-val { position: relative; }
  .pp-panel {
    position: absolute; top: 34px; left: 0; z-index: 10; width: 300px; max-height: 70%;
    overflow: auto; background: ${theme.colors.grayscale.light5}; border: 1px solid ${theme.colors.grayscale.light2};
    border-radius: ${theme.gridUnit * 2}px; box-shadow: 0 6px 20px ${theme.colors.grayscale.light1}; padding: 10px 12px;
  }
  .pp-panel h4 { margin: 10px 0 4px; font-size: 12px; display: flex; justify-content: space-between; }
  .pp-panel h4 button { font-size: 11px; border: 0; background: none; color: ${theme.colors.primary.dark1}; cursor: pointer; }
  .pp-panel input[type='search'] { width: 100%; box-sizing: border-box; margin-bottom: 4px; }
  .pp-panel label { display: flex; gap: 6px; align-items: center; padding: 1px 0; cursor: pointer; }
  .pp-panel .count { margin-left: auto; color: ${theme.colors.grayscale.light1}; font-size: 11px; }
  td.clickable { cursor: pointer; }
  td.clickable:hover { outline: 2px solid ${theme.colors.primary.light1}; outline-offset: -2px; }
  .pp-pop {
    position: absolute; z-index: 20; width: 316px; background: ${theme.colors.grayscale.light5};
    border: 1px solid ${theme.colors.grayscale.light2}; border-radius: ${theme.gridUnit * 2}px;
    box-shadow: 0 8px 24px ${theme.colors.grayscale.light1}; padding: 10px 12px; text-align: left;
  }
  .pp-pop-head { display: flex; justify-content: space-between; align-items: center; }
  .pp-pop-sub { color: ${theme.colors.grayscale.base}; font-size: 11px; margin: 2px 0 6px; }
  .pp-pop-sec { font-weight: ${theme.typography.weights.bold}; font-size: 11px; margin: 10px 0 4px; color: ${theme.colors.grayscale.dark1}; }
  .pp-x, .pp-link { border: 0; background: none; cursor: pointer; font: inherit; color: ${theme.colors.primary.dark1}; }
  .pp-sw { display: flex; flex-wrap: wrap; gap: 4px; }
  .pp-sw button {
    width: 20px; height: 20px; border-radius: 4px; border: 1px solid ${theme.colors.grayscale.light2};
    cursor: pointer; padding: 0; font-size: 12px; line-height: 18px; background: ${theme.colors.grayscale.light5};
  }
  .pp-sw button.sel { outline: 2px solid ${theme.colors.grayscale.dark1}; outline-offset: 1px; }
  .pp-ops, .pp-toggles { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
  .pp-ops button, .pp-toggles button {
    font: inherit; padding: 2px 8px; border-radius: 4px; cursor: pointer;
    border: 1px solid ${theme.colors.grayscale.light2}; background: ${theme.colors.grayscale.light5};
  }
  .pp-ops button.on, .pp-toggles button.on {
    border-color: ${theme.colors.primary.base}; background: ${theme.colors.primary.light4}; color: ${theme.colors.primary.dark1};
  }
  .pp-rules div { display: flex; align-items: center; gap: 6px; font-size: 11px; margin: 2px 0; }
  .pp-rules .chip { width: 12px; height: 12px; border-radius: 3px; flex: none; }
  .pp-pop-foot {
    margin-top: 10px; padding-top: 6px; border-top: 1px solid ${theme.colors.grayscale.light3};
    font-size: 11px; color: ${theme.colors.grayscale.base}; display: flex; justify-content: space-between; gap: 8px;
  }
  .pp-builder {
    font-size: 11px; color: ${theme.colors.primary.dark2}; background: ${theme.colors.primary.light4};
    border-radius: ${theme.gridUnit}px; padding: 4px 8px; margin-bottom: ${theme.gridUnit * 1.5}px;
  }
  .pp-empty { padding: 16px; color: ${theme.colors.grayscale.base}; }
  `}
`;

function FilterSection({
  dim,
  label,
  values,
  excluded,
  onChange,
}: {
  dim: string;
  label: string;
  values: { label: string; count: number }[];
  excluded: string[];
  onChange: (dim: string, excluded: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const shown = values.filter(v =>
    v.label.toLowerCase().includes(q.toLowerCase()),
  );
  const ex = new Set(excluded);
  return (
    <div>
      <h4>
        {label}
        <span>
          <button type="button" onClick={() => onChange(dim, [])}>
            All
          </button>
          <button
            type="button"
            onClick={() =>
              onChange(
                dim,
                values.map(v => v.label),
              )
            }
          >
            None
          </button>
        </span>
      </h4>
      {values.length > 8 && (
        <input
          type="search"
          placeholder="Search values"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      )}
      {shown.slice(0, 300).map(v => (
        // eslint-disable-next-line jsx-a11y/label-has-associated-control
        <label key={v.label}>
          <input
            type="checkbox"
            checked={!ex.has(v.label)}
            onChange={e => {
              const next = new Set(ex);
              if (e.target.checked) next.delete(v.label);
              else next.add(v.label);
              onChange(dim, [...next]);
            }}
          />
          {v.label}
          <span className="count">{v.count}</span>
        </label>
      ))}
      {shown.length > 300 && (
        <div className="count">
          +{shown.length - 300} more, refine the search
        </div>
      )}
    </div>
  );
}

export default function PivotPro(props: PivotProProps) {
  const {
    width,
    height,
    records,
    dimLabels,
    metrics,
    agg,
    labelOf,
    formatValue,
    rowTotals,
    colTotals,
    colSubtotals,
    view: savedView,
    saveView,
    showToolbar,
    allowViewerFormatting,
    locked,
    lockOnDashboard,
    filterFields = [],
    filterSelection = {},
    applyFilters = () => {},
    heatmapMetrics,
    palette,
    databarMetrics,
    databarColor,
    iconMetrics,
    iconSet,
    lowerIsBetter,
    ruleFormatters,
    savedFormats,
    persistToChart,
    storageKey,
  } = props;

  const theme = useTheme();
  // The view (sort, top N, show-as, swap, expand, hidden values) starts from
  // what is saved in the chart. In the chart editor every change is written
  // back, so the dashboard opens exactly as built.
  const savedKey = JSON.stringify(savedView);
  const [view, setView] = useState<PivotView>(savedView);
  useEffect(() => setView(JSON.parse(savedKey)), [savedKey]);
  const inBuilder = !!saveView || !!persistToChart;
  /** viewers may change the view (only when the chart is not locked) */
  const interactive = inBuilder || !locked;
  const update = (patch: Partial<PivotView>) => {
    setView(v => ({ ...v, ...patch }));
    saveView?.(patch);
  };
  const { sort, top, showAs, transposed, exclude, expanded, expandDepth } =
    view;
  const [search, setSearch] = useState('');
  const [panel, setPanel] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // ----- click-to-format -----
  const [chartFormats, setChartFormats] = useState<CellFormat[]>(savedFormats);
  useEffect(() => setChartFormats(savedFormats), [savedFormats]);
  const [personal, setPersonal] = useState<CellFormat[]>(() =>
    persistToChart ? [] : loadPersonal(storageKey),
  );
  useEffect(() => {
    if (!persistToChart) setPersonal(loadPersonal(storageKey));
  }, [storageKey, persistToChart]);
  const formats =
    persistToChart || locked ? chartFormats : [...chartFormats, ...personal];
  const editable = persistToChart ? chartFormats : personal;
  const updateFormats = (next: CellFormat[]) => {
    if (persistToChart) {
      setChartFormats(next);
      persistToChart(next);
    } else {
      setPersonal(next);
      savePersonal(storageKey, next);
    }
  };
  const [pop, setPop] = useState<null | {
    x: number;
    y: number;
    rowPath: string[];
    colPath: string[];
    metricIdx: number;
    v: number | null;
    scope: Scope;
  }>(null);
  const [popOp, setPopOp] = useState<Op>('>');
  useEffect(() => {
    if (!pop) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPop(null);
    const onDown = () => setPop(null);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pop]);

  const rowDims = transposed ? props.colDims : props.rowDims;
  const colDims = transposed ? props.rowDims : props.colDims;
  const allDims = [...props.rowDims, ...props.colDims];
  /** click-formats are stored in the un-swapped orientation */
  const canon = (rowPath: string[], colPath: string[]) =>
    transposed ? [colPath, rowPath] : [rowPath, colPath];
  const metricLabels = metrics.map(m => m.label);

  const distinct = useMemo(
    () => distinctValues(records, allDims, labelOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, allDims.join('|'), labelOf],
  );

  const { model, cols, root } = useMemo(() => {
    const m = buildPivot({
      records,
      rowDims,
      colDims,
      metrics,
      agg,
      labelOf,
      exclude,
    });
    const c = buildColumns(
      m.colRoot,
      colDims.length,
      metrics.length,
      colSubtotals,
      colTotals,
    );
    const sortMetricIdx =
      sort?.by === 'value'
        ? Math.max(
            0,
            metrics.findIndex(mm => mm.key === sort.metric),
          )
        : 0;
    if (sort?.by === 'label') sortTree(m.rowRoot, labelComparator(sort.dir));
    else if (sort?.by === 'value')
      sortTree(
        m.rowRoot,
        valueComparator(m, sort.path, sortMetricIdx, sort.dir),
      );
    let r: TreeNode = searchTree(m.rowRoot, search);
    if (top) r = topN(m, r, Math.abs(top), sortMetricIdx, top < 0);
    return { model: m, cols: c, root: r };
  }, [
    records,
    rowDims,
    colDims,
    metrics,
    agg,
    labelOf,
    exclude,
    colSubtotals,
    colTotals,
    sort,
    search,
    top,
  ]);

  const isExpanded = (n: TreeNode) => {
    if (search) return true;
    if (n.key in expanded) return expanded[n.key];
    return expandDepth < 0 || n.depth < expandDepth;
  };
  const rows = flattenRows(root, isExpanded);

  // siblings (for rank) keyed by node key
  const siblings = useMemo(() => {
    const map = new Map<string, TreeNode[]>();
    const walk = (n: TreeNode) => {
      n.children.forEach(c => {
        map.set(c.key, n.children);
        walk(c);
      });
    };
    walk(root);
    return map;
  }, [root]);

  const showMetricRow = metrics.length > 1 || colDims.length === 0;
  const header = buildHeader(cols, colDims.length, metricLabels, showMetricRow);

  const values = rows.map(r =>
    cols.map((_, ci) =>
      cellValue(model, r.node, cols, ci, showAs, siblings.get(r.node.key)),
    ),
  );
  const grandValues = cols.map((_, ci) =>
    cellValue(model, model.rowRoot, cols, ci, showAs, [model.rowRoot]),
  );

  // scale statistics per metric, over leaf rows x leaf columns
  const metricStats: (Stats | null)[] = metrics.map((_, mi) =>
    stats(
      rows.flatMap((r, ri) =>
        r.hasChildren
          ? []
          : cols.map((c, ci) =>
              c.metricIdx === mi && (c.kind === 'leaf' || colDims.length === 0)
                ? values[ri][ci]
                : null,
            ),
      ),
    ),
  );

  const kind = showAsKind(showAs);
  const fmt = (mi: number, v: number | null) => {
    if (v === null) return '–';
    if (kind === 'pct') return pctFmt(v);
    if (kind === 'rank') return `#${v}`;
    if (kind === 'diff')
      return `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatValue(mi, Math.abs(v))}`;
    return formatValue(mi, v);
  };

  const decorate = (
    col: DisplayCol,
    v: number | null,
    isLeafRow: boolean,
    rawV: number | null,
    rowPath: string[],
  ) => {
    const label = metricLabels[col.metricIdx];
    const s = metricStats[col.metricIdx];
    const style: React.CSSProperties = {};
    let bar: number | null = null;
    let ic: { char: string; color: string } | null = null;
    const leafCell = isLeafRow && (col.kind === 'leaf' || colDims.length === 0);
    const paint = (bg: string) => {
      style.background = bg;
      style.color = textOn(bg);
    };
    if (v !== null && s && leafCell) {
      if (metricToggle(formats, label, 'heat', heatmapMetrics.includes(label)))
        Object.assign(style, heat(v, s, palette));
      if (metricToggle(formats, label, 'bar', databarMetrics.includes(label)))
        bar = barWidth(v, s);
      if (metricToggle(formats, label, 'icon', iconMetrics.includes(label)))
        ic = icon(v, s, iconSet, lowerIsBetter);
    }
    if (rawV !== null && showAs === 'value' && leafCell) {
      ruleFormatters
        .filter(f => f.column === label)
        .forEach(f => {
          const c = f.getColorFromValue(rawV);
          if (c) style.background = c;
        });
    }
    if (v !== null && rowPath.length) {
      const rc = ruleColor(
        formats,
        label,
        showAs,
        v,
        leafCell ? 'detail' : 'total',
      );
      if (rc) paint(rc);
    }
    const [cr, cc] = canon(rowPath, col.path);
    const hl = cellHighlight(formats, cr, cc, label);
    if (hl) paint(hl);
    return { style, bar, ic };
  };

  const isSortedOn = (c: 'label' | DisplayCol) => {
    if (!sort) return false;
    if (c === 'label') return sort.by === 'label';
    return (
      sort.by === 'value' &&
      sort.metric === metrics[c.metricIdx]?.key &&
      pathKey(sort.path) === pathKey(c.path)
    );
  };
  const clickSort = (c: 'label' | DisplayCol) => {
    const first = c === 'label' ? 'asc' : 'desc';
    const second = first === 'asc' ? 'desc' : 'asc';
    let next: SortSpec;
    if (!isSortedOn(c)) {
      next =
        c === 'label'
          ? { by: 'label', dir: first }
          : {
              by: 'value',
              path: c.path,
              metric: metrics[c.metricIdx].key,
              dir: first,
            };
    } else if (sort && sort.dir === first) {
      next = { ...sort, dir: second };
    } else {
      next = null;
    }
    update({ sort: next });
  };
  const sortMark = (c: 'label' | DisplayCol) =>
    isSortedOn(c) && sort ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const activeFilters = Object.values(exclude).filter(v => v.length).length;

  const exportCsv = () => {
    const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const lines: string[] = [];
    header.forEach((hrow, hi) => {
      const line = new Array(cols.length).fill('');
      hrow.forEach(h => {
        line[h.start] = h.label;
      });
      lines.push(
        [
          hi === header.length - 1
            ? rowDims.map(d => dimLabels[d] || d).join(' / ')
            : '',
          ...line,
        ]
          .map(q)
          .join(','),
      );
    });
    rows.forEach((r, ri) =>
      lines.push(
        [
          q(r.node.path.join(' > ')),
          ...values[ri].map(v => (v === null ? '' : String(v))),
        ].join(','),
      ),
    );
    if (rowTotals)
      lines.push(
        [
          q('Grand total'),
          ...grandValues.map(v => (v === null ? '' : String(v))),
        ].join(','),
      );
    const blob = new Blob([String.fromCharCode(0xfeff), lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pivot.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const reset = () => {
    setSearch('');
    // in the chart editor Reset clears the saved view; on a dashboard it
    // returns to the view the chart was saved with
    if (inBuilder) update(FACTORY_VIEW);
    else setView(JSON.parse(savedKey));
  };

  const canFormat = inBuilder || (!locked && allowViewerFormatting);

  const renderCell = (
    col: DisplayCol,
    ci: number,
    v: number | null,
    isLeafRow: boolean,
    rowPath: string[],
    extraClass = '',
  ) => {
    const rawV = model.get(rowPath, col.path, col.metricIdx);
    const { style, bar, ic } = decorate(col, v, isLeafRow, rawV, rowPath);
    const cls = [
      col.kind !== 'leaf' && colDims.length ? 'totalcol' : '',
      extraClass,
      v === null ? 'pp-null' : '',
      canFormat ? 'clickable' : '',
    ].join(' ');
    return (
      <td
        key={ci}
        className={cls}
        style={style}
        title={canFormat ? 'Click to format' : undefined}
        onClick={e => {
          if (!canFormat) return;
          const rect = wrapRef.current?.getBoundingClientRect();
          setPop({
            x: e.clientX - (rect?.left ?? 0),
            y: e.clientY - (rect?.top ?? 0),
            rowPath,
            colPath: col.path,
            metricIdx: col.metricIdx,
            v,
            scope:
              isLeafRow && (col.kind === 'leaf' || colDims.length === 0)
                ? 'detail'
                : 'total',
          });
          setPopOp('>');
        }}
      >
        {bar !== null && v !== null && (
          <span
            className="pp-bar"
            style={{
              width: `calc(${bar * 100}% - 4px)`,
              background: v < 0 ? theme.colors.error.base : databarColor,
            }}
          />
        )}
        <span className="pp-val">
          {ic && (
            <span className="pp-icon" style={{ color: ic.color }}>
              {ic.char}
            </span>
          )}
          {fmt(col.metricIdx, v)}
        </span>
      </td>
    );
  };

  return (
    <Wrapper w={width} h={height} ref={wrapRef}>
      <ViewerFilterBar
        fields={filterFields}
        selection={filterSelection}
        onApply={applyFilters}
      />
      {inBuilder && (
        <div className="pp-builder">
          Building: the sort, Top N, “show values as”, expanded groups, swap,
          value filters and cell colours you set here are saved with the chart
          {lockOnDashboard
            ? '. On dashboards it is shown locked, exactly like this'
            : showToolbar
              ? ''
              : ' (the toolbar is hidden on dashboards)'}
          . Click Save to keep them.
        </div>
      )}
      {(inBuilder || (!locked && showToolbar)) && (
        <div className="pp-toolbar">
          <input
            type="search"
            placeholder="Search rows…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button
            type="button"
            className={`pp-btn ${panel ? 'on' : ''}`}
            onClick={() => setPanel(p => !p)}
          >
            Filters
            {activeFilters > 0 && (
              <span className="pp-badge">{activeFilters}</span>
            )}
          </button>
          <select
            value={showAs}
            onChange={e => update({ showAs: e.target.value as ShowAs })}
            title="Show values as"
          >
            {Object.entries(SHOW_AS_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <select
            value={top}
            onChange={e => update({ top: Number(e.target.value) })}
            title="Top / bottom N"
          >
            <option value={0}>All rows</option>
            {[5, 10, 20, 50].map(n => (
              <option key={n} value={n}>
                Top {n}
              </option>
            ))}
            {[5, 10].map(n => (
              <option key={-n} value={-n}>
                Bottom {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="pp-btn"
            onClick={() => update({ expandDepth: -1, expanded: {} })}
          >
            Expand all
          </button>
          <button
            type="button"
            className="pp-btn"
            onClick={() => update({ expandDepth: 0, expanded: {} })}
          >
            Collapse all
          </button>
          <button
            type="button"
            className="pp-btn"
            title="Swap rows and columns"
            onClick={() =>
              update({ transposed: !transposed, sort: null, expanded: {} })
            }
          >
            ⇄ Swap
          </button>
          <button type="button" className="pp-btn" onClick={exportCsv}>
            Export CSV
          </button>
          <button type="button" className="pp-btn" onClick={reset}>
            Reset
          </button>
        </div>
      )}
      {panel && (
        <div className="pp-panel" ref={panelRef}>
          <h4>
            Filter values
            <button type="button" onClick={() => setPanel(false)}>
              Close ✕
            </button>
          </h4>
          {allDims.map(d => (
            <FilterSection
              key={d}
              dim={d}
              label={dimLabels[d] || d}
              values={distinct[d] || []}
              excluded={exclude[d] || []}
              onChange={(dim, ex) =>
                update({ exclude: { ...exclude, [dim]: ex } })
              }
            />
          ))}
        </div>
      )}
      {pop &&
        (() => {
          const label = metricLabels[pop.metricIdx];
          const [cr, cc] = canon(pop.rowPath, pop.colPath);
          const current = cellHighlight(formats, cr, cc, label);
          const rules = editable.filter(
            f =>
              f.type === 'rule' &&
              f.metric === label &&
              f.showAs === showAs &&
              (f.scope ?? 'detail') === pop.scope,
          ) as Extract<CellFormat, { type: 'rule' }>[];
          const base: Record<MetricStyle, boolean> = {
            heat: heatmapMetrics.includes(label),
            bar: databarMetrics.includes(label),
            icon: iconMetrics.includes(label),
          };
          const names: Record<MetricStyle, string> = {
            heat: 'Colour scale',
            bar: 'Data bars',
            icon: 'Icons',
          };
          const swatches = (
            onPick: (c: string | null) => void,
            selected?: string,
            allowNone = false,
          ) => (
            <div className="pp-sw">
              {allowNone && (
                <button
                  type="button"
                  title="No colour"
                  onClick={() => onPick(null)}
                >
                  ⊘
                </button>
              )}
              {SWATCHES.map(c => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  className={selected === c ? 'sel' : ''}
                  style={{ background: c }}
                  onClick={() => onPick(c)}
                />
              ))}
            </div>
          );
          return (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
            <div
              className="pp-pop"
              role="dialog"
              aria-label="Format cell"
              style={{
                left: Math.max(4, Math.min(pop.x, width - 326)),
                top:
                  pop.y > height - 330 ? Math.max(4, pop.y - 330) : pop.y + 8,
              }}
              onMouseDown={e => e.stopPropagation()}
            >
              <div className="pp-pop-head">
                <b>{label}</b>
                <button
                  type="button"
                  className="pp-x"
                  onClick={() => setPop(null)}
                >
                  ✕
                </button>
              </div>
              <div className="pp-pop-sub">
                {pop.rowPath.join(' › ') || 'Grand total'} ·{' '}
                {pop.colPath.join(' › ') || 'Total'} ={' '}
                <b>{fmt(pop.metricIdx, pop.v)}</b>
              </div>
              <div className="pp-pop-sec">Highlight this cell</div>
              {swatches(
                c =>
                  updateFormats(setCellHighlight(editable, cr, cc, label, c)),
                current,
                true,
              )}
              {pop.v !== null && (
                <>
                  <div className="pp-pop-sec">
                    Colour every {label}{' '}
                    {pop.scope === 'detail' ? 'cell' : 'total'} that is
                  </div>
                  <div className="pp-ops">
                    {OPS.map(op => (
                      <button
                        key={op}
                        type="button"
                        title={OP_LABELS[op]}
                        className={op === popOp ? 'on' : ''}
                        onClick={() => setPopOp(op)}
                      >
                        {op}
                      </button>
                    ))}
                    <span>{fmt(pop.metricIdx, pop.v)}</span>
                  </div>
                  {swatches(
                    c =>
                      c &&
                      updateFormats(
                        addRule(
                          editable,
                          label,
                          popOp,
                          pop.v as number,
                          showAs,
                          c,
                          pop.scope,
                        ),
                      ),
                  )}
                </>
              )}
              {rules.length > 0 && (
                <div className="pp-rules">
                  {rules.map(r => (
                    <div key={r.id}>
                      <span className="chip" style={{ background: r.bg }} />
                      {OP_LABELS[r.op]} {fmt(pop.metricIdx, r.value)}
                      <button
                        type="button"
                        className="pp-link"
                        title="Remove rule"
                        onClick={() =>
                          updateFormats(removeFormat(editable, r.id))
                        }
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="pp-pop-sec">Whole {label}</div>
              <div className="pp-toggles">
                {(['heat', 'bar', 'icon'] as MetricStyle[]).map(st => {
                  const on = metricToggle(formats, label, st, base[st]);
                  return (
                    <button
                      key={st}
                      type="button"
                      className={on ? 'on' : ''}
                      onClick={() =>
                        updateFormats(setMetricToggle(editable, label, st, !on))
                      }
                    >
                      {names[st]}
                      {on ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
              <div className="pp-pop-foot">
                <span>
                  {persistToChart
                    ? 'Saved in the chart. Click Save to keep it.'
                    : 'Saved for you in this browser.'}
                </span>
                {editable.length > 0 && (
                  <button
                    type="button"
                    className="pp-link"
                    onClick={() => updateFormats([])}
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      <div className="pp-scroll">
        {!rows.length && !rowDims.length && !records.length ? (
          <div className="pp-empty">No data for the current filters.</div>
        ) : (
          <table>
            <thead>
              {header.map((hrow, hi) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={hi}>
                  {hi === 0 && (
                    <th
                      className={`rowhead ${interactive ? 'sortable' : ''}`}
                      rowSpan={Math.max(1, header.length)}
                      onClick={
                        interactive ? () => clickSort('label') : undefined
                      }
                      title={interactive ? 'Sort by label' : undefined}
                    >
                      {rowDims.map(d => dimLabels[d] || d).join(' / ') || ' '}
                      {sortMark('label')}
                    </th>
                  )}
                  {hrow.map(h => {
                    const single =
                      h.colSpan === 1 && hi + h.rowSpan === header.length;
                    const canSort = single && interactive;
                    return (
                      <th
                        key={h.start}
                        colSpan={h.colSpan}
                        rowSpan={h.rowSpan}
                        className={`${canSort ? 'sortable' : ''} ${h.kind === 'subtotal' || h.kind === 'grand' ? 'total' : ''}`}
                        onClick={
                          canSort ? () => clickSort(cols[h.start]) : undefined
                        }
                        title={canSort ? 'Sort rows by this column' : undefined}
                      >
                        {h.label}
                        {single && sortMark(cols[h.start])}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={r.node.key}>
                  <td
                    className={`rowlabel ${r.hasChildren ? 'parent' : ''}`}
                    style={{ paddingLeft: 10 + r.depth * 18 }}
                    title={r.node.path.join(' › ')}
                  >
                    {r.hasChildren && !interactive && (
                      <span className="pp-toggle">
                        {r.expanded ? '▾' : '▸'}
                      </span>
                    )}
                    {r.hasChildren && interactive && (
                      <button
                        type="button"
                        className="pp-toggle"
                        aria-label={r.expanded ? 'Collapse' : 'Expand'}
                        onClick={() =>
                          update({
                            expanded: {
                              ...expanded,
                              [r.node.key]: !r.expanded,
                            },
                          })
                        }
                      >
                        {r.expanded ? '▾' : '▸'}
                      </button>
                    )}
                    {!r.hasChildren && rowDims.length > 1 && (
                      <span className="pp-toggle" />
                    )}
                    {r.node.label}
                  </td>
                  {cols.map((c, ci) =>
                    renderCell(
                      c,
                      ci,
                      values[ri][ci],
                      !r.hasChildren,
                      r.node.path,
                      r.hasChildren ? 'parent' : '',
                    ),
                  )}
                </tr>
              ))}
              {(rowTotals || rowDims.length === 0) && (
                <tr className="grand">
                  <td className="rowlabel">Grand total</td>
                  {cols.map((c, ci) =>
                    renderCell(c, ci, grandValues[ci], false, []),
                  )}
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </Wrapper>
  );
}
