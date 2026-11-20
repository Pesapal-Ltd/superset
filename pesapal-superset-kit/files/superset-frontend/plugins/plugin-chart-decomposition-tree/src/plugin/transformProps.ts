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
  getColumnLabel,
  getMetricLabel,
  getValueFormatter,
} from '@superset-ui/core';
import { Level, Rec } from '../engine';
import { DecompFormData, DecompProps } from '../types';

// Superset only applies setControlValue in the chart editor (Explore).
const inExplore = () =>
  typeof window !== 'undefined' &&
  /\/explore\b/.test(window.location?.pathname || '');

export default function transformProps(chartProps: ChartProps): DecompProps {
  const { width, height, queriesData, datasource, hooks } = chartProps;
  const formData = chartProps.formData as DecompFormData & Record<string, any>;
  const {
    metric,
    groupby,
    metricName,
    maxBars = 10,
    allowExplore = true,
    decompLevels,
    colorPicker,
    yAxisFormat,
    currencyFormat,
  } = formData;
  const {
    currencyFormats = {},
    columnFormats = {},
    verboseMap = {},
  } = (datasource || {}) as any;
  const metricKey = getMetricLabel(metric);
  const dims = ensureIsArray(groupby).map(getColumnLabel);
  const formatter = getValueFormatter(
    metric,
    currencyFormats,
    columnFormats,
    yAxisFormat,
    currencyFormat,
  );
  const editing = inExplore() && !!hooks?.setControlValue;
  const c = colorPicker;
  return {
    width,
    height,
    rows: (queriesData?.[0]?.data || []) as Rec[],
    metricKey,
    metricName: metricName || verboseMap[metricKey] || metricKey,
    dims,
    dimLabels: Object.fromEntries(dims.map(d => [d, verboseMap[d] || d])),
    levels: ensureIsArray(decompLevels) as Level[],
    saveLevels: editing
      ? levels => hooks.setControlValue!('decomp_levels', levels)
      : undefined,
    interactive: editing || !!allowExplore,
    maxBars: Number(maxBars) || 10,
    barColor: c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a ?? 1})` : '#20A7C9',
    format: v => formatter(v),
  };
}
