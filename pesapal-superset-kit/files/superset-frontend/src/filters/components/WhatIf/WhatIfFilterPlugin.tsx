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
import { useEffect, useState } from 'react';
import {
  ensureIsArray,
  getColumnLabel,
  styled,
  SupersetClient,
  t,
} from '@superset-ui/core';
import rison from 'rison';
import { FilterPluginStyle } from '../common';
import {
  parseSettings,
  PluginFilterWhatIfProps,
  whatIfDataMask,
  WhatIfSettings,
} from './types';

const Wrapper = styled(FilterPluginStyle)`
  ${({ theme }) => `
  display: flex; flex-direction: column; gap: 4px;
  .wi-row { display: flex; align-items: center; gap: 8px; }
  .wi-row input[type='range'] { flex: 1; accent-color: ${theme.colors.primary.base}; }
  .wi-value { min-width: 56px; text-align: right; font-weight: ${theme.typography.weights.bold}; font-variant-numeric: tabular-nums; }
  .wi-scale { display: flex; justify-content: space-between; font-size: ${theme.typography.sizes.xs}px; color: ${theme.colors.grayscale.base}; }
  .wi-reset { border: 0; background: none; padding: 0; cursor: pointer; color: ${theme.colors.primary.dark1}; font-size: ${theme.typography.sizes.xs}px; }
  .wi-note { font-size: ${theme.typography.sizes.xs}px; color: ${theme.colors.grayscale.base}; }
  `}
`;

const cache = new Map<string, Promise<Record<string, string | null>>>();

/** column name -> extra JSON for a dataset (cached per page). */
function columnExtras(datasetId: number) {
  const key = String(datasetId);
  if (!cache.has(key)) {
    const q = rison.encode({
      columns: ['columns.column_name', 'columns.extra'],
    });
    cache.set(
      key,
      SupersetClient.get({
        endpoint: `/api/v1/dataset/${datasetId}?q=${q}`,
      }).then(({ json }) =>
        Object.fromEntries(
          (json.result?.columns || []).map(
            (c: { column_name: string; extra: string | null }) => [
              c.column_name,
              c.extra,
            ],
          ),
        ),
      ),
    );
  }
  return cache.get(key)!;
}

export default function WhatIfFilterPlugin(props: PluginFilterWhatIfProps) {
  const {
    formData,
    filterState,
    setDataMask,
    width,
    height,
    inputRef,
    setFocusedFilter,
    unsetFocusedFilter,
  } = props;
  const column = getColumnLabel(ensureIsArray(formData.groupby)[0] ?? '');
  const datasetId = Number(String(formData.datasource || '').split('__')[0]);
  const [settings, setSettings] = useState<WhatIfSettings | null>(null);
  const [error, setError] = useState('');
  const saved = ensureIsArray(filterState?.value)[0];
  const [value, setValue] = useState<number | null>(
    Number.isFinite(Number(saved)) && saved !== undefined
      ? Number(saved)
      : null,
  );

  useEffect(() => {
    if (!column || !datasetId) return;
    columnExtras(datasetId)
      .then(extras => {
        const s = parseSettings(extras[column], column);
        if (!s) setError(t('"%s" is not a what-if parameter column', column));
        setSettings(s);
      })
      .catch(() => setError(t('Could not load the parameter settings')));
  }, [column, datasetId]);

  // follow external changes (e.g. "Clear all" resets the filter)
  useEffect(() => {
    if (saved === undefined || saved === null) setValue(null);
    else if (Number(saved) !== value) setValue(Number(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const current = value ?? settings?.default ?? 0;

  // apply the default so charts get the value from the start
  useEffect(() => {
    if (settings && (saved === undefined || saved === null)) {
      setDataMask(whatIfDataMask(column, settings.default, settings.suffix));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const apply = (v: number) => {
    setValue(v);
    setDataMask(whatIfDataMask(column, v, settings?.suffix));
  };

  if (error) {
    return (
      <Wrapper width={width} height={height}>
        <div className="wi-note">{error}</div>
      </Wrapper>
    );
  }
  if (!settings) {
    return (
      <Wrapper width={width} height={height}>
        <div className="wi-note">{t('Loading…')}</div>
      </Wrapper>
    );
  }
  return (
    <Wrapper width={width} height={height}>
      <div className="wi-row">
        <input
          ref={inputRef}
          type="range"
          aria-label={settings.name}
          min={settings.min}
          max={settings.max}
          step={settings.step}
          value={current}
          onFocus={setFocusedFilter}
          onBlur={unsetFocusedFilter}
          onChange={e => setValue(Number(e.target.value))}
          onMouseUp={e => apply(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={e => apply(Number((e.target as HTMLInputElement).value))}
          onKeyUp={e => apply(Number((e.target as HTMLInputElement).value))}
        />
        <span className="wi-value">
          {current > 0 && settings.suffix === '%' ? '+' : ''}
          {current}
          {settings.suffix}
        </span>
      </div>
      <div className="wi-scale">
        <span>
          {settings.min}
          {settings.suffix}
        </span>
        {current !== settings.default && (
          <button
            type="button"
            className="wi-reset"
            onClick={() => apply(settings.default)}
          >
            {t('Reset to %s', `${settings.default}${settings.suffix}`)}
          </button>
        )}
        <span>
          {settings.max}
          {settings.suffix}
        </span>
      </div>
    </Wrapper>
  );
}
