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
/** Superset REST calls used by the Semantic Model page. */
import { SupersetClient } from '@superset-ui/core';
import rison from 'rison';
import { ApiColumn, ApiDataset, ApiMetric, StarSchema } from './model';

export interface DatasetListItem {
  id: number;
  table_name: string;
  schema?: string;
  kind?: string;
  database?: { database_name?: string };
}

export async function listDatasets(search = ''): Promise<DatasetListItem[]> {
  const q = rison.encode({
    columns: ['id', 'table_name', 'schema', 'kind', 'database.database_name'],
    filters: search ? [{ col: 'table_name', opr: 'ct', value: search }] : [],
    order_column: 'table_name',
    order_direction: 'asc',
    page_size: 100,
  });
  const { json } = await SupersetClient.get({
    endpoint: `/api/v1/dataset/?q=${q}`,
  });
  return json.result;
}

export async function getDataset(id: number): Promise<ApiDataset> {
  const { json } = await SupersetClient.get({
    endpoint: `/api/v1/dataset/${id}`,
  });
  return { ...json.result, id };
}

export async function updateDataset(
  id: number,
  body: Partial<{
    metrics: ApiMetric[];
    columns: ApiColumn[];
    sql: string;
    extra: string;
  }>,
) {
  await SupersetClient.put({
    endpoint: `/api/v1/dataset/${id}`,
    jsonPayload: body,
  });
}

export async function refreshDataset(id: number) {
  await SupersetClient.put({ endpoint: `/api/v1/dataset/${id}/refresh` });
}

export async function createVirtualDataset(
  model: StarSchema,
  sql: string,
): Promise<number> {
  const { json } = await SupersetClient.post({
    endpoint: '/api/v1/dataset/',
    jsonPayload: {
      database: model.databaseId,
      schema: model.schema || null,
      table_name: model.name,
      sql,
    },
  });
  return json.id;
}

export async function listDatabases(): Promise<
  { id: number; database_name: string; backend: string }[]
> {
  const q = rison.encode({
    columns: ['id', 'database_name', 'backend'],
    page_size: 100,
  });
  const { json } = await SupersetClient.get({
    endpoint: `/api/v1/database/?q=${q}`,
  });
  return json.result;
}

export async function listSchemas(dbId: number): Promise<string[]> {
  const { json } = await SupersetClient.get({
    endpoint: `/api/v1/database/${dbId}/schemas/`,
  });
  return json.result;
}

export async function listTables(
  dbId: number,
  schema: string,
): Promise<string[]> {
  const q = rison.encode({ schema_name: schema, force: false });
  const { json } = await SupersetClient.get({
    endpoint: `/api/v1/database/${dbId}/tables/?q=${q}`,
  });
  return (json.result || []).map((t: { value: string }) => t.value);
}

export async function tableColumns(
  dbId: number,
  schema: string,
  table: string,
): Promise<string[]> {
  const params = new URLSearchParams({ name: table, schema });
  const { json } = await SupersetClient.get({
    endpoint: `/api/v1/database/${dbId}/table_metadata/?${params}`,
  });
  return (json.columns || []).map((c: { name: string }) => c.name);
}

/** Run a query through SQL Lab (used for the key check). */
export async function runSql(
  dbId: number,
  schema: string | null | undefined,
  sql: string,
) {
  const { json } = await SupersetClient.post({
    endpoint: '/api/v1/sqllab/execute/',
    jsonPayload: {
      database_id: dbId,
      schema: schema || null,
      sql,
      runAsync: false,
      json: true,
      client_id: Math.random().toString(36).slice(2, 12),
      queryLimit: 10,
      tab: 'Semantic model check',
      select_as_cta: false,
      expand_data: true,
    },
  });
  return (json.data || []) as Record<string, unknown>[];
}

export interface TestOptions {
  datasetId: number;
  label: string;
  sql: string;
  /** group by this column (or nothing for a single total) */
  by?: string;
  /** time grain when grouping by a date column */
  grain?: string;
  /** what-if parameter values to test with */
  params?: Record<string, number>;
}

/** Evaluate a compiled measure through the normal chart data API. */
export async function testMeasure(o: TestOptions) {
  const columns = o.by
    ? [
        o.grain
          ? {
              columnType: 'BASE_AXIS',
              sqlExpression: o.by,
              label: o.by,
              expressionType: 'SQL',
              timeGrain: o.grain,
            }
          : o.by,
      ]
    : [];
  const { json } = await SupersetClient.post({
    endpoint: '/api/v1/chart/data',
    jsonPayload: {
      datasource: { id: o.datasetId, type: 'table' },
      force: true,
      result_format: 'json',
      result_type: 'full',
      queries: [
        {
          columns,
          metrics: [
            { expressionType: 'SQL', sqlExpression: o.sql, label: o.label },
          ],
          filters: Object.entries(o.params || {}).map(([col, val]) => ({
            col,
            op: '==',
            val,
          })),
          extras: o.grain ? { time_grain_sqla: o.grain } : {},
          row_limit: 100,
        },
      ],
    },
  });
  const r = json.result?.[0] || {};
  return {
    rows: (r.data || []) as Record<string, unknown>[],
    query: r.query as string | undefined,
  };
}
