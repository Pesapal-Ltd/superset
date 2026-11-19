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
import { ChartProps, supersetTheme } from '@superset-ui/core';
import transformProps from '../src/plugin/transformProps';
import buildQuery from '../src/plugin/buildQuery';
import {
  changeStatus,
  computeKpi,
  percentChange,
  targetStatus,
} from '../src/utils';

describe('computeKpi', () => {
  test('latest value and previous with lag', () => {
    expect(computeKpi([1, 2, 3, 4], 'last', 1)).toMatchObject({
      value: 4,
      previous: 3,
    });
    expect(computeKpi([1, 2, 3, 4], 'last', 3)).toMatchObject({
      value: 4,
      previous: 1,
    });
  });
  test('skips trailing nulls', () => {
    expect(computeKpi([1, 2, null], 'last', 1)).toMatchObject({
      value: 2,
      previous: 1,
      currentIndex: 1,
    });
  });
  test('sum and avg', () => {
    expect(computeKpi([1, 2, 3], 'sum').value).toBe(6);
    expect(computeKpi([1, 2, 3], 'avg').value).toBe(2);
  });
  test('empty', () => {
    expect(computeKpi([]).value).toBeNull();
  });
});

test('percentChange and statuses', () => {
  expect(percentChange(110, 100)).toBeCloseTo(0.1);
  expect(percentChange(5, 0)).toBeNull();
  expect(changeStatus(0.1)).toBe('good');
  expect(changeStatus(0.1, true)).toBe('bad');
  expect(changeStatus(-0.1, true)).toBe('good');
  expect(targetStatus(100, 100)).toBe('good');
  expect(targetStatus(95, 100)).toBe('warning');
  expect(targetStatus(50, 100)).toBe('bad');
  expect(targetStatus(80, 100, true)).toBe('good');
});

describe('Zoho KPI transformProps', () => {
  const formData = {
    datasource: '1__table',
    viz_type: 'zoho_kpi',
    metric: 'sum__revenue',
    x_axis: 'ds',
    time_grain_sqla: 'P1M',
    target_value: '200',
    y_axis_format: ',d',
  };
  const chartProps = new ChartProps({
    formData,
    width: 300,
    height: 200,
    theme: supersetTheme,
    queriesData: [
      {
        data: [
          { ds: 1, sum__revenue: 100 },
          { ds: 2, sum__revenue: 150 },
          { ds: 3, sum__revenue: 180 },
        ],
      },
    ],
  });

  test('builds headline, comparison, target and sparkline', () => {
    const props = transformProps(chartProps);
    expect(props.formattedValue).toBe('180');
    expect(props.comparison?.formattedPct).toBe('+20.0%');
    expect(props.comparison?.status).toBe('good');
    expect(props.target?.formattedRatio).toBe('90%');
    expect(props.target?.status).toBe('warning');
    expect(props.sparkline).toEqual([100, 150, 180]);
    expect(props.showSparkline).toBe(true);
    expect(props.title).toBe('sum__revenue');
  });

  test('buildQuery groups by time column', () => {
    const q = buildQuery(formData as any).queries[0];
    expect(q.metrics).toEqual(['sum__revenue']);
    expect(q.columns?.length).toBe(1);
  });
});
