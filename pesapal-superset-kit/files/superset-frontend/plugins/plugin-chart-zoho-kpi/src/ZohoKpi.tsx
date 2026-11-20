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
import { useMemo } from 'react';
import { styled, useTheme, SupersetTheme } from '@superset-ui/core';
import { KpiStatus, ZohoKpiProps } from './types';

const Card = styled.div<{ accent: string; w: number; h: number }>`
  ${({ theme, accent, w, h }) => `
    position: relative;
    box-sizing: border-box;
    width: ${w}px;
    height: ${h}px;
    padding: ${theme.gridUnit * 3}px ${theme.gridUnit * 4}px;
    padding-left: ${theme.gridUnit * 5}px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: ${theme.typography.families.sansSerif};
    color: ${theme.colors.grayscale.dark1};
    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: ${theme.gridUnit}px;
      background: ${accent};
      border-radius: ${theme.gridUnit}px 0 0 ${theme.gridUnit}px;
    }
    .kpi-title {
      font-size: ${theme.typography.sizes.s}px;
      font-weight: ${theme.typography.weights.bold};
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: ${theme.colors.grayscale.base};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .kpi-subtitle {
      font-size: ${theme.typography.sizes.xs}px;
      color: ${theme.colors.grayscale.light1};
    }
    .kpi-value {
      font-weight: ${theme.typography.weights.bold};
      line-height: 1.1;
      margin: ${theme.gridUnit}px 0;
      white-space: nowrap;
    }
    .kpi-change {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: ${theme.gridUnit}px;
      font-size: ${theme.typography.sizes.s}px;
      color: ${theme.colors.grayscale.base};
    }
    .kpi-badge {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 1px ${theme.gridUnit * 1.5}px;
      border-radius: ${theme.gridUnit * 3}px;
      font-weight: ${theme.typography.weights.bold};
    }
    .kpi-spark {
      flex: 1 1 auto;
      min-height: 0;
      margin-top: ${theme.gridUnit * 2}px;
    }
    .kpi-target {
      margin-top: ${theme.gridUnit * 2}px;
      font-size: ${theme.typography.sizes.xs}px;
      color: ${theme.colors.grayscale.base};
    }
    .kpi-target-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 2px;
    }
    .kpi-bar {
      height: ${theme.gridUnit * 1.5}px;
      border-radius: ${theme.gridUnit}px;
      background: ${theme.colors.grayscale.light2};
      overflow: hidden;
    }
    .kpi-bar > div {
      height: 100%;
      border-radius: ${theme.gridUnit}px;
      transition: width 0.4s ease;
    }
    .kpi-timestamp {
      font-size: ${theme.typography.sizes.xs}px;
      color: ${theme.colors.grayscale.light1};
    }
  `}
`;

function statusColors(theme: SupersetTheme, status: KpiStatus | 'warning') {
  switch (status) {
    case 'good':
      return {
        fg: theme.colors.success.dark1,
        bg: theme.colors.success.light2,
      };
    case 'bad':
      return { fg: theme.colors.error.dark1, bg: theme.colors.error.light2 };
    case 'warning':
      return {
        fg: theme.colors.warning.dark1,
        bg: theme.colors.warning.light2,
      };
    default:
      return {
        fg: theme.colors.grayscale.base,
        bg: theme.colors.grayscale.light3,
      };
  }
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const { line, area } = useMemo(() => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [
      (i / (values.length - 1)) * 100,
      // keep a 2-unit margin top and bottom so the stroke isn't clipped
      2 + (1 - (v - min) / span) * 96,
    ]);
    const l = pts
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' ');
    return { line: l, area: `${l} L100,100 L0,100 Z` };
  }, [values]);

  return (
    <svg
      className="kpi-spark"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      width="100%"
      role="img"
      aria-label="trend"
    >
      <path d={area} fill={color} fillOpacity={0.12} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ZohoKpi(props: ZohoKpiProps) {
  const {
    width,
    height,
    title,
    subtitle,
    formattedValue,
    comparison,
    target,
    sparkline,
    showSparkline,
    accentColor,
    timestamp,
  } = props;
  const theme = useTheme();

  // Scale the headline with the card, but keep it readable on tiny tiles.
  const valueFontSize = Math.max(
    18,
    Math.min(
      height * (showSparkline || target ? 0.24 : 0.36),
      (width * 1.6) / Math.max(formattedValue.length, 4),
      64,
    ),
  );

  const change = comparison && statusColors(theme, comparison.status);
  const arrow =
    comparison?.pct == null || comparison.pct === 0
      ? '■'
      : comparison.pct > 0
        ? '▲'
        : '▼';
  const targetColors = target && statusColors(theme, target.status);

  return (
    <Card accent={accentColor} w={width} h={height}>
      <div className="kpi-title" title={title}>
        {title}
      </div>
      {subtitle && <div className="kpi-subtitle">{subtitle}</div>}
      <div className="kpi-value" style={{ fontSize: valueFontSize }}>
        {formattedValue}
      </div>
      {comparison && change && (
        <div className="kpi-change">
          <span
            className="kpi-badge"
            style={{ color: change.fg, background: change.bg }}
          >
            <span style={{ fontSize: '0.75em' }}>{arrow}</span>
            {comparison.formattedPct}
          </span>
          <span>
            {comparison.label} ({comparison.formattedPrevious})
          </span>
        </div>
      )}
      {timestamp && <div className="kpi-timestamp">{timestamp}</div>}
      {showSparkline && sparkline.length > 1 && (
        <Sparkline values={sparkline} color={accentColor} />
      )}
      {target && targetColors && (
        <div className="kpi-target">
          <div className="kpi-target-row">
            <span>
              {target.label}: {target.formatted}
            </span>
            <span style={{ color: targetColors.fg, fontWeight: 600 }}>
              {target.formattedRatio}
            </span>
          </div>
          <div className="kpi-bar">
            <div
              style={{
                width: `${Math.max(0, Math.min(1, target.ratio)) * 100}%`,
                background: targetColors.fg,
              }}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
