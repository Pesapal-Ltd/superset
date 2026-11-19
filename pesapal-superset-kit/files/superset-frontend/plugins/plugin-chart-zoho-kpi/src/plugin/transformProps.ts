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
  getMetricLabel,
  getNumberFormatter,
  getTimeFormatter,
  getValueFormatter,
  getXAxisLabel,
  QueryFormData,
  supersetTheme,
} from '@superset-ui/core';
import { KpiStatus, ZohoKpiFormData, ZohoKpiProps } from '../types';
import {
  changeStatus,
  computeKpi,
  percentChange,
  rgbaToString,
  targetStatus,
  toNumber,
} from '../utils';

const pctFormatter = getNumberFormatter('+,.1%');
const ratioFormatter = getNumberFormatter(',.0%');

export default function transformProps(chartProps: ChartProps): ZohoKpiProps {
  const { width, height, queriesData, rawFormData, datasource } = chartProps;
  const formData = chartProps.formData as ZohoKpiFormData;
  const {
    metric,
    kpiValueMode = 'last',
    compareLag,
    comparisonLabel,
    lowerIsBetter = false,
    targetValue,
    targetLabel,
    kpiTitle,
    subtitle,
    showSparkline = true,
    showTimestamp = false,
    colorPicker,
    yAxisFormat,
    currencyFormat,
    timeFormat,
  } = formData;
  const { currencyFormats = {}, columnFormats = {} } = (datasource ||
    {}) as Partial<{
    currencyFormats: Record<string, any>;
    columnFormats: Record<string, string>;
  }>;

  const metricLabel = getMetricLabel(metric);
  const xAxisLabel = getXAxisLabel(rawFormData as QueryFormData);
  const rows = (queriesData?.[0]?.data || []) as Record<string, unknown>[];
  const values = rows.map(r => toNumber(r[metricLabel]));

  const lag = toNumber(compareLag) ?? 1;
  const { value, previous, currentIndex, series } = computeKpi(
    values,
    xAxisLabel ? kpiValueMode : 'last',
    lag,
  );

  const formatter = getValueFormatter(
    metric,
    currencyFormats,
    columnFormats,
    yAxisFormat,
    currencyFormat,
  );

  let comparison: ZohoKpiProps['comparison'] = null;
  if (xAxisLabel && kpiValueMode === 'last' && previous !== null) {
    const pct = percentChange(value, previous);
    comparison = {
      pct,
      formattedPct: pct === null ? '–' : pctFormatter(pct),
      formattedPrevious: formatter(previous),
      label: comparisonLabel ?? 'vs previous period',
      status: changeStatus(pct, lowerIsBetter) as KpiStatus,
    };
  }

  let target: ZohoKpiProps['target'] = null;
  const targetNum = toNumber(targetValue);
  if (targetNum !== null && value !== null) {
    const ratio = targetNum === 0 ? 0 : value / targetNum;
    target = {
      formatted: formatter(targetNum),
      label: targetLabel || 'Target',
      ratio,
      formattedRatio: ratioFormatter(ratio),
      status: targetStatus(value, targetNum, lowerIsBetter),
    };
  }

  let timestamp: string | undefined;
  if (showTimestamp && xAxisLabel && currentIndex >= 0) {
    const raw = rows[currentIndex]?.[xAxisLabel];
    if (raw !== null && raw !== undefined) {
      timestamp = getTimeFormatter(timeFormat)(raw as number);
    }
  }

  return {
    width,
    height,
    title: kpiTitle || metricLabel,
    subtitle,
    formattedValue: value === null ? 'N/A' : formatter(value),
    comparison,
    target,
    sparkline: xAxisLabel ? series : [],
    showSparkline: Boolean(showSparkline && xAxisLabel && series.length > 1),
    accentColor: rgbaToString(colorPicker) || supersetTheme.colors.primary.base,
    timestamp,
  };
}
