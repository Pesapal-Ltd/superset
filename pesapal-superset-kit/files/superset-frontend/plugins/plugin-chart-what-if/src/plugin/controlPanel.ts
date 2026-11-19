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
import { ControlPanelConfig, ControlSetRow } from '@superset-ui/chart-controls';

const driverRows = (i: number): ControlSetRow[] => {
  const show =
    i === 1
      ? undefined
      : ({ controls }: any) => !!controls?.[`driver_${i - 1}_name`]?.value;
  const text = (
    key: string,
    label: string,
    def?: string,
    isFloat = false,
    description?: string,
  ) => ({
    name: `driver_${i}_${key}`,
    config: {
      type: 'TextControl',
      label,
      default: def,
      isFloat,
      renderTrigger: true,
      visibility: show,
      description,
    },
  });
  return [
    [
      text(
        'name',
        t('Driver %s name', i),
        i === 1 ? 'Price %' : '',
        false,
        t('Used in the formula as [name]'),
      ),
    ],
    [
      text('min', t('Min'), '-50', true),
      text('max', t('Max'), '50', true),
      text('step', t('Step'), '5', true),
      text('default', t('Planned'), '0', true),
    ],
    [
      text(
        'param',
        t('Follow dashboard parameter'),
        '',
        false,
        t(
          'Optional: a what-if parameter column (whatif_…) whose dashboard slider sets this driver',
        ),
      ),
      {
        name: `driver_${i}_suffix`,
        config: {
          type: 'SelectControl',
          label: t('Shown as'),
          default: '%',
          clearable: false,
          renderTrigger: true,
          visibility: show,
          choices: [
            ['%', t('percent')],
            ['', t('number')],
          ],
        },
      },
    ],
  ];
};

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        ['metrics'],
        [
          {
            name: 'groupby',
            override: {
              label: t('Break down by'),
              description: t(
                'Optional: one field to compare baseline vs scenario per value.',
              ),
            },
          },
        ],
        ['adhoc_filters'],
        [{ name: 'row_limit', override: { default: 50 } }],
      ],
    },
    {
      label: t('Scenario'),
      expanded: true,
      tabOverride: 'data',
      controlSetRows: [
        [
          {
            name: 'scenario_formula',
            config: {
              type: 'TextControl',
              label: t('Scenario formula'),
              default: '',
              renderTrigger: true,
              description: t(
                'Use metrics and drivers in [brackets], e.g. [SUM(sales)] * (1 + [Price %] / 100) * (1 + [Volume %] / 100). Functions: MIN, MAX, ABS, ROUND, IF.',
              ),
            },
          },
        ],
        [
          {
            name: 'result_name',
            config: {
              type: 'TextControl',
              label: t('Scenario label'),
              default: t('Scenario'),
              renderTrigger: true,
            },
          },
        ],
        ...driverRows(1),
        ...driverRows(2),
        ...driverRows(3),
        [
          {
            name: 'allow_sliders',
            config: {
              type: 'CheckboxControl',
              label: t('Viewers can move the sliders'),
              default: true,
              renderTrigger: true,
            },
          },
          {
            name: 'lower_is_better',
            config: {
              type: 'CheckboxControl',
              label: t('Lower is better'),
              default: false,
              renderTrigger: true,
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
    color_picker: { label: t('Scenario colour') },
  },
};

export default config;
