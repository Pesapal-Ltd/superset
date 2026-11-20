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
import { SMART_DATE_ID, t } from '@superset-ui/core';
import {
  ControlPanelConfig,
  D3_FORMAT_DOCS,
  D3_TIME_FORMAT_OPTIONS,
  getStandardizedControls,
} from '@superset-ui/chart-controls';

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        ['x_axis'],
        ['time_grain_sqla'],
        ['metric'],
        ['adhoc_filters'],
      ],
    },
    {
      label: t('KPI'),
      tabOverride: 'data',
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'kpi_value_mode',
            config: {
              type: 'SelectControl',
              label: t('Headline value'),
              renderTrigger: true,
              clearable: false,
              default: 'last',
              choices: [
                ['last', t('Latest period')],
                ['sum', t('Total of all periods')],
                ['avg', t('Average of all periods')],
              ],
              description: t(
                'Which value to show when a time column is set. Comparison is only shown for "Latest period".',
              ),
            },
          },
        ],
        [
          {
            name: 'compare_lag',
            config: {
              type: 'TextControl',
              label: t('Compare with N periods back'),
              isInt: true,
              default: '1',
              renderTrigger: true,
              description: t(
                'Based on the time grain: 1 = previous period, 12 = same month last year (monthly grain), etc.',
              ),
            },
          },
          {
            name: 'comparison_label',
            config: {
              type: 'TextControl',
              label: t('Comparison label'),
              default: t('vs previous period'),
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'lower_is_better',
            config: {
              type: 'CheckboxControl',
              label: t('Lower is better'),
              default: false,
              renderTrigger: true,
              description: t(
                'Show decreases in green and increases in red (e.g. costs, churn, failed transactions).',
              ),
            },
          },
        ],
        [
          {
            name: 'target_value',
            config: {
              type: 'TextControl',
              label: t('Target'),
              isFloat: true,
              renderTrigger: true,
              description: t(
                'Optional goal. Shows a progress bar with % of target achieved.',
              ),
            },
          },
          {
            name: 'target_label',
            config: {
              type: 'TextControl',
              label: t('Target label'),
              default: t('Target'),
              renderTrigger: true,
            },
          },
        ],
      ],
    },
    {
      label: t('Chart Options'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'kpi_title',
            config: {
              type: 'TextControl',
              label: t('KPI title'),
              renderTrigger: true,
              description: t('Defaults to the metric name'),
            },
          },
        ],
        [
          {
            name: 'subtitle',
            config: {
              type: 'TextControl',
              label: t('Subtitle'),
              renderTrigger: true,
            },
          },
        ],
        ['color_picker'],
        [
          {
            name: 'show_sparkline',
            config: {
              type: 'CheckboxControl',
              label: t('Show sparkline'),
              default: true,
              renderTrigger: true,
              description: t('Requires a time column'),
            },
          },
          {
            name: 'show_timestamp',
            config: {
              type: 'CheckboxControl',
              label: t('Show period date'),
              default: false,
              renderTrigger: true,
            },
          },
        ],
        ['y_axis_format'],
        ['currency_format'],
        [
          {
            name: 'time_format',
            config: {
              type: 'SelectControl',
              freeForm: true,
              label: t('Date format'),
              renderTrigger: true,
              choices: D3_TIME_FORMAT_OPTIONS,
              description: D3_FORMAT_DOCS,
              default: SMART_DATE_ID,
            },
          },
        ],
      ],
    },
  ],
  controlOverrides: {
    y_axis_format: {
      label: t('Number format'),
    },
  },
  formDataOverrides: formData => ({
    ...formData,
    metric: getStandardizedControls().shiftMetric(),
  }),
};

export default config;
