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
import { t, validateNonEmpty } from '@superset-ui/core';
import {
  ControlPanelConfig,
  sharedControls,
} from '@superset-ui/chart-controls';

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'target',
            config: {
              ...sharedControls.groupby,
              label: t('Analyze'),
              multi: false,
              validators: [validateNonEmpty],
              description: t(
                'The outcome to explain: a number column (e.g. sales) or a text column (e.g. status).',
              ),
            },
          },
        ],
        [
          {
            name: 'groupby',
            override: {
              label: t('Explain by'),
              description: t(
                'Fields that might influence it (country, deal size, product line, quantity…).',
              ),
            },
          },
        ],
        ['adhoc_filters'],
        [{ name: 'row_limit', override: { default: 50000 } }],
      ],
    },
    {
      label: t('Analysis'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'target_value',
            config: {
              type: 'TextControl',
              label: t('Outcome (for text fields)'),
              renderTrigger: true,
              description: t(
                'E.g. "Cancelled" to see what makes a status Cancelled. Leave empty for number fields.',
              ),
            },
          },
        ],
        [
          {
            name: 'direction',
            config: {
              type: 'SelectControl',
              label: t('Look for what makes it'),
              default: 'increase',
              clearable: false,
              renderTrigger: true,
              choices: [
                ['increase', t('Increase / happen more')],
                ['decrease', t('Decrease / happen less')],
              ],
            },
          },
          {
            name: 'allow_direction',
            config: {
              type: 'CheckboxControl',
              label: t('Viewers can switch'),
              default: true,
              renderTrigger: true,
            },
          },
        ],
        [
          {
            name: 'min_group',
            config: {
              type: 'SelectControl',
              label: t('Minimum group size'),
              default: 30,
              clearable: false,
              renderTrigger: true,
              choices: [10, 20, 30, 50, 100, 200].map(n => [n, `${n} rows`]),
            },
          },
          {
            name: 'max_influencers',
            config: {
              type: 'SelectControl',
              label: t('Show up to'),
              default: 10,
              clearable: false,
              renderTrigger: true,
              choices: [5, 10, 15, 20].map(n => [n, `${n} influencers`]),
            },
          },
        ],
        [
          {
            name: 'target_name',
            config: {
              type: 'TextControl',
              label: t('Call it'),
              renderTrigger: true,
              description: t(
                'Name used in sentences, e.g. "Sales". Defaults to the column name.',
              ),
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
};

export default config;
