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
import { analyze, detectTarget, Direction, Influencer } from './engine';
import { KeyInfluencersProps } from './types';

const Wrapper = styled.div<{ w: number; h: number }>`
  ${({ theme, w, h }) => `
  width: ${w}px; height: ${h}px; display: flex; flex-direction: column;
  font-family: ${theme.typography.families.sansSerif}; font-size: ${theme.typography.sizes.s}px;
  color: ${theme.colors.grayscale.dark1};
  .ki-q { font-size: ${theme.typography.sizes.l}px; font-weight: ${theme.typography.weights.bold}; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .ki-q select { font: inherit; font-weight: ${theme.typography.weights.bold}; color: ${theme.colors.primary.dark1};
    border: 1px solid ${theme.colors.primary.light2}; border-radius: 6px; padding: 2px 6px; background: ${theme.colors.primary.light5}; }
  .ki-tabs { display: flex; gap: 16px; border-bottom: 1px solid ${theme.colors.grayscale.light2}; margin: 10px 0; }
  .ki-tabs button { border: 0; background: none; font: inherit; padding: 6px 0; cursor: pointer; color: ${theme.colors.grayscale.base}; border-bottom: 2px solid transparent; }
  .ki-tabs button.on { color: ${theme.colors.primary.dark1}; border-bottom-color: ${theme.colors.primary.base}; font-weight: ${theme.typography.weights.bold}; }
  .ki-body { flex: 1; min-height: 0; display: flex; gap: 16px; }
  .ki-list { flex: 0 0 44%; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
  .ki-item { text-align: left; font: inherit; border: 1px solid ${theme.colors.grayscale.light2}; background: ${theme.colors.grayscale.light5};
    border-radius: 8px; padding: 8px 10px; cursor: pointer; display: flex; gap: 10px; align-items: center; color: inherit; }
  .ki-item.on { border-color: ${theme.colors.primary.base}; background: ${theme.colors.primary.light5}; }
  .ki-badge { flex: none; min-width: 56px; text-align: center; border-radius: 14px; padding: 3px 8px; font-weight: 700; font-size: 12px; }
  .ki-up { background: ${theme.colors.success.light2}; color: ${theme.colors.success.dark2}; }
  .ki-down { background: ${theme.colors.error.light2}; color: ${theme.colors.error.dark1}; }
  .ki-sub { color: ${theme.colors.grayscale.base}; font-size: 11px; margin-top: 2px; }
  .ki-detail { flex: 1; overflow: auto; min-width: 0; }
  .ki-detail h4 { margin: 0 0 2px; font-size: 13px; }
  .ki-seg { border: 1px solid ${theme.colors.grayscale.light2}; border-radius: 8px; padding: 10px 12px; }
  .ki-chip { display: inline-block; background: ${theme.colors.grayscale.light4}; border-radius: 10px; padding: 1px 8px; margin: 2px 4px 2px 0; }
  .ki-big { font-size: 20px; font-weight: 700; }
  .ki-empty { color: ${theme.colors.grayscale.base}; padding: 16px 0; line-height: 1.5; }
  .ki-foot { color: ${theme.colors.grayscale.light1}; font-size: 10px; padding-top: 6px; }
  `}
`;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export default function KeyInfluencers(props: KeyInfluencersProps) {
  const {
    width,
    height,
    rows,
    targetColumn,
    targetName,
    targetValue,
    factors,
    labels,
    allowDirectionChange,
    minGroup,
    maxInfluencers,
    format,
  } = props;
  const theme = useTheme();
  const [direction, setDirection] = useState<Direction>(props.direction);
  useEffect(() => setDirection(props.direction), [props.direction]);
  const [tab, setTab] = useState<'inf' | 'seg'>('inf');
  const [selected, setSelected] = useState(0);

  const analysis = useMemo(() => {
    if (!targetColumn || !rows.length) return null;
    const target = detectTarget(
      rows,
      targetColumn,
      direction,
      targetValue || undefined,
    );
    return analyze(rows, target, factors, { minGroup, maxInfluencers });
  }, [
    rows,
    targetColumn,
    targetValue,
    direction,
    factors,
    minGroup,
    maxInfluencers,
  ]);

  useEffect(() => setSelected(0), [analysis]);

  if (!targetColumn || !factors.length) {
    return (
      <Wrapper w={width} h={height}>
        <div className="ki-empty">
          Choose a field to <b>Analyze</b> and at least one field to{' '}
          <b>Explain by</b>.
        </div>
      </Wrapper>
    );
  }
  if (!analysis) {
    return (
      <Wrapper w={width} h={height}>
        <div className="ki-empty">No data for the current filters.</div>
      </Wrapper>
    );
  }

  const { target, overall, influencers, details, segments, n } = analysis;
  const numeric = target.kind === 'numeric';
  const up = direction === 'increase';
  const name = (f: string) => labels[f] || f;
  const statFmt = (v: number) => (numeric ? format(v) : pct(v));

  const statement = (inf: Influencer) => {
    if (numeric) {
      return (
        <>
          When <b>{name(inf.factor)}</b> is <b>{inf.value}</b>, the average{' '}
          {targetName} {inf.effect >= 0 ? 'increases' : 'decreases'} by{' '}
          <b>{format(Math.abs(inf.effect))}</b>
        </>
      );
    }
    const ratio = up ? inf.effect : 1 / inf.effect;
    return (
      <>
        When <b>{name(inf.factor)}</b> is <b>{inf.value}</b>, {targetName} is{' '}
        <b>{Number.isFinite(ratio) ? `${ratio.toFixed(2)}×` : 'far'}</b>{' '}
        {up ? 'more' : 'less'} likely to be <b>{target.value}</b>
      </>
    );
  };
  const badge = (inf: Influencer) =>
    numeric
      ? `${inf.effect >= 0 ? '+' : '−'}${format(Math.abs(inf.effect))}`
      : Number.isFinite(inf.effect)
        ? `${(up ? inf.effect : 1 / inf.effect).toFixed(1)}×`
        : '∞';

  const sel = influencers[Math.min(selected, influencers.length - 1)];
  const detail = sel ? details[sel.factor] : null;

  const renderDetail = () => {
    if (!sel || !detail) return null;
    const vals = [...detail.values]
      .sort((a, b) => b.n - a.n)
      .slice(0, 14)
      .sort((a, b) => b.stat - a.stat);
    const max = Math.max(
      ...vals.map(v => Math.abs(v.stat)),
      Math.abs(overall),
      1e-9,
    );
    const labelW = 120;
    const barW = Math.max(120, width * 0.56 - labelW - 90);
    const rowH = 26;
    const h = vals.length * rowH + 30;
    const ox = labelW + (Math.abs(overall) / max) * barW;
    return (
      <div className="ki-detail">
        <h4>
          {numeric
            ? `Average ${targetName}`
            : `% ${targetName} = ${target.value}`}{' '}
          by {name(sel.factor)}
        </h4>
        <div className="ki-sub">
          {statFmt(sel.group)} when {name(sel.factor)} is {sel.value} vs{' '}
          {statFmt(sel.rest)} for everything else · {sel.n.toLocaleString()}{' '}
          rows ({pct(sel.share)})
        </div>
        <svg
          width={labelW + barW + 90}
          height={h}
          role="img"
          aria-label="Influencer detail"
        >
          {vals.map((v, i) => {
            const isSel = v.value === sel.value;
            const w = (Math.abs(v.stat) / max) * barW;
            return (
              <g key={v.value} transform={`translate(0,${10 + i * rowH})`}>
                <text
                  x={labelW - 6}
                  y={14}
                  textAnchor="end"
                  fontSize={11}
                  fontWeight={isSel ? 700 : 400}
                  fill={theme.colors.grayscale.dark1}
                >
                  {v.value.length > 18 ? `${v.value.slice(0, 17)}…` : v.value}
                </text>
                <rect
                  x={labelW}
                  y={3}
                  width={Math.max(1, w)}
                  height={rowH - 8}
                  rx={3}
                  fill={
                    isSel
                      ? theme.colors.primary.base
                      : theme.colors.grayscale.light2
                  }
                />
                <text
                  x={labelW + w + 6}
                  y={14}
                  fontSize={11}
                  fill={theme.colors.grayscale.base}
                >
                  {statFmt(v.stat)}
                </text>
              </g>
            );
          })}
          <line
            x1={ox}
            x2={ox}
            y1={4}
            y2={h - 14}
            stroke={theme.colors.grayscale.dark1}
            strokeDasharray="4 3"
          />
          <text
            x={ox}
            y={h - 2}
            textAnchor="middle"
            fontSize={10}
            fill={theme.colors.grayscale.dark1}
          >
            average {statFmt(overall)}
          </text>
        </svg>
      </div>
    );
  };

  return (
    <Wrapper w={width} h={height}>
      <div className="ki-q">
        What influences {targetName} to
        {allowDirectionChange ? (
          <select
            value={direction}
            aria-label="Direction"
            onChange={e => setDirection(e.target.value as Direction)}
          >
            <option value="increase">
              {numeric ? 'increase' : `be ${target.value}`}
            </option>
            <option value="decrease">
              {numeric ? 'decrease' : `not be ${target.value}`}
            </option>
          </select>
        ) : (
          <span>
            {numeric
              ? direction
              : up
                ? `be ${target.value}`
                : `not be ${target.value}`}
          </span>
        )}
        ?
      </div>
      <div className="ki-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={tab === 'inf' ? 'on' : ''}
          onClick={() => setTab('inf')}
        >
          Key influencers ({influencers.length})
        </button>
        <button
          type="button"
          role="tab"
          className={tab === 'seg' ? 'on' : ''}
          onClick={() => setTab('seg')}
        >
          Top segments ({segments.length})
        </button>
      </div>
      {tab === 'inf' && (
        <div className="ki-body">
          {influencers.length ? (
            <>
              <div className="ki-list">
                {influencers.map((inf, i) => (
                  <button
                    key={`${inf.factor}=${inf.value}`}
                    type="button"
                    className={`ki-item ${i === selected ? 'on' : ''}`}
                    onClick={() => setSelected(i)}
                  >
                    <span
                      className={`ki-badge ${(numeric ? inf.effect >= 0 : up) ? 'ki-up' : 'ki-down'}`}
                    >
                      {badge(inf)}
                    </span>
                    <span>
                      {statement(inf)}
                      <div className="ki-sub">
                        {inf.n.toLocaleString()} rows ({pct(inf.share)})
                      </div>
                    </span>
                  </button>
                ))}
              </div>
              {renderDetail()}
            </>
          ) : (
            <div className="ki-empty">
              No field value clearly makes {targetName}{' '}
              {numeric ? direction : `${up ? '' : 'not '}be ${target.value}`}.
              <br />
              Try adding more fields to Explain by, more rows, or a smaller
              minimum group size.
            </div>
          )}
        </div>
      )}
      {tab === 'seg' && (
        <div
          className="ki-body"
          style={{ flexDirection: 'column', overflow: 'auto' }}
        >
          {segments.length ? (
            segments.map((s, i) => (
              <div
                className="ki-seg"
                key={s.conditions.map(c => c.value).join('|')}
              >
                <div className="ki-sub">Segment {i + 1}</div>
                <div>
                  {s.conditions.map(c => (
                    <span className="ki-chip" key={c.factor}>
                      {name(c.factor)} is <b>{c.value}</b>
                    </span>
                  ))}
                </div>
                <div>
                  <span className="ki-big">{statFmt(s.stat)}</span>{' '}
                  {numeric
                    ? `average ${targetName} (${overall ? `${s.stat >= overall ? '+' : '−'}${pct(Math.abs(s.stat / overall - 1))} vs average ${format(overall)}` : ''})`
                    : `are ${target.value} vs ${pct(overall)} overall`}
                </div>
                <div className="ki-sub">
                  {s.n.toLocaleString()} rows ({pct(s.share)} of data)
                </div>
              </div>
            ))
          ) : (
            <div className="ki-empty">
              No combination of two fields stands out clearly.
            </div>
          )}
        </div>
      )}
      <div className="ki-foot">
        Based on {n.toLocaleString()} rows. Only groups of {minGroup}+ rows that
        differ significantly (95%, adjusted for the number of comparisons) are
        shown. These are associations in the data, not proof of cause.
      </div>
    </Wrapper>
  );
}
