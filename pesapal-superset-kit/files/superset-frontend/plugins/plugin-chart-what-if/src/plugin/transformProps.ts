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
  QueryFormMetric,
} from '@superset-ui/core';
import { Driver, valuesFromDashboard } from '../scenario';
import { WhatIfProps } from '../types';

export default function transformProps(chartProps: ChartProps): WhatIfProps {
  const { width, height, queriesData, datasource } = chartProps;
  const fd = chartProps.formData as Record<string, any>;
  const raw = chartProps.rawFormData as Record<string, any>;
  const metrics = ensureIsArray(fd.metrics as QueryFormMetric[]);
  const { currencyFormats = {}, columnFormats = {} } = (datasource ||
    {}) as any;
  const formatter = getValueFormatter(
    metrics,
    currencyFormats,
    columnFormats,
    fd.yAxisFormat,
    fd.currencyFormat,
  );
  const drivers: Driver[] = [1, 2, 3]
    .map(i => ({
      name: String(raw[`driver_${i}_name`] || '').trim(),
      min: Number(raw[`driver_${i}_min`] ?? -50),
      max: Number(raw[`driver_${i}_max`] ?? 50),
      step: Number(raw[`driver_${i}_step`] ?? 5) || 1,
      default: Number(raw[`driver_${i}_default`] ?? 0) || 0,
      param: String(raw[`driver_${i}_param`] || '').trim() || undefined,
      suffix: raw[`driver_${i}_suffix`] ?? '%',
    }))
    .filter(
      d =>
        d.name &&
        Number.isFinite(d.min) &&
        Number.isFinite(d.max) &&
        d.max > d.min,
    );
  const filters = ensureIsArray(raw.extra_form_data?.filters);
  const group = ensureIsArray(fd.groupby)[0];
  const c = fd.colorPicker;
  return {
    width,
    height,
    data: (queriesData?.[0]?.data || []) as Record<string, unknown>[],
    groupKey: group ? getColumnLabel(group) : undefined,
    metricKeys: metrics.map(getMetricLabel),
    formula: String(fd.scenarioFormula || ''),
    drivers,
    dashboardValues: valuesFromDashboard(drivers, filters),
    resultName: fd.resultName || 'Scenario',
    allowSliders: fd.allowSliders ?? true,
    lowerIsBetter: !!fd.lowerIsBetter,
    color: c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a ?? 1})` : '#20A7C9',
    format: v => formatter(v),
  };
}
