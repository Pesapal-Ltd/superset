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
  getValueFormatter,
} from '@superset-ui/core';
import { Rec } from '../engine';
import { KeyInfluencersProps } from '../types';

export default function transformProps(
  chartProps: ChartProps,
): KeyInfluencersProps {
  const { width, height, queriesData, datasource } = chartProps;
  const fd = chartProps.formData as Record<string, any>;
  const { verboseMap = {} } = (datasource || {}) as any;
  const target = ensureIsArray(fd.target)[0];
  const targetColumn = target ? getColumnLabel(target) : '';
  const factors = ensureIsArray(fd.groupby)
    .map(getColumnLabel)
    .filter(f => f !== targetColumn);
  const formatter = getValueFormatter(
    undefined,
    {},
    {},
    fd.yAxisFormat,
    fd.currencyFormat,
  );
  return {
    width,
    height,
    rows: (queriesData?.[0]?.data || []) as Rec[],
    targetColumn,
    targetName: fd.targetName || verboseMap[targetColumn] || targetColumn,
    targetValue: (fd.targetValue || '').trim() || undefined,
    factors,
    labels: Object.fromEntries(factors.map(f => [f, verboseMap[f] || f])),
    direction: fd.direction === 'decrease' ? 'decrease' : 'increase',
    allowDirectionChange: fd.allowDirection ?? true,
    minGroup: Number(fd.minGroup) || 30,
    maxInfluencers: Number(fd.maxInfluencers) || 10,
    format: v => formatter(v),
  };
}
