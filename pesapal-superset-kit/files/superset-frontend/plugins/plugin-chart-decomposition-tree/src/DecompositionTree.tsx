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
import { Column, Item, Level, resolve, unusedDims } from './engine';
import { DecompProps } from './types';

const COL_W = 210;
const GAP = 64;
const HEAD = 46;
const ROW = 42;
const PAD = 12;

const Wrapper = styled.div<{ w: number; h: number }>`
  ${({ theme, w, h }) => `
  width: ${w}px; height: ${h}px; overflow: auto; position: relative;
  font-family: ${theme.typography.families.sansSerif};
  svg text { font-family: inherit; }
  .dt-item { cursor: default; }
  .dt-item.clickable { cursor: pointer; }
  .dt-item.clickable:hover .dt-bg { fill: ${theme.colors.grayscale.light4}; }
  .dt-act { cursor: pointer; }
  .dt-menu {
    position: absolute; z-index: 10; min-width: 190px; background: ${theme.colors.grayscale.light5};
    border: 1px solid ${theme.colors.grayscale.light2}; border-radius: ${theme.gridUnit * 2}px;
    box-shadow: 0 8px 24px ${theme.colors.grayscale.light1}; padding: 6px 0;
    font-size: ${theme.typography.sizes.s}px;
  }
  .dt-menu button {
    display: block; width: 100%; text-align: left; border: 0; background: none; font: inherit;
    padding: 5px 12px; cursor: pointer; color: ${theme.colors.grayscale.dark1};
  }
  .dt-menu button:hover { background: ${theme.colors.primary.light4}; }
  .dt-menu hr { border: 0; border-top: 1px solid ${theme.colors.grayscale.light3}; margin: 4px 0; }
  .dt-menu .dt-sub { font-size: 10px; color: ${theme.colors.grayscale.base}; display: block; }
  .dt-hint { position: absolute; font-size: 11px; color: ${theme.colors.grayscale.base}; }
  `}
`;

const truncate = (s: string, n = 24) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

