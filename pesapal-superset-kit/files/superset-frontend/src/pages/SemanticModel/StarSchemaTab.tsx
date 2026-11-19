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
import {
  createVirtualDataset,
  listDatabases,
  listSchemas,
  listTables,
  refreshDataset,
  runSql,
  tableColumns,
  updateDataset,
} from 'src/features/semantic/api';
import {
  ApiDataset,
  Dimension,
  keyCheckSql,
  StarSchema,
  starSchemaOf,
  starSchemaSql,
} from 'src/features/semantic/model';
import { errorText } from './styles';

interface Props {
  dataset: ApiDataset | null;
  onSaved: (datasetId: number) => void;
  onReload: () => void;
}

const newDim = (i: number): Dimension => ({
  table: '',
  alias: `d${i + 1}`,
  factKey: '',
  dimKey: '',
  columns: [],
  prefix: '',
});

export default function StarSchemaTab({ dataset, onSaved, onReload }: Props) {
  const existing = dataset ? starSchemaOf(dataset) : null;
  const [editing, setEditing] = useState(false);
  const [model, setModel] = useState<StarSchema>(
    existing || {
      name: '',
      databaseId: dataset?.database.id || 0,
      schema: dataset?.schema || '',
      fact: '',
      dimensions: [],
    },
  );
  const [dbs, setDbs] = useState<
    { id: number; database_name: string; backend: string }[]
  >([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [cols, setCols] = useState<Record<string, string[]>>({});
  const [checks, setChecks] = useState<
    Record<number, { ok: boolean; text: string }>
  >({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const m = dataset ? starSchemaOf(dataset) : null;
    setEditing(false);
    setModel(
      m || {
        name: '',
        databaseId: dataset?.database.id || 0,
        schema: dataset?.schema || '',
        fact: '',
        dimensions: [],
      },
    );
  }, [dataset]);

  useEffect(() => {
    if (editing)
      listDatabases()
        .then(setDbs)
        .catch(e => setMsg({ ok: false, text: errorText(e) }));
  }, [editing]);
  useEffect(() => {
    if (editing && model.databaseId)
      listSchemas(model.databaseId)
        .then(setSchemas)
        .catch(() => setSchemas([]));
  }, [editing, model.databaseId]);
  useEffect(() => {
    if (editing && model.databaseId && model.schema)
      listTables(model.databaseId, model.schema)
        .then(setTables)
        .catch(() => setTables([]));
  }, [editing, model.databaseId, model.schema]);

  const loadCols = (table: string) => {
    if (!table || cols[table] || !model.schema) return;
    tableColumns(model.databaseId, model.schema, table)
      .then(c => setCols(prev => ({ ...prev, [table]: c })))
      .catch(() => setCols(prev => ({ ...prev, [table]: [] })));
  };
  const tablesInUse = [model.fact, ...model.dimensions.map(d => d.table)].join(
    '|',
  );
  useEffect(() => {
    if (editing) tablesInUse.split('|').forEach(loadCols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, tablesInUse]);

  const backend =
    dbs.find(d => d.id === model.databaseId)?.backend ||
    dataset?.database.backend ||
    'postgresql';
  const sql = useMemo(
    () => (model.fact ? starSchemaSql(model, backend) : ''),
    [model, backend],
  );
  const setDim = (i: number, patch: Partial<Dimension>) =>
    setModel({
      ...model,
      dimensions: model.dimensions.map((d, j) =>
        j === i ? { ...d, ...patch } : d,
      ),
    });

  const problems = [
    !model.name.trim() && t('Name the model'),
    !model.fact && t('Choose the fact table'),
    ...model.dimensions.map((d, i) =>
      !d.table || !d.factKey || !d.dimKey
        ? t('Dimension %s: choose the table and both join columns', i + 1)
        : !d.columns.length
          ? t('Dimension %s: tick at least one column', i + 1)
          : '',
    ),
  ].filter(Boolean) as string[];

  const checkKeys = async () => {
    const out: Record<number, { ok: boolean; text: string }> = {};
    await Promise.all(
      model.dimensions.map(async (d, i) => {
        try {
          const [r] = await runSql(
            model.databaseId,
            model.schema,
            keyCheckSql(model, d, backend),
          );
          const rows = Number(r?.row_count);
          const keys = Number(r?.key_count);
          out[i] =
            rows === keys
              ? {
                  ok: true,
                  text: t(
                    '%s.%s is unique (%s rows): safe to join',
                    d.table,
                    d.dimKey,
                    rows,
                  ),
                }
              : {
                  ok: false,
                  text: t(
                    '%s.%s is not unique (%s rows, %s keys): the join would duplicate fact rows',
                    d.table,
                    d.dimKey,
                    rows,
                    keys,
                  ),
                };
        } catch (e) {
          out[i] = { ok: false, text: errorText(e) };
        }
      }),
    );
    setChecks(out);
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const isUpdate = !!(dataset && existing);
      let id = dataset?.id || 0;
      if (isUpdate) {
        let extra: Record<string, unknown> = {};
        try {
          extra = JSON.parse(dataset!.extra || '{}');
        } catch (e) {
          extra = {};
        }
        await updateDataset(id, {
          sql,
          extra: JSON.stringify({ ...extra, semantic_model: model }),
        });
      } else {
        id = await createVirtualDataset(model, sql);
        await updateDataset(id, {
          extra: JSON.stringify({ semantic_model: model }),
        });
      }
      await refreshDataset(id);
      setEditing(false);
      setMsg({
        ok: true,
        text: isUpdate
          ? t('Model updated.')
          : t(
              'Model created as dataset "%s". Add measures on the Measures tab.',
              model.name,
            ),
      });
      if (isUpdate) onReload();
      else onSaved(id);
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="sm-card">
        {existing ? (
          <>
            <h3>{t('Star schema: %s', existing.name)}</h3>
            <div className="sm-help">
              {t('Fact table')} <code>{existing.fact}</code>
              {existing.dimensions.map(d => (
                <div key={d.alias}>
                  → <code>{d.table}</code> {t('on')}{' '}
                  <code>
                    {existing.fact}.{d.factKey} = {d.table}.{d.dimKey}
                  </code>{' '}
                  ({d.columns.length} {t('columns as')}{' '}
                  <code>{d.prefix || d.table}__…</code>)
                </div>
              ))}
            </div>
            <pre className="sm-sql">{dataset?.sql}</pre>
          </>
        ) : (
          <>
            <h3>{t('Relationships')}</h3>
            <div className="sm-help">
              {t(
                'Join a fact table (e.g. orders) to dimension tables (customers, products, dates) once. The model becomes a dataset with every field available to charts, and measures can use them, e.g. DISTINCTCOUNT(customers[customer_name]).',
              )}
              {dataset && (
                <p>{t('The selected dataset is not a star-schema model.')}</p>
              )}
            </div>
          </>
        )}
        <div className="sm-actions">
          {existing && (
            <button
              type="button"
              className="sm-btn primary"
              onClick={() => setEditing(true)}
            >
              {t('Edit model')}
            </button>
          )}
          <button
            type="button"
            className={`sm-btn ${existing ? '' : 'primary'}`}
            onClick={() => {
              if (existing)
                setModel({
                  name: '',
                  databaseId: dataset!.database.id,
                  schema: dataset!.schema || '',
                  fact: '',
                  dimensions: [],
                });
              setEditing(true);
            }}
          >
            + {t('New star-schema model')}
          </button>
        </div>
        {msg && (
          <div className={`sm-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>
        )}
      </div>
    );
  }

  const factCols = cols[model.fact] || [];
  return (
    <div className="sm-card">
      <div className="sm-row">
        <div className="sm-field">
          <span>{t('Model name (becomes the dataset name)')}</span>
          <input
            type="text"
            aria-label="Model name"
            value={model.name}
            placeholder="sales_model"
            onChange={e => setModel({ ...model, name: e.target.value })}
          />
        </div>
        <div className="sm-field">
          <span>{t('Database')}</span>
          <select
            aria-label="Database"
            value={model.databaseId || ''}
            onChange={e =>
              setModel({
                ...model,
                databaseId: Number(e.target.value),
                schema: '',
                fact: '',
                dimensions: [],
              })
            }
          >
            <option value="">{t('Choose…')}</option>
            {dbs.map(d => (
              <option key={d.id} value={d.id}>
                {d.database_name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm-field">
          <span>{t('Schema')}</span>
          <select
            aria-label="Schema"
            value={model.schema || ''}
            onChange={e =>
              setModel({
                ...model,
                schema: e.target.value,
                fact: '',
                dimensions: [],
              })
            }
          >
            <option value="">{t('Choose…')}</option>
            {schemas.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="sm-field">
          <span>{t('Fact table')}</span>
          <select
            aria-label="Fact table"
            value={model.fact}
            onChange={e => setModel({ ...model, fact: e.target.value })}
          >
            <option value="">{t('Choose…')}</option>
            {tables.map(tb => (
              <option key={tb} value={tb}>
                {tb}
              </option>
            ))}
          </select>
        </div>
      </div>

      {model.dimensions.map((d, i) => (
        <div key={d.alias} className="sm-card" style={{ marginBottom: 12 }}>
          <div className="sm-row">
            <div className="sm-field">
              <span>{t('Dimension table')}</span>
              <select
                aria-label={`Dimension ${i + 1} table`}
                value={d.table}
                onChange={e =>
                  setDim(i, {
                    table: e.target.value,
                    dimKey: '',
                    columns: [],
                    prefix: e.target.value,
                  })
                }
              >
                <option value="">{t('Choose…')}</option>
                {tables
                  .filter(tb => tb !== model.fact)
                  .map(tb => (
                    <option key={tb} value={tb}>
                      {tb}
                    </option>
                  ))}
              </select>
            </div>
            <div className="sm-field">
              <span>{t('Fact column')}</span>
              <select
                aria-label={`Dimension ${i + 1} fact key`}
                value={d.factKey}
                onChange={e => setDim(i, { factKey: e.target.value })}
              >
                <option value="">{t('Choose…')}</option>
                {factCols.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm-field">
              <span>= {t('dimension column')}</span>
              <select
                aria-label={`Dimension ${i + 1} key`}
                value={d.dimKey}
                onChange={e => setDim(i, { dimKey: e.target.value })}
              >
                <option value="">{t('Choose…')}</option>
                {(cols[d.table] || []).map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm-field" style={{ maxWidth: 160 }}>
              <span>{t('Prefix')}</span>
              <input
                type="text"
                value={d.prefix}
                onChange={e =>
                  setDim(i, {
                    prefix: e.target.value.replace(/[^A-Za-z0-9_]/g, ''),
                  })
                }
              />
            </div>
          </div>
          <div className="sm-help">{t('Columns to bring in')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
            {(cols[d.table] || [])
              .filter(c => c !== d.dimKey)
              .map(c => (
                // eslint-disable-next-line jsx-a11y/label-has-associated-control
                <label
                  key={c}
                  style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                >
                  <input
                    type="checkbox"
                    checked={d.columns.includes(c)}
                    onChange={e =>
                      setDim(i, {
                        columns: e.target.checked
                          ? [...d.columns, c]
                          : d.columns.filter(x => x !== c),
                      })
                    }
                  />
                  {c}
                </label>
              ))}
          </div>
          {checks[i] && (
            <div className={checks[i].ok ? 'sm-ok' : 'sm-err'}>
              {checks[i].ok ? '✓' : '⚠'} {checks[i].text}
            </div>
          )}
          <div className="sm-actions">
            <button
              type="button"
              className="sm-btn danger"
              onClick={() =>
                setModel({
                  ...model,
                  dimensions: model.dimensions.filter((_, j) => j !== i),
                })
              }
            >
              {t('Remove dimension')}
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="sm-btn"
        disabled={!model.fact}
        onClick={() =>
          setModel({
            ...model,
            dimensions: [
              ...model.dimensions,
              newDim(
                Math.max(
                  -1,
                  ...model.dimensions.map(d => Number(d.alias.slice(1)) - 1),
                ) + 1,
              ),
            ],
          })
        }
      >
        + {t('Add dimension')}
      </button>
      {sql && (
        <details open>
          <summary>{t('Generated SQL')}</summary>
          <pre className="sm-sql">{sql}</pre>
        </details>
      )}
      {problems.length > 0 && (
        <div className="sm-help">{problems.join(' · ')}</div>
      )}
      <div className="sm-actions">
        <button
          type="button"
          className="sm-btn"
          disabled={!model.dimensions.length || problems.length > 0}
          onClick={checkKeys}
        >
          {t('Check join keys')}
        </button>
        <button
          type="button"
          className="sm-btn primary"
          disabled={saving || problems.length > 0}
          onClick={save}
        >
          {saving
            ? t('Saving…')
            : existing && dataset
              ? t('Update model')
              : t('Create model')}
        </button>
        <button
          type="button"
          className="sm-btn"
          onClick={() => setEditing(false)}
        >
          {t('Cancel')}
        </button>
      </div>
      {msg && (
        <div className={`sm-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>
      )}
    </div>
  );
}
