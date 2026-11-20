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
  ChartProps,
  ensureIsArray,
  extractTimegrain,
  GenericDataType,
  getColumnLabel,
  getMetricLabel,
  getTimeFormatter,
  getTimeFormatterForGranularity,
  getValueFormatter,
  QueryFormData,
  QueryFormMetric,
  SMART_DATE_ID,
} from '@superset-ui/core';
import { getColorFormatters } from '@superset-ui/chart-controls';
import { BLANK, defaultLabel, Rec } from '../engine/pivot';
import {
  activeSelection,
  FilterSelection,
  parseFilterFields,
} from '../viewerFilters';
import { PivotProFormData, PivotProProps, PivotView, SortSpec } from '../types';

const toHex = (c?: { r: number; g: number; b: number }) =>
  c
    ? `#${[c.r, c.g, c.b].map(x => x.toString(16).padStart(2, '0')).join('')}`
    : '#20A7C9';

// Superset only applies setControlValue in the chart editor (Explore).
const inExplore = () =>
  typeof window !== 'undefined' &&
  /\/explore\b/.test(window.location?.pathname || '');

export default function transformProps(chartProps: ChartProps): PivotProProps {
  const {
    width,
    height,
    queriesData,
    rawFormData,
    datasource,
    hooks,
    ownState,
  } = chartProps;
  const formData = chartProps.formData as PivotProFormData;
  const { data = [], colnames = [], coltypes = [] } = queriesData?.[0] || {};
  const {
    groupbyRows,
    groupbyColumns,
    metrics: rawMetrics,
    aggregateFunction = 'sum',
    rowTotals = true,
    colTotals = true,
    colSubtotals = false,
    expandDepth = '-1',
    defaultShowAs = 'value',
    transposePivot = false,
    showToolbar = true,
    heatmapMetrics = [],
    heatmapPalette = 'red_green',
    databarMetrics = [],
    colorPicker,
    iconMetrics = [],
    iconSet = 'arrows',
    lowerIsBetter = false,
    valueFormat,
    currencyFormat,
    dateFormat,
    conditionalFormatting,
  } = formData as PivotProFormData & Record<string, any>;
  const {
    currencyFormats = {},
    columnFormats = {},
    verboseMap = {},
  } = (datasource || {}) as Partial<{
    currencyFormats: Record<string, any>;
    columnFormats: Record<string, string>;
    verboseMap: Record<string, string>;
  }>;

  const metricList = ensureIsArray(rawMetrics as QueryFormMetric[]);
  const metrics = metricList.map(m => {
    const key = getMetricLabel(m);
    return { key, label: verboseMap[key] || key };
  });
  const formatters = metricList.map(m =>
    getValueFormatter(
      m,
      currencyFormats,
      columnFormats,
      valueFormat,
      currencyFormat,
    ),
  );

  const rowDims = ensureIsArray(groupbyRows).map(getColumnLabel);
  const colDims = ensureIsArray(groupbyColumns).map(getColumnLabel);

  // date columns: format with the chosen date format / time grain
  const granularity = extractTimegrain(rawFormData as QueryFormData);
  const dateFormatters: Record<string, ((v: any) => string) | undefined> = {};
  (colnames as string[]).forEach((name, i) => {
    if (coltypes[i] !== GenericDataType.Temporal) return;
    if (dateFormat && dateFormat !== SMART_DATE_ID)
      dateFormatters[name] = getTimeFormatter(dateFormat);
    else if (granularity)
      dateFormatters[name] = getTimeFormatterForGranularity(granularity);
    else dateFormatters[name] = getTimeFormatter('%Y-%m-%d');
  });
  const labelOf = (dim: string, v: unknown) => {
    if (v === null || v === undefined || v === '') return BLANK;
    const f = dateFormatters[dim];
    return f && typeof v === 'number' ? f(v) : defaultLabel(dim, v);
  };

  const dimLabels = Object.fromEntries(
    [...rowDims, ...colDims].map(d => [d, verboseMap[d] || d]),
  );

  // ----- the saved view -----
  const fd = formData as any;
  const sortMetric = fd.sortMetric || metrics[0]?.key || '';
  const sortRows: string = fd.sortRows || 'none';
  let sort: SortSpec = null;
  if (sortRows === 'label_desc') sort = { by: 'label', dir: 'desc' };
  else if (sortRows === 'total_desc' || sortRows === 'total_asc')
    sort = {
      by: 'value',
      path: [],
      metric: sortMetric,
      dir: sortRows === 'total_desc' ? 'desc' : 'asc',
    };
  else if (sortRows === 'custom') sort = fd.pivotSort ?? null;
  const view: PivotView = {
    sort,
    top: Number(fd.defaultTopN) || 0,
    showAs: defaultShowAs,
    transposed: !!transposePivot,
    expandDepth: Number(expandDepth),
    expanded: fd.expandedGroups || {},
    exclude: fd.hiddenValues || {},
  };

  // In the chart editor, write view changes back into the chart's settings.
  const set =
    inExplore() && hooks?.setControlValue
      ? (name: string, value: unknown) => hooks.setControlValue!(name, value)
      : undefined;
  const saveView = set
    ? (patch: Partial<PivotView>) => {
        if ('sort' in patch) {
          const s = patch.sort ?? null;
          if (!s || (s.by === 'label' && s.dir === 'asc')) {
            set('sort_rows', 'none');
            set('pivot_sort', null);
          } else if (s.by === 'label') set('sort_rows', 'label_desc');
          else if (s.path.length === 0) {
            set('sort_rows', `total_${s.dir}`);
            set('sort_metric', s.metric);
          } else {
            set('sort_rows', 'custom');
            set('pivot_sort', s);
          }
        }
        if ('top' in patch) set('default_top_n', patch.top);
        if ('showAs' in patch) set('defaultShowAs', patch.showAs);
        if ('transposed' in patch) set('transposePivot', patch.transposed);
        if ('expandDepth' in patch)
          set('expandDepth', String(patch.expandDepth));
        if ('expanded' in patch) set('expanded_groups', patch.expanded);
        if ('exclude' in patch) set('hidden_values', patch.exclude);
      }
    : undefined;

  // ----- viewer filters (dropdowns on this chart) -----
  const filterFields = parseFilterFields(
    rawFormData as QueryFormData,
    (queriesData || []) as any,
    1,
    verboseMap,
    labelOf,
  );
  const filterSelection = activeSelection(
    rawFormData as QueryFormData,
    ownState,
  );
  const applyFilters = (next: FilterSelection) => {
    hooks?.setDataMask?.({
      ownState: { ...(ownState || {}), viewerFilters: next },
    });
    if (set) set('viewer_filter_defaults', next);
  };

  return {
    width,
    height,
    records: data as Rec[],
    rowDims,
    colDims,
    dimLabels,
    metrics,
    agg: aggregateFunction,
    labelOf,
    formatValue: (mi, v) => formatters[mi](v),
    rowTotals,
    colTotals,
    colSubtotals,
    view,
    saveView,
    showToolbar,
    allowViewerFormatting: (formData as any).allowViewerFormatting ?? true,
    locked: !set && ((formData as any).lockOnDashboard ?? true),
    lockOnDashboard: (formData as any).lockOnDashboard ?? true,
    heatmapMetrics: ensureIsArray(heatmapMetrics),
    palette: heatmapPalette,
    databarMetrics: ensureIsArray(databarMetrics),
    databarColor: toHex(colorPicker),
    iconMetrics: ensureIsArray(iconMetrics),
    iconSet,
    lowerIsBetter,
    ruleFormatters: getColorFormatters(conditionalFormatting, data),
    savedFormats: ensureIsArray((formData as any).cellFormats),
    persistToChart: set ? formats => set('cell_formats', formats) : undefined,
    filterFields,
    filterSelection,
    applyFilters,
    storageKey: `superset-pivot-pro-formats:${
      (rawFormData as any)?.slice_id ?? 'unsaved'
    }`,
  };
}
