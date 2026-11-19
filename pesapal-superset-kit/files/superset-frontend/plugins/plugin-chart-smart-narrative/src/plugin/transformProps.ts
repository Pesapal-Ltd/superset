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
  getTimeFormatter,
  getValueFormatter,
  getXAxisLabel,
  QueryFormData,
} from '@superset-ui/core';
import { buildNarrative } from '../narrative';
import { NarrativeFormData, SmartNarrativeProps } from '../types';

const GRAINS: Record<string, { noun: string; format?: string }> = {
  PT1H: { noun: 'hour', format: '%d %b %Y %H:00' },
  P1D: { noun: 'day', format: '%d %b %Y' },
  P1W: { noun: 'week', format: 'week of %d %b %Y' },
  P1M: { noun: 'month', format: '%b %Y' },
  P3M: { noun: 'quarter' },
  P1Y: { noun: 'year', format: '%Y' },
};

export function periodFormatter(grain?: string) {
  if (grain === 'P3M') {
    return (t: number) => {
      const d = new Date(t);
      return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    };
  }
  const f = getTimeFormatter((grain && GRAINS[grain]?.format) || '%d %b %Y');
  return (t: number) => f(t);
}

export const humanize = (s: string) =>
  s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

export default function transformProps(
  chartProps: ChartProps,
): SmartNarrativeProps {
  const { width, height, queriesData, rawFormData, datasource } = chartProps;
  const formData = chartProps.formData as NarrativeFormData;
  const {
    metric,
    groupby,
    timeGrainSqla,
    compareLag,
    lowerIsBetter,
    maxInsights,
    metricName,
    narrativeTitle,
    fontSize = 'm',
    showFooter = true,
    yAxisFormat,
    currencyFormat,
  } = formData;
  const { currencyFormats = {}, columnFormats = {} } = (datasource ||
    {}) as Partial<{
    currencyFormats: Record<string, any>;
    columnFormats: Record<string, string>;
  }>;

  const rows = (queriesData?.[0]?.data || []) as Record<string, unknown>[];
  const metricKey = getMetricLabel(metric);
  const timeKey = getXAxisLabel(rawFormData as QueryFormData);
  const formatter = getValueFormatter(
    metric,
    currencyFormats,
    columnFormats,
    yAxisFormat,
    currencyFormat,
  );

  const narrative = buildNarrative({
    rows,
    metricKey,
    metricName: metricName || metricKey,
    timeKey: timeKey || undefined,
    dims: ensureIsArray(groupby).map(c => {
      const key = getColumnLabel(c);
      return { key, name: humanize(key) };
    }),
    lag: Number(compareLag) || 1,
    lowerIsBetter: Boolean(lowerIsBetter),
    maxInsights: Number(maxInsights) || 6,
    periodNoun: (timeGrainSqla && GRAINS[timeGrainSqla]?.noun) || 'period',
    formatValue: v => formatter(v),
    formatPeriod: periodFormatter(timeGrainSqla),
  });

  return {
    width,
    height,
    title: narrativeTitle ?? 'Commentary',
    narrative,
    rowCount: rows.length,
    fontSize,
    showFooter,
  };
}
