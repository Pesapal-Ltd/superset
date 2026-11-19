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
import { KpiStatus, KpiValueMode } from './types';

export interface KpiNumbers {
  value: number | null;
  previous: number | null;
  /** index of the row used as "current" (last mode only) */
  currentIndex: number;
  series: number[];
}

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Work out the headline value and the comparison value from an ordered
 * series of metric values (oldest first).
 */
export function computeKpi(
  values: (number | null | undefined)[],
  mode: KpiValueMode = 'last',
  lag = 1,
): KpiNumbers {
  const series = values.filter(isNum);
  if (series.length === 0) {
    return { value: null, previous: null, currentIndex: -1, series };
  }
  if (mode === 'sum' || mode === 'avg') {
    const sum = series.reduce((a, b) => a + b, 0);
    return {
      value: mode === 'sum' ? sum : sum / series.length,
      previous: null,
      currentIndex: values.length - 1,
      series,
    };
  }
  let currentIndex = values.length - 1;
  while (currentIndex >= 0 && !isNum(values[currentIndex])) currentIndex -= 1;
  const prevIndex = currentIndex - Math.max(1, Math.floor(lag) || 1);
  const prev = prevIndex >= 0 ? values[prevIndex] : null;
  return {
    value: values[currentIndex] as number,
    previous: isNum(prev) ? prev : null,
    currentIndex,
    series,
  };
}

export function percentChange(
  current: number | null,
  previous: number | null,
): number | null {
  if (!isNum(current) || !isNum(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

export function changeStatus(
  pct: number | null,
  lowerIsBetter = false,
): KpiStatus {
  if (pct === null || pct === 0) return 'neutral';
  const up = pct > 0;
  return up !== lowerIsBetter ? 'good' : 'bad';
}

/** Status for target achievement; within 10% of target counts as warning */
export function targetStatus(
  value: number,
  target: number,
  lowerIsBetter = false,
): KpiStatus | 'warning' {
  if (target === 0) return 'neutral';
  const achieved = lowerIsBetter ? value <= target : value >= target;
  if (achieved) return 'good';
  const gap = Math.abs(value - target) / Math.abs(target);
  return gap <= 0.1 ? 'warning' : 'bad';
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rgbaToString(
  color?: { r: number; g: number; b: number; a?: number } | null,
): string | undefined {
  if (!color) return undefined;
  const { r, g, b, a = 1 } = color;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
