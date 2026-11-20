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
 * Viewer filters: dropdowns on a single chart. Selections are sent to
 * Superset as the chart's own state (ownState), which re-runs only this
 * chart's query with the extra IN filters.
 */
import {
  ensureIsArray,
  getColumnLabel,
  QueryFormColumn,
  QueryFormData,
  QueryObject,
} from '@superset-ui/core';

export type FilterSelection = Record<string, (string | number | boolean)[]>;

export interface FilterOption {
  value: string | number | boolean;
  label: string;
  count?: number;
}

export interface FilterField {
  key: string;
  label: string;
  options: FilterOption[];
}

export const viewerFilterColumns = (formData: QueryFormData) =>
  ensureIsArray<QueryFormColumn>(formData.viewer_filters);

/** Selections in effect: the viewer's (ownState) or the chart's defaults. */
export function activeSelection(
  formData: QueryFormData,
  ownState?: Record<string, any>,
): FilterSelection {
  const fromViewer = ownState?.viewerFilters;
  const sel: FilterSelection =
    fromViewer !== undefined
      ? fromViewer
      : formData.viewer_filter_defaults || {};
  const keys = new Set(viewerFilterColumns(formData).map(getColumnLabel));
  return Object.fromEntries(
    Object.entries(sel || {}).filter(
      ([k, v]) => keys.has(k) && ensureIsArray(v).length,
    ),
  );
}

/** Add IN filters for the current selections to a query object. */
export function withViewerFilters<T extends Partial<QueryObject>>(
  query: T,
  formData: QueryFormData,
  ownState?: Record<string, any>,
): T {
  const sel = activeSelection(formData, ownState);
  const extra = viewerFilterColumns(formData)
    .filter(col => sel[getColumnLabel(col)]?.length)
    .map(col => ({ col, op: 'IN' as const, val: sel[getColumnLabel(col)] }));
  if (!extra.length) return query;
  return {
    ...query,
    filters: [...ensureIsArray(query.filters), ...extra],
  } as T;
}

/** One extra query per filter field to list its values (most common first). */
export function optionQueries<T extends Partial<QueryObject>>(
  baseQueryObject: T,
  formData: QueryFormData,
): T[] {
  return viewerFilterColumns(formData).map(
    col =>
      ({
        ...baseQueryObject,
        columns: [col],
        metrics: [
          {
            expressionType: 'SQL',
            sqlExpression: 'COUNT(*)',
            label: 'vf_count',
          },
        ],
        orderby: [
          [
            {
              expressionType: 'SQL',
              sqlExpression: 'COUNT(*)',
              label: 'vf_count',
            },
            false,
          ],
        ],
        row_limit: 1000,
        post_processing: [],
        series_columns: [],
        series_limit: 0,
        is_timeseries: false,
      }) as unknown as T,
  );
}

/** Read the option lists back from the extra query results. */
export function parseFilterFields(
  formData: QueryFormData,
  queriesData: { data?: Record<string, unknown>[] }[],
  firstOptionQuery: number,
  verboseMap: Record<string, string> = {},
  formatValue: (key: string, v: unknown) => string = (_k, v) => String(v),
): FilterField[] {
  return viewerFilterColumns(formData).map((col, i) => {
    const key = getColumnLabel(col);
    const rows = queriesData[firstOptionQuery + i]?.data || [];
    const options = rows
      .filter(r => r[key] !== null && r[key] !== undefined && r[key] !== '')
      .map(r => ({
        value: r[key] as string | number | boolean,
        label: formatValue(key, r[key]),
        count: Number(r.vf_count) || undefined,
      }))
      .sort((a, b) =>
        String(a.label).localeCompare(String(b.label), undefined, {
          numeric: true,
        }),
      );
    return { key, label: verboseMap[key] || key, options };
  });
}
