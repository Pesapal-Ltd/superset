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
        [
          {
            name: 'metric',
            override: {
              description: t(
                'Use an additive metric such as SUM or COUNT; the tree adds values up within each branch.',
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
                'Fields you can break the metric down by (2–8 work best).',
              ),
            },
          },
        ],
        ['adhoc_filters'],
        [{ name: 'row_limit', override: { default: 50000 } }],
      ],
    },
    {
      label: t('Tree'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'metric_name',
            config: {
              type: 'TextControl',
              label: t('Call the metric'),
              renderTrigger: true,
              description: t('Title of the first column, e.g. "Revenue".'),
            },
          },
        ],
        [
          {
            name: 'max_bars',
            config: {
              type: 'SelectControl',
              label: t('Bars per level'),
              default: 10,
              clearable: false,
              renderTrigger: true,
              choices: [5, 8, 10, 15, 20, 30].map(n => [n, String(n)]),
            },
          },
        ],
        [
          {
            name: 'allow_explore',
            config: {
              type: 'CheckboxControl',
              label: t('Viewers can explore'),
              default: true,
              renderTrigger: true,
              description: t(
                'Let dashboard viewers click bars, add and remove levels. Untick to show the saved tree read-only. Changes viewers make are not saved.',
              ),
            },
          },
        ],
        [
          {
            name: 'decomp_levels',
            config: {
              type: 'HiddenControl',
              default: [],
              renderTrigger: true,
              label: t('Saved tree'),
            },
          },
        ],
        ['color_picker'],
        ['y_axis_format'],
        ['currency_format'],
      ],
    },
  ],
  controlOverrides: {
    y_axis_format: { label: t('Number format') },
    color_picker: { label: t('Bar colour') },
  },
  formDataOverrides: formData => ({
    ...formData,
    metric: getStandardizedControls().shiftMetric(),
    groupby: getStandardizedControls().popAllColumns(),
  }),
};

export default config;
