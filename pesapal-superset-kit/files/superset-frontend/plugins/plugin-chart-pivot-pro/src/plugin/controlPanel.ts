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
  ensureIsArray,
  getMetricLabel,
  isAdhocColumn,
  isPhysicalColumn,
  QueryFormMetric,
  SMART_DATE_ID,
  t,
} from '@superset-ui/core';
import {
  ControlPanelConfig,
  ControlPanelsContainerProps,
  ControlState,
  D3_FORMAT_DOCS,
  D3_TIME_FORMAT_OPTIONS,
  Dataset,
  getStandardizedControls,
  sharedControls,
} from '@superset-ui/chart-controls';
import { SHOW_AS_LABELS } from '../engine/pivot';
import { ICON_SETS, PALETTES } from '../engine/format';

/** Choices = the chart's metrics, for the formatting multi-selects. */
const metricChoices = ({
  controls,
}: {
  controls: ControlPanelsContainerProps['controls'];
}) => ({
  choices: ensureIsArray(controls?.metrics?.value as QueryFormMetric[]).map(
    m => {
      const label = getMetricLabel(m);
      return [label, label];
    },
  ),
});

const metricMulti = (name: string, label: string, description: string) => ({
  name,
  config: {
    type: 'SelectControl',
    multi: true,
    label,
    description,
    default: [],
    renderTrigger: true,
    mapStateToProps: (state: {
      controls: ControlPanelsContainerProps['controls'];
    }) => metricChoices(state),
  },
});

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'groupbyRows',
            config: {
              ...sharedControls.groupby,
              label: t('Rows'),
              description: t(
                'Fields shown as row groups (first = top level, the rest nest under it)',
              ),
            },
          },
        ],
        [
          {
            name: 'groupbyColumns',
            config: {
              ...sharedControls.groupby,
              label: t('Columns'),
              description: t('Fields shown across the top'),
            },
          },
        ],
        [
          {
            name: 'time_grain_sqla',
            config: {
              ...sharedControls.time_grain_sqla,
              visibility: ({ controls }) => {
                const dttm = Object.fromEntries(
                  ensureIsArray(controls?.groupbyColumns?.options).map(o => [
                    o.column_name,
                    o.is_dttm,
                  ]),
                );
                return [
                  ...ensureIsArray(controls?.groupbyColumns?.value),
                  ...ensureIsArray(controls?.groupbyRows?.value),
                ].some(
                  s => isAdhocColumn(s) || (isPhysicalColumn(s) && !!dttm[s]),
                );
              },
            },
          },
          'temporal_columns_lookup',
        ],
        [
          {
            name: 'metrics',
            override: {
              validators: [],
              rerender: [
                'conditional_formatting',
                'heatmap_metrics',
                'databar_metrics',
                'icon_metrics',
              ],
            },
          },
        ],
        ['adhoc_filters'],
        [
          {
            name: 'viewer_filters',
            config: {
              ...sharedControls.groupby,
              label: t('Viewer filter fields'),
              description: t(
                'Dropdown filters shown on this chart only. Viewers can use them even when the table is locked. Values you pick in the preview become the defaults.',
              ),
            },
          },
        ],
        [
          {
            name: 'viewer_filter_defaults',
            config: {
              type: 'HiddenControl',
              default: {},
              label: t('Default viewer filters'),
            },
          },
        ],
        [
          {
            name: 'row_limit',
            config: {
              ...sharedControls.row_limit,
              label: t('Cell limit'),
              default: 10000,
              description: t(
                'Maximum number of grouped rows fetched from the database.',
              ),
            },
          },
        ],
      ],
    },
    {
      label: t('Pivot options'),
      expanded: true,
      tabOverride: 'data',
      controlSetRows: [
        [
          {
            name: 'aggregateFunction',
            config: {
              type: 'SelectControl',
              label: t('Totals use'),
              default: 'sum',
              clearable: false,
              renderTrigger: true,
              choices: [
                ['sum', t('Sum')],
                ['avg', t('Average')],
                ['min', t('Minimum')],
                ['max', t('Maximum')],
                ['count', t('Count')],
              ],
              description: t(
                'How subtotals and totals combine cells. Use Sum for additive metrics.',
              ),
            },
          },
          {
            name: 'expandDepth',
            config: {
              type: 'SelectControl',
              label: t('Rows open by default'),
              default: '-1',
              clearable: false,
              renderTrigger: true,
              choices: [
                ['-1', t('All levels open')],
                ['0', t('Collapsed (top level only)')],
                ['1', t('First level open')],
              ],
            },
          },
        ],
        [
          {
            name: 'rowTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Grand total row'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'colTotals',
            config: {
              type: 'CheckboxControl',
              label: t('Grand total column'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'colSubtotals',
            config: {
              type: 'CheckboxControl',
              label: t('Column subtotals'),
              default: false,
              renderTrigger: true,
            },
          },
          {
            name: 'transposePivot',
            config: {
              type: 'CheckboxControl',
              label: t('Swap rows and columns'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'sort_rows',
            config: {
              type: 'SelectControl',
              label: t('Sort rows'),
              default: 'none',
              clearable: false,
              renderTrigger: true,
              choices: [
                ['none', t('Labels A → Z')],
                ['label_desc', t('Labels Z → A')],
                ['total_desc', t('Total, highest first')],
                ['total_asc', t('Total, lowest first')],
                ['custom', t('By a column (click its header in the chart)')],
              ],
              description: t(
                'Applies within every group. You can also click a column header in the chart preview.',
              ),
            },
          },
          {
            name: 'sort_metric',
            config: {
              type: 'SelectControl',
              label: t('Sort by metric'),
              renderTrigger: true,
              clearable: true,
              description: t(
                'Metric used for "Total" sorting and Top / Bottom N.',
              ),
              visibility: ({ controls }: any) =>
                String(controls?.sort_rows?.value || '').startsWith('total'),
              mapStateToProps: (state: any) => metricChoices(state),
            },
          },
        ],
        [
          {
            name: 'default_top_n',
            config: {
              type: 'SelectControl',
              label: t('Show rows'),
              default: 0,
              clearable: false,
              renderTrigger: true,
              choices: [
                [0, t('All rows')],
                [5, t('Top 5')],
                [10, t('Top 10')],
                [20, t('Top 20')],
                [50, t('Top 50')],
                [-5, t('Bottom 5')],
                [-10, t('Bottom 10')],
              ],
              description: t(
                'Keeps the top-level rows with the highest (or lowest) totals.',
              ),
            },
          },
        ],
        [
          {
            name: 'pivot_sort',
            config: {
              type: 'HiddenControl',
              default: null,
              renderTrigger: true,
              label: t('Column sort'),
            },
          },
          {
            name: 'expanded_groups',
            config: {
              type: 'HiddenControl',
              default: {},
              renderTrigger: true,
              label: t('Expanded groups'),
            },
          },
          {
            name: 'hidden_values',
            config: {
              type: 'HiddenControl',
              default: {},
              renderTrigger: true,
              label: t('Hidden values'),
            },
          },
        ],
        [
          {
            name: 'defaultShowAs',
            config: {
              type: 'SelectControl',
              label: t('Show values as'),
              default: 'value',
              clearable: false,
              renderTrigger: true,
              choices: Object.entries(SHOW_AS_LABELS),
              description: t(
                'Default view; viewers can change it from the toolbar.',
              ),
            },
          },
        ],
        [
          {
            name: 'lock_on_dashboard',
            config: {
              type: 'CheckboxControl',
              label: t('Lock table on dashboards'),
              default: true,
              renderTrigger: true,
              description: t(
                'Dashboard viewers see exactly the view you built here and cannot change it: no toolbar, sorting, colouring or expanding. Untick to let viewers explore.',
              ),
            },
          },
        ],
        [
          {
            name: 'showToolbar',
            config: {
              type: 'CheckboxControl',
              label: t('Show toolbar on dashboards'),
              default: true,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                !controls?.lock_on_dashboard?.value,
              description: t(
                'Lets viewers search, filter, sort, change Top N / show-as, swap and export. Off = a fixed, ready-made table. Always shown while editing the chart.',
              ),
            },
          },
          {
            name: 'allow_viewer_formatting',
            config: {
              type: 'CheckboxControl',
              label: t('Viewers can colour cells'),
              default: true,
              renderTrigger: true,
              visibility: ({ controls }: any) =>
                !controls?.lock_on_dashboard?.value,
              description: t(
                'Lets dashboard viewers click cells to add their own colours (saved only for them).',
              ),
            },
          },
        ],
      ],
    },
    {
      label: t('Formatting'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'valueFormat',
            config: {
              ...sharedControls.y_axis_format,
              label: t('Value format'),
            },
          },
        ],
        ['currency_format'],
        [
          {
            name: 'date_format',
            config: {
              type: 'SelectControl',
              freeForm: true,
              label: t('Date format'),
              default: SMART_DATE_ID,
              renderTrigger: true,
              choices: D3_TIME_FORMAT_OPTIONS,
              description: D3_FORMAT_DOCS,
            },
          },
        ],
      ],
    },
    {
      label: t('Conditional formatting'),
      expanded: true,
      controlSetRows: [
        [
          metricMulti(
            'heatmap_metrics',
            t('Colour scale (heatmap) on'),
            t('Colour each cell by its value, low to high.'),
          ) as any,
        ],
        [
          {
            name: 'heatmap_palette',
            config: {
              type: 'SelectControl',
              label: t('Colour scale'),
              default: 'red_green',
              clearable: false,
              renderTrigger: true,
              choices: Object.entries(PALETTES).map(([k, v]) => [k, v.label]),
            },
          },
        ],
        [
          metricMulti(
            'databar_metrics',
            t('Data bars on'),
            t('Draw a bar in each cell proportional to its value.'),
          ) as any,
        ],
        ['color_picker'],
        [
          metricMulti(
            'icon_metrics',
            t('Icons on'),
            t('Top / middle / bottom third of values get different icons.'),
          ) as any,
        ],
        [
          {
            name: 'icon_set',
            config: {
              type: 'SelectControl',
              label: t('Icon set'),
              default: 'arrows',
              clearable: false,
              renderTrigger: true,
              choices: Object.entries(ICON_SETS).map(([k, v]) => [k, v.label]),
            },
          },
          {
            name: 'lower_is_better',
            config: {
              type: 'CheckboxControl',
              label: t('Lower is better'),
              default: false,
              renderTrigger: true,
              description: t(
                'Icons: green for the lowest values instead of the highest.',
              ),
            },
          },
        ],
        [
          {
            name: 'cell_formats',
            config: {
              type: 'HiddenControl',
              label: t('Click formats'),
              default: [],
              renderTrigger: true,
              description: t('Formats added by clicking cells in the chart.'),
            },
          },
        ],
        [
          {
            name: 'conditional_formatting',
            config: {
              type: 'ConditionalFormattingControl',
              renderTrigger: true,
              label: t('Colour rules'),
              description: t(
                'Rules like "> 100000 → green". Applied to actual values.',
              ),
              mapStateToProps(explore, _: ControlState, chart) {
                const values =
                  (explore?.controls?.metrics?.value as QueryFormMetric[]) ??
                  [];
                const verboseMap = explore?.datasource?.hasOwnProperty(
                  'verbose_map',
                )
                  ? (explore?.datasource as Dataset)?.verbose_map
                  : (explore?.datasource?.columns ?? {});
                return {
                  removeIrrelevantConditions: chart?.chartStatus === 'success',
                  columnOptions: values.map(v =>
                    typeof v === 'string'
                      ? {
                          value: v,
                          label: Array.isArray(verboseMap) ? v : verboseMap[v],
                        }
                      : { value: v.label, label: v.label },
                  ),
                  verboseMap,
                };
              },
            },
          },
        ],
      ],
    },
  ],
  controlOverrides: {
    color_picker: { label: t('Data bar colour') },
  },
  formDataOverrides: formData => {
    const groupbyColumns = getStandardizedControls().controls.columns.filter(
      col => !ensureIsArray(formData.groupbyRows).includes(col),
    );
    getStandardizedControls().controls.columns =
      getStandardizedControls().controls.columns.filter(
        col => !groupbyColumns.includes(col),
      );
    return {
      ...formData,
      metrics: getStandardizedControls().popAllMetrics(),
      groupbyColumns,
    };
  },
};

export default config;
