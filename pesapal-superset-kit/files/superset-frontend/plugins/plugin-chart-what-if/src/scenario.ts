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
import { evaluate, Expr } from './formula';

export interface Driver {
  name: string;
  min: number;
  max: number;
  step: number;
  /** the planned / baseline value */
  default: number;
  /** follow this dashboard what-if parameter column, if set */
  param?: string;
  suffix?: string;
}

export interface ScenarioRow {
  label: string;
  baseline: number | null;
  scenario: number | null;
}

export interface ScenarioResult {
  rows: ScenarioRow[];
  baseline: number;
  scenario: number;
  delta: number;
  pct: number | null;
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return v === null || v === undefined || Number.isNaN(n) ? null : n;
};

/**
 * Evaluate the formula per row twice: with every driver at its planned value
 * (baseline) and at the current slider values (scenario).
 */
export function runScenario(
  data: Record<string, unknown>[],
  groupKey: string | undefined,
  metricKeys: string[],
  formula: Expr,
  drivers: Driver[],
  values: Record<string, number>,
): ScenarioResult {
  const base = Object.fromEntries(drivers.map(d => [d.name, d.default]));
  const now = Object.fromEntries(
    drivers.map(d => [d.name, values[d.name] ?? d.default]),
  );
  const rows = data.map(r => {
    const metrics = Object.fromEntries(metricKeys.map(k => [k, num(r[k])]));
    return {
      label: groupKey ? String(r[groupKey] ?? '(blank)') : 'Total',
      baseline: evaluate(formula, { ...metrics, ...base }),
      scenario: evaluate(formula, { ...metrics, ...now }),
    };
  });
  const sum = (k: 'baseline' | 'scenario') =>
    rows.reduce((a, r) => a + (r[k] ?? 0), 0);
  const baseline = sum('baseline');
  const scenario = sum('scenario');
  return {
    rows,
    baseline,
    scenario,
    delta: scenario - baseline,
    pct: baseline ? (scenario - baseline) / Math.abs(baseline) : null,
  };
}

/** Slider values from dashboard what-if parameters (native filter values). */
export function valuesFromDashboard(
  drivers: Driver[],
  filters: { col?: unknown; op?: string; val?: unknown }[] = [],
): Record<string, number> {
  const out: Record<string, number> = {};
  drivers.forEach(d => {
    if (!d.param) return;
    const f = filters.find(x => x.col === d.param);
    const v = Array.isArray(f?.val) ? f?.val[0] : f?.val;
    const n = Number(v);
    if (f && Number.isFinite(n))
      out[d.name] = Math.min(d.max, Math.max(d.min, n));
  });
  return out;
}
