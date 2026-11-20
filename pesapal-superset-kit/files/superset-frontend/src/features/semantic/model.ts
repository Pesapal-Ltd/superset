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
/**
 * Semantic model helpers: turn a Superset dataset into a DAX model, and
 * build the payloads that save measures / parameters / star schemas back.
 * Everything is stored on the dataset itself:
 *   - DAX measures  -> dataset metrics (compiled SQL), source in metric.extra.dax
 *   - parameters    -> calculated columns whatif_*, settings in column.extra.whatif
 *   - star schema   -> virtual dataset SQL, definition in dataset.extra.semantic_model
 */
import { compileMeasure, Model, ModelParameter } from './dax';

export interface ApiColumn {
  id?: number;
  column_name: string;
  type?: string | null;
  advanced_data_type?: string | null;
  verbose_name?: string | null;
  description?: string | null;
  expression?: string | null;
  extra?: string | null;
  filterable?: boolean;
  groupby?: boolean;
  is_active?: boolean | null;
  is_dttm?: boolean | null;
  python_date_format?: string | null;
  uuid?: string | null;
}

export interface ApiMetric {
  id?: number;
  metric_name: string;
  expression: string;
  verbose_name?: string | null;
  description?: string | null;
  d3format?: string | null;
  currency?: unknown;
  extra?: string | null;
  metric_type?: string | null;
  warning_text?: string | null;
  uuid?: string | null;
}

export interface ApiDataset {
  id: number;
  table_name: string;
  schema?: string | null;
  sql?: string | null;
  extra?: string | null;
  kind?: string;
  database: { id: number; backend?: string; database_name?: string };
  columns: ApiColumn[];
  metrics: ApiMetric[];
}

export interface Measure {
  name: string;
  formula: string;
  format?: string | null;
  description?: string | null;
  /** metric id when it already exists */
  id?: number;
  /** a plain SQL metric (not DAX) */
  sqlOnly?: boolean;
  sql?: string;
}

export interface Parameter extends ModelParameter {
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

export interface Dimension {
  table: string;
  schema?: string | null;
  alias: string;
  factKey: string;
  dimKey: string;
  columns: string[];
  /** prefix for exposed columns, e.g. customers -> customers__city */
  prefix: string;
}

export interface StarSchema {
  name: string;
  databaseId: number;
  schema?: string | null;
  fact: string;
  dimensions: Dimension[];
}

const parseJson = (s?: string | null): Record<string, any> => {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
};

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/%/g, ' pct ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'param';

export const dialectOf = (ds: ApiDataset) =>
  (ds.database?.backend || 'postgresql').toLowerCase();

export function measuresOf(ds: ApiDataset): Measure[] {
  return ds.metrics.map(m => {
    const extra = parseJson(m.extra);
    if (typeof extra.dax === 'string') {
      return {
        id: m.id,
        name: m.verbose_name || m.metric_name,
        formula: extra.dax,
        format: m.d3format,
        description: m.description,
        sql: m.expression,
      };
    }
    return {
      id: m.id,
      name: m.verbose_name || m.metric_name,
      formula: '',
      format: m.d3format,
      description: m.description,
      sqlOnly: true,
      sql: m.expression,
    };
  });
}

export function parametersOf(ds: ApiDataset): Parameter[] {
  return ds.columns
    .map(c => ({ c, w: parseJson(c.extra).whatif }))
    .filter(({ w }) => w && typeof w === 'object')
    .map(({ c, w }) => ({
      name: String(w.name || c.verbose_name || c.column_name),
      column: c.column_name,
      default: Number(w.default) || 0,
      min: Number(w.min ?? 0),
      max: Number(w.max ?? 100),
      step: Number(w.step ?? 1),
      suffix: w.suffix || '',
    }));
}

export function starSchemaOf(ds: ApiDataset): StarSchema | null {
  const m = parseJson(ds.extra).semantic_model;
  return m && typeof m === 'object' ? (m as StarSchema) : null;
}

/** The DAX model: columns, measures and parameters of a dataset. */
export function buildModel(
  ds: ApiDataset,
  measures: Measure[],
  params: Parameter[],
): Model {
  return {
    dialect: dialectOf(ds),
    columns: ds.columns.map(c => ({
      name: c.column_name,
      expression:
        c.expression && !parseJson(c.extra).whatif ? c.expression : null,
      isDate: !!c.is_dttm,
    })),
    measures: Object.fromEntries(
      measures.filter(m => !m.sqlOnly).map(m => [m.name, m.formula]),
    ),
    parameters: params,
  };
}

const METRIC_KEYS: (keyof ApiMetric)[] = [
  'id',
  'metric_name',
  'expression',
  'verbose_name',
  'description',
  'd3format',
  'currency',
  'extra',
  'metric_type',
  'warning_text',
  'uuid',
];
const COLUMN_KEYS: (keyof ApiColumn)[] = [
  'id',
  'column_name',
  'type',
  'advanced_data_type',
  'verbose_name',
  'description',
  'expression',
  'extra',
  'filterable',
  'groupby',
  'is_active',
  'is_dttm',
  'python_date_format',
  'uuid',
];
const pick = <T extends object>(o: T, keys: (keyof T)[]) =>
  Object.fromEntries(
    keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]),
  ) as Partial<T>;

