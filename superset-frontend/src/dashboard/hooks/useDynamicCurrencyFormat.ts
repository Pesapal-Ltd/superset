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

export interface DynamicCurrencyResult {
  /**
   * Whether a "Currency" native filter is in scope for this chart.
   * When `false`, the chart should use its own saved currency configuration.
   * When `true`, `symbol` reflects the current filter selection (which may be
   * `null` if the user has not yet chosen a currency or has cleared the filter).
   */
  hasCurrencyFilter: boolean;
  /**
   * The currency code selected in the filter (e.g. `"KSH"`, `"USD"`), or
   * `null` when the filter exists but no selection is active.
   */
  symbol: string | null;
}

/**
 * Returns information about the "Currency" native filter that is in scope for
 * the given chart, so that `Chart.jsx` can dynamically override the chart's
 * `currency_format.symbol`.
 *
 * - `hasCurrencyFilter: false` → no Currency filter targets this chart; leave
 *   the chart's own currency configuration untouched.
 * - `hasCurrencyFilter: true, symbol: "KSH"` → apply the selected currency.
 * - `hasCurrencyFilter: true, symbol: null` → the filter is in scope but
 *   nothing is selected; **suppress** the currency prefix so that "null" is
 *   not rendered.
 *
 * @param chartId  The numeric chart (slice) ID.
 *
 * @example
 * // In Chart.jsx:
 * const { hasCurrencyFilter, symbol } = useDynamicCurrencyFormat(props.id);
 * const finalFormData = useMemo(() => {
 *   if (!hasCurrencyFilter) return formData;
 *   // Clear symbol when filter is present but nothing selected, override otherwise.
 *   const overrideSymbol = symbol ?? undefined;
 *   return {
 *     ...formData,
 *     currency_format: formData.currency_format
 *       ? { ...formData.currency_format, symbol: overrideSymbol }
 *       : formData.currency_format,
 *   };
 * }, [formData, hasCurrencyFilter, symbol]);
 */
export function useDynamicCurrencyFormat(
  chartId: number,
): DynamicCurrencyResult {
  const nativeFilters = useSelector(
    (state: RootState) => state.nativeFilters?.filters,
  );
  const dataMask = useSelector((state: RootState) => state.dataMask);

  return useMemo(() => {
    const NOT_FOUND: DynamicCurrencyResult = {
      hasCurrencyFilter: false,
      symbol: null,
    };

    if (!nativeFilters) return NOT_FOUND;

    for (const nativeFilter of Object.values(nativeFilters)) {
      // Only consider standard native filters (not time grain / dividers).
      if (nativeFilter.type !== NativeFilterType.NativeFilter) continue;

      // Only consider filters that are in scope for this chart.
      if (!nativeFilter.chartsInScope?.includes(chartId)) continue;

      // Match filter named "Currency" (case-insensitive).
      if (nativeFilter.name.toLowerCase() !== 'currency') continue;

      const filterState = dataMask[nativeFilter.id]?.filterState;
      const label = extractLabel(filterState);

      // A Currency filter is in scope. Return its current selection (may be null).
      // If multiple currencies are selected, `label` will be a comma-separated
      // string (e.g. "TZS, USD"). This is an invalid currency format and will
      // crash `Intl.NumberFormat`, so we should also treat this as a cleared/null
      // selection, suppressing the prefix.
      const isValidSymbol = typeof label === 'string' && !label.includes(',');
      return { hasCurrencyFilter: true, symbol: isValidSymbol ? label : null };
    }

    return NOT_FOUND;
  }, [nativeFilters, dataMask, chartId]);
}
