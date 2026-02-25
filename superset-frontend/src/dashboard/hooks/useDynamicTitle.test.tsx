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
import { useDynamicTitle } from './useDynamicTitle';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Redux store state for the hook. */
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

/** Wrap renderHook with a mock Redux store. */
function renderDynamicTitleHook(
    titleTemplate: string,
    chartId: number,
    stateOverrides: { filters?: Record<string, any>; dataMask?: Record<string, any> } = {},
) {
    const state = buildState(stateOverrides);
    const { result } = renderHook(
        () => useDynamicTitle(titleTemplate, chartId),
        {
            wrapper: ({ children }: { children: React.ReactNode }) => {
                const { Provider } = require('react-redux');
                const { createStore } = require('redux');
                const store = createStore(() => state);
                return <Provider store={store}>{children}</Provider>;
            },
        },
    );
    return result.current;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDynamicTitle', () => {
    const CHART_ID = 42;

    test('returns a plain title unchanged when there are no placeholders', () => {
        const result = renderDynamicTitleHook('Total Revenue', CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Country',
                    type: NativeFilterType.NativeFilter,
                    chartsInScope: [CHART_ID],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: ['Kenya'], label: 'Kenya' } },
            },
        });
        expect(result).toBe('Total Revenue');
    });

    test('replaces placeholder with the filter value when filter is in scope and has a value', () => {
        const result = renderDynamicTitleHook('Sales in {Country}', CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Country',
                    type: NativeFilterType.NativeFilter,
                    chartsInScope: [CHART_ID],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: ['Kenya'], label: 'Kenya' } },
            },
        });
        expect(result).toBe('Sales in Kenya');
    });

    test('uses bracket notation when filter is in scope but has no value', () => {
        const result = renderDynamicTitleHook('Sales in {Country}', CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Country',
                    type: NativeFilterType.NativeFilter,
                    chartsInScope: [CHART_ID],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: null } },
            },
        });
        expect(result).toBe('Sales in [Country]');
    });

    test('leaves placeholder unchanged when filter is not in scope for this chart', () => {
        const result = renderDynamicTitleHook('Sales in {Country}', CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Country',
                    type: NativeFilterType.NativeFilter,
                    // Chart 99, not CHART_ID
                    chartsInScope: [99],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: ['Kenya'], label: 'Kenya' } },
            },
        });
        expect(result).toBe('Sales in {Country}');
    });

    test('ignores filters that are not NativeFilterType.NativeFilter', () => {
        const result = renderDynamicTitleHook('Sales in {Country}', CHART_ID, {
            filters: {
                'NATIVE_FILTER-1': {
                    id: 'NATIVE_FILTER-1',
                    name: 'Country',
                    type: NativeFilterType.Divider, // not a real filter
                    chartsInScope: [CHART_ID],
                },
            },
            dataMask: {
                'NATIVE_FILTER-1': { filterState: { value: ['Kenya'], label: 'Kenya' } },
            },
        });
        expect(result).toBe('Sales in {Country}');
    });

    test('resolves multiple placeholders from different filters', () => {
        const result = renderDynamicTitleHook(
            '{Region} - {Year} Revenue',
            CHART_ID,
            {
                filters: {
                    'NATIVE_FILTER-1': {
                        id: 'NATIVE_FILTER-1',
                        name: 'Region',
                        type: NativeFilterType.NativeFilter,
                        chartsInScope: [CHART_ID],
                    },
                    'NATIVE_FILTER-2': {
                        id: 'NATIVE_FILTER-2',
                        name: 'Year',
                        type: NativeFilterType.NativeFilter,
                        chartsInScope: [CHART_ID],
                    },
                },
                dataMask: {
                    'NATIVE_FILTER-1': {
                        filterState: { value: ['East Africa'], label: 'East Africa' },
                    },
                    'NATIVE_FILTER-2': {
                        filterState: { value: ['2024'], label: '2024' },
                    },
                },
            },
        );
        expect(result).toBe('East Africa - 2024 Revenue');
    });

    test('returns the template unchanged when nativeFilters state is empty', () => {
        const result = renderDynamicTitleHook('Sales in {Country}', CHART_ID, {
            filters: {},
            dataMask: {},
        });
        expect(result).toBe('Sales in {Country}');
    });
});