export const cleanMetric = (m: ApiMetric) => pick(m, METRIC_KEYS) as ApiMetric;
export const cleanColumn = (c: ApiColumn) => pick(c, COLUMN_KEYS) as ApiColumn;

/**
 * Metrics payload: every DAX measure recompiled (so measures that use an
 * edited measure update too); plain SQL metrics are kept as they are.
 */
export function metricsPayload(
  ds: ApiDataset,
  measures: Measure[],
  params: Parameter[],
): { metrics: ApiMetric[]; errors: Record<string, string> } {
  const model = buildModel(ds, measures, params);
  const errors: Record<string, string> = {};
  const byId = new Map(ds.metrics.map(m => [m.id, m]));
  const metrics: ApiMetric[] = [];
  measures.forEach(m => {
    const existing = m.id !== undefined ? byId.get(m.id) : undefined;
    if (m.sqlOnly) {
      if (existing) metrics.push(cleanMetric(existing));
      return;
    }
    let sql = '';
    try {
      ({ sql } = compileMeasure(`${m.name} := ${m.formula}`, model));
    } catch (e) {
      errors[m.name] = (e as Error).message;
      return;
    }
    const extra = { ...parseJson(existing?.extra), dax: m.formula };
    metrics.push(
      cleanMetric({
        ...(existing || {}),
        id: existing?.id,
        metric_name: m.name,
        verbose_name: m.name,
        expression: sql,
        d3format: m.format || null,
        description: m.description || null,
        extra: JSON.stringify(extra),
      }),
    );
  });
  return { metrics, errors };
}

export const paramExpression = (p: Pick<Parameter, 'column' | 'default'>) =>
  `{{ dax_num(filter_values(${JSON.stringify(p.column)}), ${Number(p.default) || 0}) }}`;

/** Columns payload: existing columns unchanged, what-if columns rebuilt. */
export function columnsPayload(
  ds: ApiDataset,
  params: Parameter[],
): ApiColumn[] {
  const isParam = (c: ApiColumn) => !!parseJson(c.extra).whatif;
  const kept = ds.columns.filter(c => !isParam(c)).map(cleanColumn);
  const existing = new Map(
    ds.columns.filter(isParam).map(c => [c.column_name, c]),
  );
  const paramCols = params.map(p =>
    cleanColumn({
      id: existing.get(p.column)?.id,
      column_name: p.column,
      verbose_name: p.name,
      type: 'NUMERIC',
      expression: paramExpression(p),
      filterable: true,
      groupby: false,
      is_dttm: false,
      description: `What-if parameter (${p.min} to ${p.max}, step ${p.step})`,
      extra: JSON.stringify({
        whatif: {
          name: p.name,
          min: p.min,
          max: p.max,
          step: p.step,
          default: p.default,
          suffix: p.suffix || '',
        },
      }),
    }),
  );
  return [...kept, ...paramCols];
}

// ---------------------------------------------------------------- star schema

export function quoter(backend: string) {
  const b = backend.toLowerCase();
  if (
    b === 'mysql' ||
    b === 'mariadb' ||
    b === 'bigquery' ||
    b === 'databricks' ||
    b === 'hive'
  ) {
    return (s: string) => `\`${s.replace(/`/g, '``')}\``;
  }
  if (b === 'mssql') return (s: string) => `[${s.replace(/]/g, ']]')}]`;
  return (s: string) => `"${s.replace(/"/g, '""')}"`;
}

/** SQL for a virtual dataset: the fact table LEFT JOINed to its dimensions. */
export function starSchemaSql(model: StarSchema, backend: string): string {
  const q = quoter(backend);
  const tbl = (schema: string | null | undefined, table: string) =>
    schema ? `${q(schema)}.${q(table)}` : q(table);
  const select = ['f.*'];
  const joins: string[] = [];
  model.dimensions.forEach((d, i) => {
    const alias = d.alias || `d${i + 1}`;
    d.columns.forEach(c =>
      select.push(`${alias}.${q(c)} AS ${q(`${d.prefix || d.table}__${c}`)}`),
    );
    joins.push(
      `LEFT JOIN ${tbl(d.schema ?? model.schema, d.table)} AS ${alias}\n  ON f.${q(d.factKey)} = ${alias}.${q(d.dimKey)}`,
    );
  });
  return [
    `SELECT\n  ${select.join(',\n  ')}`,
    `FROM ${tbl(model.schema, model.fact)} AS f`,
    ...joins,
  ].join('\n');
}

/** A query that shows whether a dimension key is unique (many-to-one join). */
export function keyCheckSql(
  model: StarSchema,
  d: Dimension,
  backend: string,
): string {
  const q = quoter(backend);
  const t =
    (d.schema ?? model.schema)
      ? `${q((d.schema ?? model.schema)!)}.${q(d.table)}`
      : q(d.table);
  return `SELECT COUNT(*) AS row_count, COUNT(DISTINCT ${q(d.dimKey)}) AS key_count FROM ${t}`;
}
