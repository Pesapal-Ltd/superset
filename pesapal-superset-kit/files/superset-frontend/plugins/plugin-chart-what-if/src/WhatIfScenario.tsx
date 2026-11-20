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
import { useEffect, useMemo, useState } from 'react';
import { styled, useTheme } from '@superset-ui/core';
import { FormulaError, parseFormula, refsOf } from './formula';
import { runScenario } from './scenario';
import { WhatIfProps } from './types';

const Wrapper = styled.div<{ w: number; h: number }>`
  ${({ theme, w, h }) => `
  width: ${w}px; height: ${h}px; overflow: auto; box-sizing: border-box; padding: 4px 8px;
  font-family: ${theme.typography.families.sansSerif}; font-size: ${theme.typography.sizes.s}px;
  color: ${theme.colors.grayscale.dark1};
  .wi-drivers { display: flex; flex-wrap: wrap; gap: 10px 24px; margin-bottom: 12px; }
  .wi-driver { min-width: 200px; flex: 1; }
  .wi-driver label { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 2px; }
  .wi-driver input { width: 100%; accent-color: ${theme.colors.primary.base}; }
  .wi-linked { font-size: 10px; color: ${theme.colors.grayscale.base}; font-weight: 400; }
  .wi-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px; }
  .wi-kpi { border: 1px solid ${theme.colors.grayscale.light2}; border-radius: 8px; padding: 8px 12px; }
  .wi-kpi .l { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: ${theme.colors.grayscale.base}; }
  .wi-kpi .v { font-size: 20px; font-weight: 700; }
  .wi-err { color: ${theme.colors.error.base}; white-space: pre-wrap; }
  .wi-legend { display: flex; gap: 14px; font-size: 11px; color: ${theme.colors.grayscale.base}; margin-bottom: 4px; }
  .wi-legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  `}
`;

