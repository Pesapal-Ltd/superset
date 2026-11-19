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
  buildQueryContext,
  ensureIsArray,
  getMetricLabel,
  QueryFormData,
  QueryFormOrderBy,
} from '@superset-ui/core';
import { optionQueries, withViewerFilters } from '../viewerFilters';

export default function buildQuery(
  formData: QueryFormData,
  options?: { ownState?: Record<string, any> },
) {
  const {
    query_mode: queryMode,
    all_columns: allColumns,
    timeseries_limit_metric: sortBy,
    order_desc: orderDesc = true,
  } = formData;
  const isRaw = queryMode === 'raw';

  return buildQueryContext(formData, baseQueryObject => {
    // main query + one small query per viewer filter field (value lists)
    const finish = (main: typeof baseQueryObject) => [
      withViewerFilters(main, formData, options?.ownState),
      ...optionQueries(baseQueryObject, formData),
    ];
    if (isRaw) {
      return finish({
        ...baseQueryObject,
        columns: ensureIsArray(allColumns),
        metrics: undefined,
        orderby: [],
      });
    }
    let metrics = ensureIsArray(baseQueryObject.metrics);
    if (!metrics.length && !ensureIsArray(baseQueryObject.columns).length) {
      // nothing picked yet: still return something so the page can render
      metrics = [
        {
          expressionType: 'SQL',
          sqlExpression: 'COUNT(*)',
          label: 'count',
        },
      ];
    }
    const sortMetric = ensureIsArray(sortBy)[0] ?? metrics[0];
    const orderby: QueryFormOrderBy[] = sortMetric
      ? [[sortMetric, !orderDesc]]
      : [];
    // make sure the sort metric is fetched
    const withSort =
      sortMetric &&
      !metrics.some(m => getMetricLabel(m) === getMetricLabel(sortMetric))
        ? [...metrics, sortMetric]
        : metrics;
    return finish({
      ...baseQueryObject,
      metrics: withSort,
      orderby,
    });
  });
}
