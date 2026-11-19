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
import { ChartProps, QueryFormData } from '@superset-ui/core';
import {
  activeSelection,
  FilterSelection,
  parseFilterFields,
} from '../viewerFilters';
import { HtmlContentFormData, HtmlContentProps } from '../types';
import { Row } from '../template';
import { DEFAULT_PAGE } from '../page';

export default function transformProps(
  chartProps: ChartProps,
): HtmlContentProps {
  const {
    width,
    height,
    queriesData,
    rawFormData,
    hooks,
    ownState,
    datasource,
  } = chartProps;
  const inExplore =
    typeof window !== 'undefined' &&
    /\/explore\b/.test(window.location?.pathname || '');
  const filterSelection = activeSelection(
    rawFormData as QueryFormData,
    ownState,
  );
  const applyFilters = (next: FilterSelection) => {
    hooks?.setDataMask?.({
      ownState: { ...(ownState || {}), viewerFilters: next },
    });
    if (inExplore) hooks?.setControlValue?.('viewer_filter_defaults', next);
  };
  const formData = chartProps.formData as HtmlContentFormData;
  const result = queriesData?.[0] || {};
  return {
    width,
    height,
    rows: (result.data || []) as Row[],
    columns: (result.colnames || []) as string[],
    headerTemplate: formData.headerTemplate || '',
    rowTemplate: formData.rowTemplate || '',
    footerTemplate: formData.footerTemplate || '',
    customCss: formData.cssStyles || '',
    renderMode: formData.renderMode === 'template' ? 'template' : 'page',
    htmlPage: formData.htmlPage ?? DEFAULT_PAGE,
    filterFields: parseFilterFields(
      rawFormData as QueryFormData,
      (queriesData || []) as any,
      1,
      ((datasource as any)?.verboseMap || {}) as Record<string, string>,
    ),
    filterSelection,
    applyFilters,
  };
}
