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
import { NativeFilterType } from '@superset-ui/core';
import { renderHook } from '@testing-library/react-hooks';
import { useDynamicCurrencyFormat } from './useDynamicCurrencyFormat';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildState = ({
    filters = {},
    dataMask = {},
}: {
    filters?: Record<string, any>;
    dataMask?: Record<string, any>;
}) => ({
    nativeFilters: { filters },
    dataMask,
});

function renderCurrencyHook(
    chartId: number,
    stateOverrides: {
        filters?: Record<string, any>;
        dataMask?: Record<string, any>;
    } = {},
) {
    const state = buildState(stateOverrides);
    const { result } = renderHook(() => useDynamicCurrencyFormat(chartId), {
        wrapper: ({ children }: { children: React.ReactNode }) => {
            const { Provider } = require('react-redux');
            const { createStore } = require('redux');
            const store = createStore(() => state);
            return <Provider store={store}>{children}</Provider>;
        },
    });
    return result.current;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDynamicCurrencyFormat', () => {
    const CHART_ID = 42;

    test('returns null when there are no native filters', () => {
        const result = renderCurrencyHook(CHART_ID, {
            filters: {},
            dataMask: {},
        });
        expect(result).toEqual({ hasCurrencyFilter: false, symbol: null });
    });

    test('returns the selected currency symbol when the Currency filter is in scope and has a value', () => {
        const result = renderCurrencyHook(CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Currency',
                    type: NativeFilterType.NativeFilter,
                    chartsInScope: [CHART_ID],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: ['KES'], label: 'KES' } },
            },
        });
        expect(result).toEqual({ hasCurrencyFilter: true, symbol: 'KES' });
    });

    test('returns null when the Currency filter is in scope but has no value (cleared)', () => {
        const result = renderCurrencyHook(CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Currency',
                    type: NativeFilterType.NativeFilter,
                    chartsInScope: [CHART_ID],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: null } },
            },
        });
        expect(result).toEqual({ hasCurrencyFilter: true, symbol: null });
    });

    test('matches the Currency filter name case-insensitively', () => {
        const result = renderCurrencyHook(CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'currency', // lowercase
                    type: NativeFilterType.NativeFilter,
                    chartsInScope: [CHART_ID],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: ['USD'], label: 'USD' } },
            },
        });
        expect(result).toEqual({ hasCurrencyFilter: true, symbol: 'USD' });
    });

    test('returns null when the Currency filter is not in scope for this chart', () => {
        const result = renderCurrencyHook(CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Currency',
                    type: NativeFilterType.NativeFilter,
                    chartsInScope: [99], // different chart
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: ['KES'], label: 'KES' } },
            },
        });
        expect(result).toEqual({ hasCurrencyFilter: false, symbol: null });
    });

    test('returns null for a non-Currency filter even if it is in scope', () => {
        const result = renderCurrencyHook(CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Country', // not "Currency"
                    type: NativeFilterType.NativeFilter,
                    chartsInScope: [CHART_ID],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: ['Kenya'], label: 'Kenya' } },
            },
        });
        expect(result).toEqual({ hasCurrencyFilter: false, symbol: null });
    });

    test('ignores filters that are not NativeFilterType.NativeFilter', () => {
        const result = renderCurrencyHook(CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Currency',
                    type: NativeFilterType.Divider, // not a real filter
                    chartsInScope: [CHART_ID],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: ['KES'], label: 'KES' } },
            },
        });
        expect(result).toEqual({ hasCurrencyFilter: false, symbol: null });
    });

    test('returns the value from the correct Currency filter when multiple filters exist', () => {
        const result = renderCurrencyHook(CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Country',
                    type: NativeFilterType.NativeFilter,
                    chartsInScope: [CHART_ID],
                },
                'NATIVE_FILTER-2': {
                    id: 'NATIVE_FILTER-2',
                    name: 'Currency',
                    type: NativeFilterType.NativeFilter,
                    chartsInScope: [CHART_ID],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: ['Kenya'], label: 'Kenya' } },
                'NATIVE_FILTER-2': { filterState: { value: ['KES'], label: 'KES' } },
            },
        });
        expect(result).toEqual({ hasCurrencyFilter: true, symbol: 'KES' });
    });

    test('returns null when multiple currencies are selected', () => {
        const result = renderCurrencyHook(CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Currency',
                    type: NativeFilterType.NativeFilter,
                    chartsInScope: [CHART_ID],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: ['TZS', 'USD'], label: 'TZS, USD' } },
            },
        });
        expect(result).toEqual({ hasCurrencyFilter: true, symbol: null });
    });
});
