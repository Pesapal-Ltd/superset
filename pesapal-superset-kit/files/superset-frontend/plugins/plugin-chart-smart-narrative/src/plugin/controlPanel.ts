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
import { t } from '@superset-ui/core';
import {
  ControlPanelConfig,
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
        [
          {
            name: 'groupby',
            override: {
              label: t('Explain by'),
              description: t(
                'Columns used to explain changes and composition, e.g. product line, country. 1–3 work best.',
              ),
            },
          },
        ],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Narrative'),
      tabOverride: 'data',
      expanded: true,
      controlSetRows: [
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
                '1 = previous period. With a monthly grain, 12 = same month last year.',
              ),
            },
          },
          {
            name: 'max_insights',
            config: {
              type: 'SelectControl',
              label: t('Max insights'),
              default: 6,
              renderTrigger: true,
              clearable: false,
              choices: [3, 4, 5, 6, 8, 10].map(n => [n, String(n)]),
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
                'Treat decreases as good news (costs, cancellations, churn).',
              ),
            },
          },
        ],
        [
          {
            name: 'metric_name',
            config: {
              type: 'TextControl',
              label: t('Call the metric'),
              renderTrigger: true,
              description: t(
                'How the metric is named in sentences, e.g. "Revenue". Defaults to the metric label.',
              ),
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
            name: 'narrative_title',
            config: {
              type: 'TextControl',
              label: t('Heading'),
              default: t('Commentary'),
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'font_size',
            config: {
              type: 'SelectControl',
              label: t('Text size'),
              default: 'm',
              clearable: false,
              renderTrigger: true,
              choices: [
                ['s', t('Small')],
                ['m', t('Medium')],
                ['l', t('Large')],
              ],
            },
          },
          {
            name: 'show_footer',
            config: {
              type: 'CheckboxControl',
              label: t('Show footer'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        ['y_axis_format'],
        ['currency_format'],
      ],
    },
  ],
  controlOverrides: {
    y_axis_format: { label: t('Number format') },
  },
  formDataOverrides: formData => ({
    ...formData,
    metric: getStandardizedControls().shiftMetric(),
    groupby: getStandardizedControls().popAllColumns(),
  }),
};

export default config;
