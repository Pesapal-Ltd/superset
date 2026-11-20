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
import { ColorFormatters } from '@superset-ui/chart-controls';
import { Agg, MetricDef, Rec, ShowAs } from './engine/pivot';
import { IconSet, Palette } from './engine/format';
import { CellFormat } from './engine/clickFormats';
import { FilterField, FilterSelection } from './viewerFilters';

export type PivotProFormData = QueryFormData & {
  aggregateFunction?: Agg;
  rowTotals?: boolean;
  colTotals?: boolean;
  colSubtotals?: boolean;
  expandDepth?: string;
  defaultShowAs?: ShowAs;
  transposePivot?: boolean;
  showToolbar?: boolean;
  heatmapMetrics?: string[];
  heatmapPalette?: Palette;
  databarMetrics?: string[];
  databarColor?: { r: number; g: number; b: number; a?: number };
  iconMetrics?: string[];
  iconSet?: IconSet;
  lowerIsBetter?: boolean;
  cellFormats?: CellFormat[];
};

export type SortSpec =
  | null
  | { by: 'label'; dir: 'asc' | 'desc' }
  | { by: 'value'; path: string[]; metric: string; dir: 'asc' | 'desc' };

export interface PivotView {
  sort: SortSpec;
  /** 0 = all rows, positive = top N, negative = bottom N */
  top: number;
  showAs: ShowAs;
  transposed: boolean;
  /** -1 = all levels open */
  expandDepth: number;
  expanded: Record<string, boolean>;
  exclude: Record<string, string[]>;
}

export const FACTORY_VIEW: PivotView = {
  sort: null,
  top: 0,
  showAs: 'value',
  transposed: false,
  expandDepth: -1,
  expanded: {},
  exclude: {},
};

export interface PivotProProps {
  width: number;
  height: number;
  records: Rec[];
  rowDims: string[];
  colDims: string[];
  dimLabels: Record<string, string>;
  metrics: MetricDef[];
  agg: Agg;
  labelOf: (dim: string, value: unknown) => string;
  formatValue: (metricIdx: number, value: number) => string;
  rowTotals: boolean;
  colTotals: boolean;
  colSubtotals: boolean;
  /** the view the chart opens with (saved with the chart) */
  view: PivotView;
  /** set in the chart editor: writes view changes into the chart */
  saveView?: (patch: Partial<PivotView>) => void;
  showToolbar: boolean;
  allowViewerFormatting: boolean;
  /** read-only on dashboards: no toolbar, sorting, colouring or expanding */
  locked: boolean;
  /** the 'Lock table on dashboards' setting (for the editor's note) */
  lockOnDashboard: boolean;
  heatmapMetrics: string[];
  palette: Palette;
  databarMetrics: string[];
  databarColor: string;
  iconMetrics: string[];
  iconSet: IconSet;
  lowerIsBetter: boolean;
  ruleFormatters: ColorFormatters;
  /** formats added by clicking cells, saved in the chart */
  savedFormats: CellFormat[];
  /** set when editing the chart: saves click-formats into the chart */
  persistToChart?: (formats: CellFormat[]) => void;
  /** viewer filter dropdowns shown on this chart */
  filterFields: FilterField[];
  filterSelection: FilterSelection;
  applyFilters: (next: FilterSelection) => void;
  /** browser storage key for a viewer's own click-formats */
  storageKey: string;
}
