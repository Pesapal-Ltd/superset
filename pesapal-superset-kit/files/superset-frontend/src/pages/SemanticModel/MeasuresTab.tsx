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
import { getNumberFormatter, t } from '@superset-ui/core';
import { compileMeasure, DaxError } from 'src/features/semantic/dax';
import {
  ApiDataset,
  buildModel,
  Measure,
  measuresOf,
  metricsPayload,
  parametersOf,
} from 'src/features/semantic/model';
import { testMeasure, updateDataset } from 'src/features/semantic/api';
import { errorText } from './styles';

const FORMATS: [string, string][] = [
  ['', 'Default'],
  [',.0f', '12,345'],
  [',.2f', '12,345.67'],
  ['$,.0f', '$12,345'],
  ['$,.2f', '$12,345.67'],
  ['.1%', '12.3%'],
  ['.2%', '12.34%'],
  ['SMART_NUMBER', '12.3k'],
];

const EXAMPLES: [string, string][] = [
  ['Total', 'SUM(Sales[sales])'],
  [
    'Count rows / distinct',
    'COUNTROWS(Sales)   DISTINCTCOUNT(Sales[order_number])',
  ],
  ['Ratio', 'DIVIDE([Revenue], [Orders])'],
  ['Filtered', 'CALCULATE([Revenue], Sales[status] = "Shipped")'],
  ['% of total', 'DIVIDE([Revenue], CALCULATE([Revenue], ALL(Sales)))'],
  [
    '% within group',
    'DIVIDE([Revenue], CALCULATE([Revenue], ALL(Sales[product_line])))',
  ],
  ['Last year', "CALCULATE([Revenue], SAMEPERIODLASTYEAR('Date'[order_date]))"],
  ['YoY %', 'DIVIDE([Revenue] - [Revenue LY], [Revenue LY])'],
  ['Year to date', "TOTALYTD([Revenue], 'Date'[order_date])"],
  ['Previous month', "CALCULATE([Revenue], PREVIOUSMONTH('Date'[order_date]))"],
  [
    '3 months back',
    "CALCULATE([Revenue], DATEADD('Date'[order_date], -3, MONTH))",
  ],
  ['Rank', 'RANKX(ALL(Sales[product_line]), [Revenue])'],
  [
    'Row-level then sum',
    'SUMX(Sales, Sales[quantity_ordered] * Sales[price_each])',
  ],
  [
    'Conditional',
    'IF([Revenue] > 1000000, 1, 0)   SWITCH(TRUE(), [Margin %] > 0.3, "High", "Low")',
  ],
  ['What-if', '[Revenue] * (1 + [Price change %] / 100)'],
];

const blank: Measure = { name: '', formula: '', format: '', description: '' };

