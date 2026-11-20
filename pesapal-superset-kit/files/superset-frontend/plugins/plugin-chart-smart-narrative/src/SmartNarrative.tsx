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
import { useState } from 'react';
import { styled, useTheme } from '@superset-ui/core';
import { InsightKind, Part, partsToText } from './narrative';
import { SmartNarrativeProps } from './types';

const SIZES = { s: 12, m: 14, l: 17 };

const ICONS: Record<InsightKind, string> = {
  trend: '↗',
  record: '★',
  anomaly: '!',
  average: '≈',
  driver: '⇡',
  offset: '⇣',
  share: '%',
  new: '+',
  spread: '↔',
  total: 'Σ',
};

const Wrapper = styled.div<{ w: number; h: number; size: number }>`
  ${({ theme, w, h, size }) => `
    box-sizing: border-box;
    width: ${w}px;
    height: ${h}px;
    overflow: auto;
    padding: ${theme.gridUnit * 3}px ${theme.gridUnit * 4}px;
    font-family: ${theme.typography.families.sansSerif};
    font-size: ${size}px;
    line-height: 1.55;
    color: ${theme.colors.grayscale.dark1};
    .sn-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sn-title {
      font-size: ${theme.typography.sizes.s}px;
      font-weight: ${theme.typography.weights.bold};
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: ${theme.colors.grayscale.base};
    }
    .sn-copy {
      border: 1px solid ${theme.colors.grayscale.light2};
      background: ${theme.colors.grayscale.light5};
      color: ${theme.colors.grayscale.base};
      border-radius: ${theme.gridUnit}px;
      font-size: ${theme.typography.sizes.xs}px;
      padding: 2px ${theme.gridUnit * 2}px;
      cursor: pointer;
    }
    .sn-headline { font-size: 1.2em; margin: ${theme.gridUnit * 2}px 0 ${theme.gridUnit * 3}px; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; gap: ${theme.gridUnit * 2.5}px; margin: ${theme.gridUnit * 2}px 0; }
    .sn-ico {
      flex: none;
      width: 1.6em;
      height: 1.6em;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 0.8em;
      font-weight: 700;
      background: ${theme.colors.primary.light4};
      color: ${theme.colors.primary.dark1};
      margin-top: 0.1em;
    }
    .sn-ico.anomaly { background: ${theme.colors.warning.light2}; color: ${theme.colors.warning.dark1}; }
    .sn-ico.record { background: ${theme.colors.success.light2}; color: ${theme.colors.success.dark1}; }
    .sn-footer {
      margin-top: ${theme.gridUnit * 3}px;
      font-size: ${theme.typography.sizes.xs}px;
      color: ${theme.colors.grayscale.light1};
    }
  `}
`;

export default function SmartNarrative(props: SmartNarrativeProps) {
  const { width, height, title, narrative, rowCount, fontSize, showFooter } =
    props;
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  const toneColor = {
    good: theme.colors.success.dark1,
    bad: theme.colors.error.base,
    neutral: theme.colors.grayscale.dark1,
  };

  const render = (parts: Part[]) =>
    parts.map((p, i) =>
      typeof p === 'string' ? (
        // eslint-disable-next-line react/no-array-index-key
        <span key={i}>{p}</span>
      ) : (
        <span
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          style={{
            fontWeight: p.strong ? 600 : undefined,
            color: p.tone ? toneColor[p.tone] : undefined,
          }}
        >
          {p.text}
        </span>
      ),
    );

  const copy = () => {
    const text = [
      partsToText(narrative.headline),
      ...narrative.insights.map(i => `• ${partsToText(i.parts)}`),
    ].join('\n');
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Wrapper w={width} h={height} size={SIZES[fontSize] || 14}>
      <div className="sn-head">
        <div className="sn-title">{title}</div>
        <button type="button" className="sn-copy" onClick={copy}>
          {copied ? 'Copied' : 'Copy text'}
        </button>
      </div>
      <div className="sn-headline">{render(narrative.headline)}</div>
      <ul>
        {narrative.insights.map((ins, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <li key={i}>
            <span className={`sn-ico ${ins.kind}`}>{ICONS[ins.kind]}</span>
            <span>{render(ins.parts)}</span>
          </li>
        ))}
      </ul>
      {showFooter && (
        <div className="sn-footer">
          Written automatically from {rowCount.toLocaleString()} rows. Updates
          with filters.
        </div>
      )}
    </Wrapper>
  );
}
