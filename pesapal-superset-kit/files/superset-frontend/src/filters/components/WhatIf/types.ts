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
import { RefObject } from 'react';
import {
  Behavior,
  DataRecord,
  FilterState,
  QueryFormData,
} from '@superset-ui/core';
import { PluginFilterHooks, PluginFilterStylesProps } from '../types';

export interface WhatIfSettings {
  name: string;
  min: number;
  max: number;
  step: number;
  default: number;
  suffix: string;
}

export type PluginFilterWhatIfProps = PluginFilterStylesProps & {
  behaviors: Behavior[];
  data: DataRecord[];
  formData: QueryFormData;
  filterState: FilterState;
  inputRef: RefObject<HTMLInputElement>;
} & PluginFilterHooks;

/** Read the parameter settings stored on the dataset column (column.extra.whatif). */
export function parseSettings(
  extra: string | null | undefined,
  fallbackName: string,
): WhatIfSettings | null {
  if (!extra) return null;
  try {
    const w = JSON.parse(extra).whatif;
    if (!w || typeof w !== 'object') return null;
    const n = (v: unknown, d: number) =>
      Number.isFinite(Number(v)) ? Number(v) : d;
    const min = n(w.min, 0);
    const max = n(w.max, 100);
    return {
      name: String(w.name || fallbackName),
      min,
      max: max > min ? max : min + 1,
      step: n(w.step, 1) > 0 ? n(w.step, 1) : 1,
      default: Math.min(max, Math.max(min, n(w.default, 0))),
      suffix: typeof w.suffix === 'string' ? w.suffix : '',
    };
  } catch (e) {
    return null;
  }
}

/** The data mask a value produces: a filter on the parameter column. */
export const whatIfDataMask = (column: string, value: number, suffix = '') => ({
  extraFormData: { filters: [{ col: column, op: '==' as const, val: value }] },
  filterState: { value: [value], label: `${value}${suffix}` },
});