export default function WhatIfScenario(props: WhatIfProps) {
  const {
    width,
    height,
    data,
    groupKey,
    metricKeys,
    formula,
    drivers,
    dashboardValues,
    resultName,
    allowSliders,
    lowerIsBetter,
    color,
    format,
  } = props;
  const theme = useTheme();
  const initial = useMemo(
    () =>
      Object.fromEntries(
        drivers.map(d => [d.name, dashboardValues[d.name] ?? d.default]),
      ),
    [drivers, dashboardValues],
  );
  const [values, setValues] = useState<Record<string, number>>(initial);
  useEffect(() => setValues(initial), [initial]);

  const parsed = useMemo(() => {
    try {
      const expr = parseFormula(formula);
      const known = [...metricKeys, ...drivers.map(d => d.name)].map(k =>
        k.toLowerCase(),
      );
      const unknown = [...refsOf(expr)].filter(
        r => !known.includes(r.toLowerCase()),
      );
      if (unknown.length) {
        return {
          error: `Unknown name${unknown.length > 1 ? 's' : ''}: ${unknown.map(u => `[${u}]`).join(', ')}.\nYou can use: ${[...metricKeys, ...drivers.map(d => d.name)].map(k => `[${k}]`).join(', ')}`,
        };
      }
      return { expr };
    } catch (e) {
      return { error: (e as FormulaError).message };
    }
  }, [formula, metricKeys, drivers]);

  if (!formula.trim()) {
    return (
      <Wrapper w={width} h={height}>
        Write a scenario formula, e.g.{' '}
        <code>
          [{metricKeys[0] || 'SUM(sales)'}] * (1 + [
          {drivers[0]?.name || 'Price %'}] / 100)
        </code>
      </Wrapper>
    );
  }
  if (parsed.error || !parsed.expr) {
    return (
      <Wrapper w={width} h={height}>
        <div className="wi-err">Formula: {parsed.error}</div>
      </Wrapper>
    );
  }

  const result = runScenario(
    data,
    groupKey,
    metricKeys,
    parsed.expr,
    drivers,
    values,
  );
  const good = result.delta === 0 ? null : result.delta > 0 !== lowerIsBetter;
  const deltaColor =
    good === null
      ? theme.colors.grayscale.base
      : good
        ? theme.colors.success.dark1
        : theme.colors.error.base;
  const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');

  const rows = [...result.rows]
    .sort((a, b) => Math.abs(b.baseline ?? 0) - Math.abs(a.baseline ?? 0))
    .slice(0, 15);
  const max = Math.max(
    ...rows.flatMap(r => [
      Math.abs(r.baseline ?? 0),
      Math.abs(r.scenario ?? 0),
    ]),
    1e-9,
  );
  const labelW = Math.min(160, width * 0.28);
  const barW = Math.max(60, width - labelW - 150);
  const rowH = 30;

  return (
    <Wrapper w={width} h={height}>
      {drivers.length > 0 && (
        <div className="wi-drivers">
          {drivers.map(d => {
            const linked = dashboardValues[d.name] !== undefined;
            const v = values[d.name] ?? d.default;
            return (
              <div className="wi-driver" key={d.name}>
                <label htmlFor={`wi-${d.name}`}>
                  <span>
                    {d.name}
                    {linked && (
                      <span className="wi-linked"> · from dashboard</span>
                    )}
                  </span>
                  <span>
                    {d.suffix === '%' && v > 0 ? '+' : ''}
                    {v}
                    {d.suffix}
                  </span>
                </label>
                <input
                  id={`wi-${d.name}`}
                  type="range"
                  aria-label={d.name}
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  value={v}
                  disabled={!allowSliders}
                  onChange={e =>
                    setValues({ ...values, [d.name]: Number(e.target.value) })
                  }
                />
              </div>
            );
          })}
        </div>
      )}
      <div className="wi-kpis">
        <div className="wi-kpi">
          <div className="l">Baseline</div>
          <div className="v">{format(result.baseline)}</div>
        </div>
        <div className="wi-kpi">
          <div className="l">{resultName}</div>
          <div className="v">{format(result.scenario)}</div>
        </div>
        <div className="wi-kpi">
          <div className="l">Change</div>
          <div className="v" style={{ color: deltaColor }}>
            {sign(result.delta)}
            {format(Math.abs(result.delta))}
          </div>
          <div style={{ color: deltaColor }}>
            {result.pct === null
              ? ''
              : `${sign(result.pct)}${(Math.abs(result.pct) * 100).toFixed(1)}%`}
          </div>
        </div>
      </div>
      {groupKey && (
        <>
          <div className="wi-legend">
            <span>
              <i style={{ background: theme.colors.grayscale.light1 }} />
              Baseline
            </span>
            <span>
              <i style={{ background: color }} />
              {resultName}
            </span>
          </div>
          <svg
            width={labelW + barW + 140}
            height={rows.length * rowH + 4}
            role="img"
            aria-label="Scenario by group"
          >
            {rows.map((r, i) => {
              const d = (r.scenario ?? 0) - (r.baseline ?? 0);
              const g = d === 0 ? null : d > 0 !== lowerIsBetter;
              return (
                <g key={r.label} transform={`translate(0,${i * rowH})`}>
                  <text
                    x={labelW - 6}
                    y={17}
                    textAnchor="end"
                    fontSize={11}
                    fill={theme.colors.grayscale.dark1}
                  >
                    {r.label.length > 22 ? `${r.label.slice(0, 21)}…` : r.label}
                  </text>
                  <rect
                    x={labelW}
                    y={4}
                    height={9}
                    rx={2}
                    width={(Math.abs(r.baseline ?? 0) / max) * barW}
                    fill={theme.colors.grayscale.light1}
                  />
                  <rect
                    x={labelW}
                    y={15}
                    height={9}
                    rx={2}
                    width={(Math.abs(r.scenario ?? 0) / max) * barW}
                    fill={color}
                  />
                  <text
                    x={labelW + barW + 8}
                    y={17}
                    fontSize={11}
                    fill={
                      g === null
                        ? theme.colors.grayscale.base
                        : g
                          ? theme.colors.success.dark1
                          : theme.colors.error.base
                    }
                  >
                    {r.scenario === null
                      ? '–'
                      : `${format(r.scenario)} (${sign(d)}${format(Math.abs(d))})`}
                  </text>
                </g>
              );
            })}
          </svg>
        </>
      )}
    </Wrapper>
  );
}
