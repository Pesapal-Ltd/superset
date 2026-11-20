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
import { t } from '@superset-ui/core';
import { updateDataset } from 'src/features/semantic/api';
import {
  ApiDataset,
  columnsPayload,
  Parameter,
  parametersOf,
  slug,
} from 'src/features/semantic/model';
import { errorText } from './styles';

const blank = { name: '', min: -50, max: 50, step: 5, default: 0, suffix: '%' };

export default function ParametersTab({
  dataset,
  onSaved,
}: {
  dataset: ApiDataset;
  onSaved: () => void;
}) {
  const params = useMemo(() => parametersOf(dataset), [dataset]);
  const [selected, setSelected] = useState<number | 'new'>(
    params.length ? 0 : 'new',
  );
  const [draft, setDraft] = useState<typeof blank & { column?: string }>(blank);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(selected === 'new' ? blank : { ...blank, ...params[selected] });
    setMsg(null);
  }, [selected, params]);

  const column = draft.column || `whatif_${slug(draft.name)}`;
  const error = !draft.name.trim()
    ? t('Give the parameter a name')
    : /[[\]"'():=]/.test(draft.name)
      ? t('Names cannot contain [ ] " \' ( ) : =')
      : !(draft.min < draft.max)
        ? t('Minimum must be below maximum')
        : !(draft.step > 0)
          ? t('Step must be above 0')
          : draft.default < draft.min || draft.default > draft.max
            ? t('Default must be between minimum and maximum')
            : params.some(
                  (p, i) =>
                    i !== selected &&
                    (p.column === column ||
                      p.name.toLowerCase() === draft.name.trim().toLowerCase()),
                )
              ? t('Another parameter already has this name')
              : dataset.columns.some(
                    c =>
                      c.column_name === column &&
                      !(c.extra || '').includes('whatif'),
                  )
                ? t('A column with this name already exists')
                : '';

  const save = async (list: Parameter[], okText: string) => {
    setSaving(true);
    try {
      await updateDataset(dataset.id, {
        columns: columnsPayload(dataset, list),
      });
      setMsg({ ok: true, text: okText });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    const p: Parameter = {
      name: draft.name.trim(),
      column,
      min: Number(draft.min),
      max: Number(draft.max),
      step: Number(draft.step),
      default: Number(draft.default),
      suffix: draft.suffix,
    };
    const list = [...params];
    if (selected === 'new') list.push(p);
    else list[selected] = p;
    save(list, t('Saved. Use it in measures as [%s].', p.name));
  };

  const num = (k: 'min' | 'max' | 'step' | 'default') => (
    <div className="sm-field">
      <span>
        {
          {
            min: t('Minimum'),
            max: t('Maximum'),
            step: t('Step'),
            default: t('Default'),
          }[k]
        }
      </span>
      <input
        type="number"
        aria-label={k}
        value={draft[k]}
        onChange={e => setDraft({ ...draft, [k]: Number(e.target.value) })}
      />
    </div>
  );

  return (
    <div className="sm-grid">
      <div className="sm-card">
        <h3>{t('Parameters')}</h3>
        <div className="sm-list">
          {params.map((p, i) => (
            <button
              key={p.column}
              type="button"
              className={selected === i ? 'on' : ''}
              onClick={() => setSelected(i)}
            >
              <span>{p.name}</span>
              <span className="sm-badge">
                {p.min}…{p.max}
                {p.suffix}
              </span>
            </button>
          ))}
          {!params.length && (
            <div className="sm-help">{t('No parameters yet.')}</div>
          )}
        </div>
        <div className="sm-actions">
          <button
            type="button"
            className="sm-btn"
            onClick={() => setSelected('new')}
          >
            + {t('New parameter')}
          </button>
        </div>
      </div>
      <div className="sm-card">
        <div className="sm-row">
          <div className="sm-field">
            <span>{t('Name')}</span>
            <input
              type="text"
              aria-label="Parameter name"
              value={draft.name}
              placeholder="Price change %"
              onChange={e => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="sm-field" style={{ maxWidth: 140 }}>
            <span>{t('Shown as')}</span>
            <select
              value={draft.suffix}
              onChange={e => setDraft({ ...draft, suffix: e.target.value })}
            >
              <option value="%">{t('percent (%)')}</option>
              <option value="">{t('number')}</option>
            </select>
          </div>
        </div>
        <div className="sm-row">
          {num('min')}
          {num('max')}
          {num('step')}
          {num('default')}
        </div>
        {draft.name && error && <div className="sm-err">{error}</div>}
        <div className="sm-help">
          <p>
            {t('Use it in any measure:')}{' '}
            <code>[{draft.name || 'Price change %'}]</code>, {t('e.g.')}{' '}
            <code>
              [Revenue] * (1 + [{draft.name || 'Price change %'}] / 100)
            </code>
            .
          </p>
          <p>
            {t('On a dashboard: Filters → + Add filter → type')}{' '}
            <b>{t('What-if parameter')}</b>
            {t(', dataset')} <code>{dataset.table_name}</code>, {t('column')}{' '}
            <code>{column}</code>.{' '}
            {t(
              'Viewers get a slider; every chart whose measures use the parameter recalculates.',
            )}
          </p>
        </div>
        <div className="sm-actions">
          <button
            type="button"
            className="sm-btn primary"
            disabled={!!error || saving}
            onClick={submit}
          >
            {saving ? t('Saving…') : t('Save parameter')}
          </button>
          {selected !== 'new' && (
            <button
              type="button"
              className="sm-btn danger"
              disabled={saving}
              onClick={() =>
                save(
                  params.filter((_, i) => i !== selected),
                  t('Parameter deleted.'),
                ).then(() => setSelected('new'))
              }
            >
              {t('Delete')}
            </button>
          )}
        </div>
        {msg && (
          <div className={`sm-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>
        )}
      </div>
    </div>
  );
}
