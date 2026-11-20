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
import { styled } from '@superset-ui/core';
import { FilterField, FilterSelection } from './viewerFilters';

const Bar = styled.div`
  ${({ theme }) => `
  display: flex; flex-wrap: wrap; gap: ${theme.gridUnit * 1.5}px; align-items: center;
  padding-bottom: ${theme.gridUnit * 2}px; position: relative;
  font-family: ${theme.typography.families.sansSerif};
  font-size: ${theme.typography.sizes.s}px;
  .vf-btn {
    font: inherit; padding: 3px 10px; border-radius: 14px; cursor: pointer; max-width: 260px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    border: 1px solid ${theme.colors.grayscale.light2}; background: ${theme.colors.grayscale.light5};
    color: ${theme.colors.grayscale.dark1};
  }
  .vf-btn.active {
    border-color: ${theme.colors.primary.base}; background: ${theme.colors.primary.light4};
    color: ${theme.colors.primary.dark2};
  }
  .vf-clear { font: inherit; border: 0; background: none; cursor: pointer; color: ${theme.colors.primary.dark1}; }
  .vf-pop {
    position: absolute; top: 30px; z-index: 30; width: 260px; max-height: 320px; display: flex; flex-direction: column;
    background: ${theme.colors.grayscale.light5}; border: 1px solid ${theme.colors.grayscale.light2};
    border-radius: ${theme.gridUnit * 2}px; box-shadow: 0 8px 24px ${theme.colors.grayscale.light1}; padding: 8px 10px;
  }
  .vf-pop input[type='search'] { font: inherit; padding: 3px 6px; margin-bottom: 6px; border: 1px solid ${theme.colors.grayscale.light2}; border-radius: 4px; }
  .vf-list { overflow: auto; flex: 1; }
  .vf-list label { display: flex; gap: 6px; align-items: center; padding: 2px 0; cursor: pointer; }
  .vf-count { margin-left: auto; color: ${theme.colors.grayscale.light1}; font-size: 11px; }
  .vf-actions { display: flex; justify-content: space-between; align-items: center; padding-top: 6px; margin-top: 4px; border-top: 1px solid ${theme.colors.grayscale.light3}; }
  .vf-actions button { font: inherit; cursor: pointer; border-radius: 4px; padding: 2px 10px; }
  .vf-apply { border: 1px solid ${theme.colors.primary.base}; background: ${theme.colors.primary.base}; color: ${theme.colors.grayscale.light5}; }
  .vf-link { border: 0; background: none; color: ${theme.colors.primary.dark1}; }
  `}
`;

const summary = (field: FilterField, values: unknown[]) => {
  if (!values.length) return 'All';
  const labels = values.map(
    v => field.options.find(o => o.value === v)?.label ?? String(v),
  );
  return labels.length <= 2
    ? labels.join(', ')
    : `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
};

export default function ViewerFilterBar({
  fields,
  selection,
  onApply,
}: {
  fields: FilterField[];
  selection: FilterSelection;
  onApply: (next: FilterSelection) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown[]>([]);
  const [q, setQ] = useState('');
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  if (!fields.length) return null;
  const anyActive = fields.some(f => selection[f.key]?.length);

  return (
    <Bar className="viewer-filters">
      {fields.map(f => {
        const values = selection[f.key] || [];
        return (
          <button
            key={f.key}
            type="button"
            className={`vf-btn ${values.length ? 'active' : ''}`}
            title={`${f.label}: ${summary(f, values)}`}
            onClick={e => {
              setLeft(e.currentTarget.offsetLeft);
              setOpen(open === f.key ? null : f.key);
              setDraft(values);
              setQ('');
            }}
          >
            {f.label}: {summary(f, values)} ▾
          </button>
        );
      })}
      {anyActive && (
        <button type="button" className="vf-clear" onClick={() => onApply({})}>
          Clear filters
        </button>
      )}
      {open &&
        (() => {
          const f = fields.find(x => x.key === open)!;
          const shown = f.options.filter(o =>
            o.label.toLowerCase().includes(q.toLowerCase()),
          );
          const set = new Set(draft);
          return (
            <div
              className="vf-pop"
              role="dialog"
              aria-label={`Filter ${f.label}`}
              style={{ left }}
            >
              {f.options.length > 8 && (
                <input
                  type="search"
                  placeholder="Search…"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                />
              )}
              <div className="vf-list">
                {shown.slice(0, 500).map(o => (
                  // eslint-disable-next-line jsx-a11y/label-has-associated-control
                  <label key={String(o.value)}>
                    <input
                      type="checkbox"
                      checked={set.has(o.value)}
                      onChange={e => {
                        const next = new Set(draft);
                        if (e.target.checked) next.add(o.value);
                        else next.delete(o.value);
                        setDraft([...next]);
                      }}
                    />
                    {o.label}
                    {o.count !== undefined && (
                      <span className="vf-count">{o.count}</span>
                    )}
                  </label>
                ))}
                {!shown.length && <div className="vf-count">No values</div>}
              </div>
              <div className="vf-actions">
                <button
                  type="button"
                  className="vf-link"
                  onClick={() => setDraft([])}
                >
                  All
                </button>
                <span>
                  <button
                    type="button"
                    className="vf-link"
                    onClick={() => setOpen(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="vf-apply"
                    onClick={() => {
                      onApply({ ...selection, [f.key]: draft as any });
                      setOpen(null);
                    }}
                  >
                    Apply
                  </button>
                </span>
              </div>
            </div>
          );
        })()}
    </Bar>
  );
}
