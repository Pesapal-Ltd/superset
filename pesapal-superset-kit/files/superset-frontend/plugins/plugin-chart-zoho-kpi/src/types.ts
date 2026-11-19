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
import { QueryFormData } from '@superset-ui/core';

export type KpiValueMode = 'last' | 'sum' | 'avg';

export type KpiStatus = 'good' | 'bad' | 'neutral';

export type ZohoKpiFormData = QueryFormData & {
  kpiValueMode?: KpiValueMode;
  compareLag?: number | string;
  comparisonLabel?: string;
  lowerIsBetter?: boolean;
  targetValue?: number | string;
  targetLabel?: string;
  kpiTitle?: string;
  subtitle?: string;
  showSparkline?: boolean;
  showTimestamp?: boolean;
};

export interface KpiComparison {
  pct: number | null;
  formattedPct: string;
  formattedPrevious: string;
  label: string;
  status: KpiStatus;
}

export interface KpiTarget {
  formatted: string;
  label: string;
  /** value / target, not capped */
  ratio: number;
  formattedRatio: string;
  status: KpiStatus | 'warning';
}

export interface ZohoKpiProps {
  width: number;
  height: number;
  title: string;
  subtitle?: string;
  formattedValue: string;
  comparison: KpiComparison | null;
  target: KpiTarget | null;
  sparkline: number[];
  showSparkline: boolean;
  accentColor: string;
  timestamp?: string;
}
