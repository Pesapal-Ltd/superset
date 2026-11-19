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
import {
  AdhocColumn,
  buildQueryContext,
  ensureIsArray,
  isPhysicalColumn,
  QueryFormColumn,
  QueryFormData,
} from '@superset-ui/core';
import { optionQueries, withViewerFilters } from '../viewerFilters';

/** Group by rows + columns; apply the time grain to temporal columns. */
export default function buildQuery(
  formData: QueryFormData,
  options?: { ownState?: Record<string, any> },
) {
  const { groupbyColumns = [], groupbyRows = [], extra_form_data } = formData;
  const timeGrain =
    extra_form_data?.time_grain_sqla || formData.time_grain_sqla;

  const columns = Array.from(
    new Set([
      ...ensureIsArray<QueryFormColumn>(groupbyRows),
      ...ensureIsArray<QueryFormColumn>(groupbyColumns),
    ]),
  ).map(col => {
    if (
      isPhysicalColumn(col) &&
      timeGrain &&
      (formData?.temporal_columns_lookup?.[col] ||
        formData.granularity_sqla === col)
    ) {
      return {
        timeGrain,
        columnType: 'BASE_AXIS',
        sqlExpression: col,
        label: col,
        expressionType: 'SQL',
      } as AdhocColumn;
    }
    return col;
  });

  return buildQueryContext(formData, baseQueryObject => [
    withViewerFilters(
      { ...baseQueryObject, columns, orderby: [] },
      formData,
      options?.ownState,
    ),
    // value lists for the viewer filter dropdowns
    ...optionQueries(baseQueryObject, formData),
  ]);
}