export default function DecompositionTree(props: DecompProps) {
  const {
    width,
    height,
    rows,
    metricKey,
    metricName,
    dims,
    dimLabels,
    levels: savedLevels,
    saveLevels,
    interactive,
    maxBars,
    barColor,
    format,
  } = props;
  const theme = useTheme();
  const savedKey = JSON.stringify(savedLevels);
  const [levels, setLevels] = useState<Level[]>(savedLevels);
  useEffect(() => setLevels(JSON.parse(savedKey)), [savedKey]);
  const [menu, setMenu] = useState<null | { x: number; y: number }>(null);

  const { rootValue, columns } = useMemo(
    () => resolve(rows, metricKey, dims, levels),
    [rows, metricKey, dims, levels],
  );

  const update = (next: Level[]) => {
    setLevels(next);
    saveLevels?.(next);
    setMenu(null);
  };
  // levels actually shown (drop ones that could not be resolved)
  const shown = levels.slice(0, columns.length);

  const addLevel = (dim: string | null, mode: Level['mode']) =>
    update([...shown, { dim, mode, selected: null }]);
  const select = (ci: number, label: string) =>
    update(
      levels.map((l, i) => {
        if (i === ci) return { ...l, selected: label };
        if (i > ci) return { ...l, selected: null };
        return l;
      }),
    );
  const remove = (ci: number) => update(levels.slice(0, ci));

  const x = (c: number) => PAD + c * (COL_W + GAP);
  const visible = (col: Column) => col.items.slice(0, maxBars);
  const yOf = (j: number) => HEAD + j * ROW;

  const allCols: {
    title: string;
    badge?: string;
    items: Item[];
    selected: string | null;
    parentValue: number;
    idx: number;
  }[] = [
    {
      title: metricName,
      items: [{ label: 'Total', value: rootValue }],
      selected: 'Total',
      parentValue: rootValue,
      idx: -1,
    },
    ...columns.map((c, i) => ({
      title: dimLabels[c.dim] || c.dim,
      badge:
        c.mode === 'high'
          ? '✨ High value'
          : c.mode === 'low'
            ? '✨ Low value'
            : undefined,
      items: visible(c),
      selected: c.selected,
      parentValue: c.parentValue,
      idx: i,
    })),
  ];

  const maxRows = Math.max(...allCols.map(c => c.items.length), 1);
  const free = unusedDims(dims, columns);
  const last = allCols[allCols.length - 1];
  const lastSelIdx = last.items.findIndex(it => it.label === last.selected);
  const canAdd = interactive && free.length > 0 && lastSelIdx >= 0;
  // leave room on the right for the + button and its menu
  const svgW = x(allCols.length) + 240;
  const svgH = HEAD + maxRows * ROW + 30;

  const connectors: JSX.Element[] = [];
  for (let c = 1; c < allCols.length; c += 1) {
    const parent = allCols[c - 1];
    const pj = parent.items.findIndex(it => it.label === parent.selected);
    if (pj >= 0) {
      const x1 = x(c - 1) + COL_W;
      const y1 = yOf(pj) + ROW / 2;
      allCols[c].items.forEach((_, j) => {
        const x2 = x(c);
        const y2 = yOf(j) + ROW / 2;
        connectors.push(
          <path
            key={`${c}-${j}`}
            d={`M${x1},${y1} C${x1 + GAP / 2},${y1} ${x2 - GAP / 2},${y2} ${x2},${y2}`}
            fill="none"
            stroke={theme.colors.grayscale.light1}
            strokeWidth={1.2}
          />,
        );
      });
    }
  }

  return (
    <Wrapper w={width} h={height}>
      <svg
        width={svgW}
        height={svgH}
        role="img"
        aria-label="Decomposition tree"
      >
        {connectors}
        {allCols.map((col, c) => {
          const maxAbs = Math.max(
            ...col.items.map(it => Math.abs(it.value)),
            1,
          );
          const hidden =
            c > 0 ? columns[c - 1].items.length - col.items.length : 0;
          return (
            <g key={c} transform={`translate(${x(c)},0)`}>
              <text
                x={0}
                y={18}
                fontSize={12}
                fontWeight={600}
                fill={theme.colors.grayscale.dark1}
              >
                {truncate(col.title, 26)}
              </text>
              {col.badge && (
                <text
                  x={0}
                  y={33}
                  fontSize={10}
                  fill={theme.colors.primary.dark1}
                >
                  {col.badge}
                </text>
              )}
              {c > 0 && interactive && (
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                <text
                  className="dt-act"
                  x={COL_W - 4}
                  y={18}
                  textAnchor="end"
                  fontSize={12}
                  fill={theme.colors.grayscale.base}
                  onClick={() => remove(col.idx)}
                >
                  <title>Remove this level</title>✕
                </text>
              )}
              {col.items.map((it, j) => {
                const sel = it.label === col.selected;
                const clickable = interactive && c > 0;
                const share = col.parentValue ? it.value / col.parentValue : 0;
                return (
                  // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                  <g
                    key={it.label}
                    className={`dt-item ${clickable ? 'clickable' : ''}`}
                    transform={`translate(0,${yOf(j)})`}
                    onClick={
                      clickable ? () => select(col.idx, it.label) : undefined
                    }
                    data-label={it.label}
                  >
                    <title>{`${it.label}: ${format(it.value)} (${(share * 100).toFixed(1)}% of parent)`}</title>
                    <rect
                      className="dt-bg"
                      x={-4}
                      y={2}
                      width={COL_W + 8}
                      height={ROW - 4}
                      rx={6}
                      fill={
                        sel && c > 0
                          ? theme.colors.primary.light4
                          : 'transparent'
                      }
                      stroke={sel && c > 0 ? theme.colors.primary.base : 'none'}
                    />
                    <text
                      x={4}
                      y={17}
                      fontSize={12}
                      fill={theme.colors.grayscale.dark1}
                      fontWeight={sel ? 600 : 400}
                    >
                      {truncate(it.label)}
                    </text>
                    <text
                      x={COL_W - 4}
                      y={17}
                      fontSize={12}
                      textAnchor="end"
                      fill={theme.colors.grayscale.dark1}
                    >
                      {format(it.value)}
                    </text>
                    <rect
                      x={4}
                      y={24}
                      width={COL_W - 8}
                      height={8}
                      rx={3}
                      fill={theme.colors.grayscale.light3}
                    />
                    <rect
                      x={4}
                      y={24}
                      width={Math.max(
                        1,
                        (Math.abs(it.value) / maxAbs) * (COL_W - 8),
                      )}
                      height={8}
                      rx={3}
                      fill={it.value < 0 ? theme.colors.error.base : barColor}
                    />
                  </g>
                );
              })}
              {hidden > 0 && (
                <text
                  x={4}
                  y={yOf(col.items.length) + 16}
                  fontSize={11}
                  fill={theme.colors.grayscale.base}
                >
                  + {hidden} more
                </text>
              )}
            </g>
          );
        })}
        {canAdd && (
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions
          <g
            className="dt-act"
            aria-label="Break down further"
            transform={`translate(${x(allCols.length - 1) + COL_W + 18},${yOf(lastSelIdx) + ROW / 2})`}
            onClick={() =>
              setMenu(
                menu
                  ? null
                  : {
                      x: x(allCols.length - 1) + COL_W + 32,
                      y: yOf(lastSelIdx) + ROW / 2 - 10,
                    },
              )
            }
          >
            <title>Break down further</title>
            <circle r={11} fill={theme.colors.primary.base} />
            <text
              y={4.5}
              textAnchor="middle"
              fontSize={15}
              fontWeight={700}
              fill={theme.colors.grayscale.light5}
            >
              +
            </text>
          </g>
        )}
      </svg>
      {interactive && lastSelIdx < 0 && columns.length > 0 && (
        <div
          className="dt-hint"
          style={{
            left: x(allCols.length - 1),
            top: yOf(Math.min(maxRows, last.items.length)) + 26,
          }}
        >
          Click a bar to break it down further
        </div>
      )}
      {menu && (
        <div
          className="dt-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          {free.map(d => (
            <button
              key={d}
              type="button"
              role="menuitem"
              onClick={() => addLevel(d, 'manual')}
            >
              {dimLabels[d] || d}
            </button>
          ))}
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => addLevel(null, 'high')}
          >
            ✨ High value
            <span className="dt-sub">Field with the biggest contributor</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => addLevel(null, 'low')}
          >
            ✨ Low value
            <span className="dt-sub">Field with the smallest contributor</span>
          </button>
        </div>
      )}
    </Wrapper>
  );
}