export default function MeasuresTab({
  dataset,
  onSaved,
}: {
  dataset: ApiDataset;
  onSaved: () => void;
}) {
  const measures = useMemo(() => measuresOf(dataset), [dataset]);
  const params = useMemo(() => parametersOf(dataset), [dataset]);
  const [selected, setSelected] = useState<number | 'new'>(
    measures.findIndex(m => !m.sqlOnly) >= 0
      ? measures.findIndex(m => !m.sqlOnly)
      : 'new',
  );
  const current = selected === 'new' ? null : measures[selected];
  const [draft, setDraft] = useState<Measure>(current || blank);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [testBy, setTestBy] = useState('');
  const [testParams, setTestParams] = useState<Record<string, number>>({});
  const [testResult, setTestResult] = useState<{
    rows: Record<string, unknown>[];
    error?: string;
  } | null>(null);

  const [pendingName, setPendingName] = useState<string | null>(null);

  useEffect(() => {
    setDraft(selected === 'new' ? blank : measures[selected] || blank);
    setTestResult(null);
  }, [selected, measures]);

  // after saving a new measure, open it once the dataset has reloaded
  useEffect(() => {
    if (!pendingName) return;
    const idx = measures.findIndex(m => m.name === pendingName);
    if (idx >= 0) {
      setSelected(idx);
      setPendingName(null);
    }
  }, [measures, pendingName]);

  const choose = (next: number | 'new') => {
    setMsg(null);
    setSelected(next);
  };

  const nameError = useMemo(() => {
    const n = draft.name.trim();
    if (!n) return t('Give the measure a name');
    if (/[[\]"'():=]/.test(n))
      return t('Names cannot contain [ ] " \' ( ) : =');
    const clash = measures.findIndex(
      (m, i) => m.name.toLowerCase() === n.toLowerCase() && i !== selected,
    );
    if (clash >= 0) return t('Another measure already has this name');
    if (
      dataset.columns.some(c => c.column_name.toLowerCase() === n.toLowerCase())
    ) {
      return t('A column has this name; pick another to avoid confusion');
    }
    return '';
  }, [draft.name, measures, selected, dataset]);

  const allMeasures = useMemo(() => {
    const next = [...measures];
    const m = { ...draft, name: draft.name.trim(), sqlOnly: false };
    if (selected === 'new') next.push(m);
    else next[selected] = { ...next[selected], ...m };
    return next;
  }, [measures, draft, selected]);

  const compiled = useMemo(() => {
    if (!draft.formula.trim() || current?.sqlOnly) return null;
    try {
      const model = buildModel(dataset, allMeasures, params);
      return {
        ...compileMeasure(
          `${draft.name.trim() || 'Measure'} := ${draft.formula}`,
          model,
        ),
        error: '',
        pos: -1,
      };
    } catch (e) {
      return {
        sql: '',
        warnings: [],
        dependsOn: [],
        usesTemplates: false,
        error: (e as Error).message,
        pos: (e as DaxError).pos ?? -1,
      };
    }
  }, [draft, allMeasures, dataset, params, current]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(current || blank);

  const save = async (list: Measure[], okText: string) => {
    const { metrics, errors } = metricsPayload(dataset, list, params);
    if (Object.keys(errors).length) {
      setMsg({
        ok: false,
        text: Object.entries(errors)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n'),
      });
      return;
    }
    setSaving(true);
    try {
      await updateDataset(dataset.id, { metrics });
      setMsg({ ok: true, text: okText });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!compiled?.sql) return;
    const [by, grain] = testBy.split('|');
    try {
      const r = await testMeasure({
        datasetId: dataset.id,
        label: draft.name.trim() || 'value',
        sql: compiled.sql,
        by: by || undefined,
        grain: grain || undefined,
        params: Object.fromEntries(
          params.map(p => [p.column, testParams[p.column] ?? p.default]),
        ),
      });
      const label = draft.name.trim() || 'value';
      const rows = [...r.rows].sort((a, b) =>
        by
          ? String(a[by]).localeCompare(String(b[by]), undefined, {
              numeric: true,
            })
          : 0,
      );
      setTestResult({
        rows: rows.map(row => ({ ...row, testValue: row[label] })),
      });
    } catch (e) {
      setTestResult({ rows: [], error: errorText(e) });
    }
  };

  const dateCols = dataset.columns.filter(c => c.is_dttm);
  const otherCols = dataset.columns.filter(
    c => !c.is_dttm && !(c.extra || '').includes('whatif'),
  );
  const numberFormat = getNumberFormatter(draft.format || undefined);
  const fmt = (v: unknown) =>
    typeof v === 'number'
      ? numberFormat(v)
      : v === null || v === undefined
        ? '–'
        : String(v);

  return (
    <div className="sm-grid">
      <div className="sm-card">
        <h3>{t('Measures')}</h3>
        <div className="sm-list">
          {measures.map((m, i) => (
            <button
              key={`${m.id}-${m.name}`}
              type="button"
              className={selected === i ? 'on' : ''}
              onClick={() => choose(i)}
            >
              <span>{m.name}</span>
              <span className={`sm-badge ${m.sqlOnly ? '' : 'dax'}`}>
                {m.sqlOnly ? 'SQL' : 'DAX'}
              </span>
            </button>
          ))}
        </div>
        <div className="sm-actions">
          <button
            type="button"
            className="sm-btn"
            onClick={() => choose('new')}
          >
            + {t('New measure')}
          </button>
        </div>
      </div>

      <div className="sm-card">
        {current?.sqlOnly ? (
          <>
            <h3>{current.name}</h3>
            <div className="sm-help">
              {t(
                'This is a plain SQL metric from the dataset editor. Measures can use it as',
              )}{' '}
              <code>[{current.name}]</code>{' '}
              {t('only if it is recreated as a DAX measure.')}
            </div>
            <pre className="sm-sql">{current.sql}</pre>
          </>
        ) : (
          <>
            <div className="sm-row">
              <div className="sm-field">
                <span>{t('Name')}</span>
                <input
                  type="text"
                  aria-label="Measure name"
                  value={draft.name}
                  placeholder="Revenue YoY %"
                  onChange={e => setDraft({ ...draft, name: e.target.value })}
                />
                {draft.name && nameError && (
                  <div className="sm-err">{nameError}</div>
                )}
              </div>
              <div className="sm-field" style={{ maxWidth: 200 }}>
                <span>{t('Format')}</span>
                <select
                  aria-label="Format"
                  value={draft.format || ''}
                  onChange={e => setDraft({ ...draft, format: e.target.value })}
                >
                  {FORMATS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="sm-field">
              <span>{t('DAX formula')}</span>
              <textarea
                className="sm-code"
                aria-label="DAX formula"
                spellCheck={false}
                value={draft.formula}
                placeholder="DIVIDE([Revenue] - [Revenue LY], [Revenue LY])"
                onChange={e => setDraft({ ...draft, formula: e.target.value })}
              />
            </div>
            {compiled &&
              (compiled.error ? (
                <div className="sm-err" role="alert">
                  ✕ {compiled.error}
                </div>
              ) : (
                <div className="sm-ok">
                  ✓ {t('Compiles to SQL')}
                  {compiled.dependsOn.length > 0 && (
                    <span className="sm-help">
                      {' '}
                      · {t('uses')}{' '}
                      {compiled.dependsOn.map(d => `[${d}]`).join(', ')}
                    </span>
                  )}
                </div>
              ))}
            {compiled?.warnings.map(w => (
              <div key={w} className="sm-warn">
                ⚠ {w}
              </div>
            ))}
            {compiled?.sql && (
              <details>
                <summary>{t('Show generated SQL')}</summary>
                <pre className="sm-sql">{compiled.sql}</pre>
              </details>
            )}
            <details>
              <summary>{t('DAX examples')}</summary>
              <table className="sm-table">
                <tbody>
                  {EXAMPLES.map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ whiteSpace: 'nowrap' }}>{k}</td>
                      <td>
                        <code>{v}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <div className="sm-field" style={{ marginTop: 12 }}>
              <span>{t('Description')}</span>
              <input
                type="text"
                value={draft.description || ''}
                onChange={e =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
            </div>

            <div className="sm-card" style={{ background: 'transparent' }}>
              <h3>{t('Test')}</h3>
              <div className="sm-row">
                <div className="sm-field">
                  <span>{t('Split by')}</span>
                  <select
                    aria-label="Test split"
                    value={testBy}
                    onChange={e => setTestBy(e.target.value)}
                  >
                    <option value="">{t('Total only')}</option>
                    {dateCols.flatMap(c =>
                      [
                        ['P1M', t('month')],
                        ['P3M', t('quarter')],
                        ['P1Y', t('year')],
                      ].map(([g, l]) => (
                        <option
                          key={`${c.column_name}|${g}`}
                          value={`${c.column_name}|${g}`}
                        >
                          {c.column_name} ({l})
                        </option>
                      )),
                    )}
                    {otherCols.map(c => (
                      <option key={c.column_name} value={c.column_name}>
                        {c.column_name}
                      </option>
                    ))}
                  </select>
                </div>
                {params.map(p => (
                  <div
                    key={p.column}
                    className="sm-field"
                    style={{ maxWidth: 160 }}
                  >
                    <span>{p.name}</span>
                    <input
                      type="number"
                      aria-label={`Test value for ${p.name}`}
                      step={p.step}
                      value={testParams[p.column] ?? p.default}
                      onChange={e =>
                        setTestParams({
                          ...testParams,
                          [p.column]: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="sm-btn"
                disabled={!compiled?.sql}
                onClick={runTest}
              >
                ▶ {t('Run test')}
              </button>
              {testResult?.error && (
                <div className="sm-msg err">{testResult.error}</div>
              )}
              {testResult && !testResult.error && (
                <table className="sm-table" aria-label="Test result">
                  <thead>
                    <tr>
                      {testBy && <th>{testBy.split('|')[0]}</th>}
                      <th className="num">{draft.name || t('Value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testResult.rows.slice(0, 50).map((r, i) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={i}>
                        {testBy && (
                          <td>{String(r[testBy.split('|')[0]] ?? '–')}</td>
                        )}
                        <td className="num">{fmt(r.testValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="sm-actions">
              <button
                type="button"
                className="sm-btn primary"
                disabled={saving || !!nameError || !compiled?.sql || !dirty}
                onClick={() => {
                  if (selected === 'new') setPendingName(draft.name.trim());
                  save(
                    allMeasures,
                    t(
                      'Saved. Charts using this measure pick it up automatically.',
                    ),
                  );
                }}
              >
                {saving ? t('Saving…') : t('Save measure')}
              </button>
              {current && (
                <button
                  type="button"
                  className="sm-btn danger"
                  disabled={saving}
                  onClick={() => {
                    if (
                      // eslint-disable-next-line no-alert
                      window.confirm(
                        t(
                          'Delete measure "%s"? Charts that use it will stop working.',
                          current.name,
                        ),
                      )
                    ) {
                      save(
                        measures.filter((_, i) => i !== selected),
                        t('Measure deleted.'),
                      ).then(() => setSelected('new'));
                    }
                  }}
                >
                  {t('Delete')}
                </button>
              )}
              {dirty && current && (
                <button
                  type="button"
                  className="sm-btn"
                  onClick={() => setDraft(current)}
                >
                  {t('Discard changes')}
                </button>
              )}
            </div>
          </>
        )}
        {msg && (
          <div className={`sm-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>
        )}
      </div>
    </div>
  );
}
