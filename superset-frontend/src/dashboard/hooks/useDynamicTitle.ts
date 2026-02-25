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
import { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { NativeFilterType } from '@superset-ui/core';
import { RootState } from 'src/dashboard/types';
import { extractLabel } from 'src/dashboard/components/nativeFilters/selectors';
import { interpolateDynamicTitle } from 'src/dashboard/util/interpolateDynamicTitle';

/**
 * Resolves `{FilterName}` placeholders in a chart title template against the
 * currently active native filter values that are in scope for the given chart.
 *
 * - If a matching filter has a value, the placeholder is replaced with that value.
 * - If a matching filter has no value, the placeholder is rendered as `[FilterName]`.
 * - Placeholders that don't match any in-scope filter are left unchanged.
 * - Titles without any `{…}` placeholders are returned immediately (no overhead).
 *
 * @param titleTemplate The raw title string configured by the user.
 * @param chartId       The numeric chart ID used to check filter scope.
 * @returns The resolved display title.
 */
export function useDynamicTitle(
    titleTemplate: string,
    chartId: number,
): string {
    const nativeFilters = useSelector(
        (state: RootState) => state.nativeFilters?.filters,
    );
    const dataMask = useSelector((state: RootState) => state.dataMask);

    const filterValues = useMemo((): Record<string, string | null> => {
        // Fast path: if there are no placeholders, skip Redux work entirely.
        if (!titleTemplate.includes('{')) return {};

        if (!nativeFilters) return {};

        const values: Record<string, string | null> = {};

        Object.values(nativeFilters).forEach(nativeFilter => {
            // Only consider standard native filters (not time grain / dividers).
            if (nativeFilter.type !== NativeFilterType.NativeFilter) return;

            // Only consider filters that are in scope for this chart.
            if (!nativeFilter.chartsInScope?.includes(chartId)) return;

            const filterState = dataMask[nativeFilter.id]?.filterState;
            const label = extractLabel(filterState);

            values[nativeFilter.name] = label;
        });

        return values;
    }, [titleTemplate, nativeFilters, dataMask, chartId]);

    return useMemo(
        () => interpolateDynamicTitle(titleTemplate, filterValues),
        [titleTemplate, filterValues],
    );
}
