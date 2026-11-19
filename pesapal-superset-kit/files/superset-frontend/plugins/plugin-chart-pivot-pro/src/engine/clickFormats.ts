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
 * Formats a user adds by clicking a cell: a highlight on one cell, a rule
 * built from the clicked value, or switching a scale/bars/icons on a metric.
 */
import { ShowAs } from './pivot';

export type Op = '>' | '>=' | '=' | '<=' | '<';
export type MetricStyle = 'heat' | 'bar' | 'icon';
/** rules compare like with like: detail cells, or subtotal/total cells */
export type Scope = 'detail' | 'total';

export type CellFormat =
  | {
      id: string;
      type: 'cell';
      rowPath: string[];
      colPath: string[];
      metric: string;
      bg: string;
    }
  | {
      id: string;
      type: 'rule';
      metric: string;
      op: Op;
      value: number;
      showAs: ShowAs;
      bg: string;
      scope?: Scope;
    }
  | {
      id: string;
      type: 'metric';
      metric: string;
      style: MetricStyle;
      on: boolean;
    };

export const SWATCHES = [
  '#D3F9D8',
  '#5AC189',
  '#FFF3BF',
  '#FCC700',
  '#FFD8A8',
  '#FF7F44',
  '#FFE3E3',
  '#E04355',
  '#D0EBFF',
  '#1FA8C9',
  '#E5DBFF',
  '#666666',
];

export const OPS: Op[] = ['>', '>=', '=', '<=', '<'];
export const OP_LABELS: Record<Op, string> = {
  '>': 'greater than',
  '>=': 'at least',
  '=': 'equal to',
  '<=': 'at most',
  '<': 'less than',
};

let counter = 0;
export const newId = () => {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
};

const samePath = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function matches(op: Op, v: number, target: number): boolean {
  const eps = Math.max(1e-9, Math.abs(target) * 1e-9);
  switch (op) {
    case '>':
      return v > target;
    case '>=':
      return v >= target - eps;
    case '<':
      return v < target;
    case '<=':
      return v <= target + eps;
    default:
      return Math.abs(v - target) <= eps;
  }
}

/** Last matching entry wins; otherwise the chart setting. */
export function metricToggle(
  formats: CellFormat[],
  metric: string,
  style: MetricStyle,
  fallback: boolean,
): boolean {
  for (let i = formats.length - 1; i >= 0; i -= 1) {
    const f = formats[i];
    if (f.type === 'metric' && f.metric === metric && f.style === style)
      return f.on;
  }
  return fallback;
}

export const setMetricToggle = (
  formats: CellFormat[],
  metric: string,
  style: MetricStyle,
  on: boolean,
): CellFormat[] => [
  ...formats.filter(
    f => !(f.type === 'metric' && f.metric === metric && f.style === style),
  ),
  { id: newId(), type: 'metric', metric, style, on },
];

export function cellHighlight(
  formats: CellFormat[],
  rowPath: string[],
  colPath: string[],
  metric: string,
): string | undefined {
  for (let i = formats.length - 1; i >= 0; i -= 1) {
    const f = formats[i];
    if (
      f.type === 'cell' &&
      f.metric === metric &&
      samePath(f.rowPath, rowPath) &&
      samePath(f.colPath, colPath)
    )
      return f.bg;
  }
  return undefined;
}

export const setCellHighlight = (
  formats: CellFormat[],
  rowPath: string[],
  colPath: string[],
  metric: string,
  bg: string | null,
): CellFormat[] => {
  const rest = formats.filter(
    f =>
      !(
        f.type === 'cell' &&
        f.metric === metric &&
        samePath(f.rowPath, rowPath) &&
        samePath(f.colPath, colPath)
      ),
  );
  return bg
    ? [...rest, { id: newId(), type: 'cell', rowPath, colPath, metric, bg }]
    : rest;
};

export function ruleColor(
  formats: CellFormat[],
  metric: string,
  showAs: ShowAs,
  v: number,
  scope: Scope = 'detail',
): string | undefined {
  for (let i = formats.length - 1; i >= 0; i -= 1) {
    const f = formats[i];
    if (
      f.type === 'rule' &&
      f.metric === metric &&
      f.showAs === showAs &&
      (f.scope ?? 'detail') === scope &&
      matches(f.op, v, f.value)
    )
      return f.bg;
  }
  return undefined;
}

export const addRule = (
  formats: CellFormat[],
  metric: string,
  op: Op,
  value: number,
  showAs: ShowAs,
  bg: string,
  scope: Scope = 'detail',
): CellFormat[] => [
  ...formats,
  { id: newId(), type: 'rule', metric, op, value, showAs, bg, scope },
];

export const removeFormat = (formats: CellFormat[], id: string) =>
  formats.filter(f => f.id !== id);

export function loadPersonal(key: string): CellFormat[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function savePersonal(key: string, formats: CellFormat[]) {
  try {
    if (formats.length)
      window.localStorage.setItem(key, JSON.stringify(formats));
    else window.localStorage.removeItem(key);
  } catch (e) {
    // storage unavailable (private mode etc.): formats last until reload
  }
}
