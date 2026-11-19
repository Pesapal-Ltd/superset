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
  ControlPanelsContainerProps,
  sharedControls,
} from '@superset-ui/chart-controls';
import { DEFAULT_PAGE } from '../page';

const isRaw = ({ controls }: Pick<ControlPanelsContainerProps, 'controls'>) =>
  controls?.query_mode?.value === 'raw';
const isAgg = (props: Pick<ControlPanelsContainerProps, 'controls'>) =>
  !isRaw(props);
const isPage = ({ controls }: Pick<ControlPanelsContainerProps, 'controls'>) =>
  controls?.render_mode?.value !== 'template';
const isTemplate = (props: Pick<ControlPanelsContainerProps, 'controls'>) =>
  !isPage(props);

const SYNTAX_HELP = t(
  'Placeholders: {{ column }} (escaped), {{{ column }}} (HTML), {{ sum(col) }} avg/min/max/count/distinct, ' +
    '{{ @number }} row number. Filters: {{ amount | number:,.2f }}, | currency:KES, | percent, | date:%d %b %Y, ' +
    '| pctOfMax, | pctOfTotal, | gt:0:green:red, | round:1, | upper, | truncate:30, | default:-',
);

const config: ControlPanelConfig = {
  controlPanelSections: [
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'query_mode',
            config: {
              type: 'RadioButtonControl',
              label: t('Query mode'),
              default: 'aggregate',
              options: [
                ['aggregate', t('Aggregate')],
                ['raw', t('Raw records')],
              ],
            },
          },
        ],
        [{ name: 'groupby', override: { visibility: isAgg } }],
        [{ name: 'metrics', override: { validators: [], visibility: isAgg } }],
        [
          {
            name: 'all_columns',
            config: {
              ...sharedControls.groupby,
              label: t('Columns'),
              description: t('Columns to fetch'),
              visibility: isRaw,
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
                'Dropdown filters shown above this chart only. The page receives the filtered rows; the current choices are in window.supersetData.filters. Values picked in the preview become the defaults.',
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
            name: 'timeseries_limit_metric',
            override: { visibility: isAgg },
          },
        ],
        [{ name: 'order_desc', override: { visibility: isAgg } }],
        ['row_limit'],
      ],
    },
    {
      label: t('HTML'),
      expanded: true,
      controlSetRows: [
        [
          {
            name: 'render_mode',
            config: {
              type: 'RadioButtonControl',
              label: t('Mode'),
              default: 'page',
              renderTrigger: true,
              options: [
                ['page', t('Full HTML page')],
                ['template', t('Row template')],
              ],
              description: t(
                'Full HTML page: paste any HTML document, scripts and chart libraries included. ' +
                  'It runs in a sandbox and gets the query results as window.supersetData. ' +
                  'Row template: sanitized HTML repeated per row, no scripts.',
              ),
            },
          },
        ],
        [
          {
            name: 'html_page',
            config: {
              type: 'TextAreaControl',
              language: 'html',
              setOptions: { useWorker: false },
              label: t('HTML page'),
              description: t(
                'Paste a complete HTML page. Use window.supersetData.rows (array of objects), ' +
                  'window.supersetUser (firstName, lastName, username of the viewer) and ' +
                  'window.supersetData.columns in your scripts, or {{ column }} / {{ sum(col) }} placeholders. ' +
                  'External <script src> and <link> tags (e.g. Chart.js, ECharts from a CDN) are allowed.',
              ),
              default: DEFAULT_PAGE,
              renderTrigger: true,
              offerEditInModal: true,
              minLines: 20,
              visibility: isPage,
            },
          },
        ],
        [
          {
            name: 'header_template',
            config: {
              visibility: isTemplate,
              type: 'TextAreaControl',
              language: 'html',
              // Ace's HTML lint worker isn't served by Superset; highlighting still works
              setOptions: { useWorker: false },
              label: t('Header HTML'),
              description: t(
                'Rendered once before the rows. Column references use the first row; aggregates use all rows.',
              ),
              default: '',
              renderTrigger: true,
              offerEditInModal: true,
            },
          },
        ],
        [
          {
            name: 'row_template',
            config: {
              visibility: isTemplate,
              type: 'TextAreaControl',
              language: 'html',
              // Ace's HTML lint worker isn't served by Superset; highlighting still works
              setOptions: { useWorker: false },
              label: t('Row HTML (repeated per row)'),
              description: `${t(
                'Leave all templates empty to show an automatic table.',
              )} ${SYNTAX_HELP}`,
              default: '',
              renderTrigger: true,
              offerEditInModal: true,
            },
          },
        ],
        [
          {
            name: 'footer_template',
            config: {
              visibility: isTemplate,
              type: 'TextAreaControl',
              language: 'html',
              // Ace's HTML lint worker isn't served by Superset; highlighting still works
              setOptions: { useWorker: false },
              label: t('Footer HTML'),
              default: '',
              renderTrigger: true,
              offerEditInModal: true,
            },
          },
        ],
        [
          {
            name: 'css_styles',
            config: {
              visibility: isTemplate,
              type: 'TextAreaControl',
              label: t('CSS'),
              description: t(
                'Styles are scoped to this chart only (rendered in a shadow root).',
              ),
              default: '',
              renderTrigger: true,
              offerEditInModal: true,
            },
          },
        ],
      ],
    },
  ],
  controlOverrides: {
    timeseries_limit_metric: { label: t('Sort by') },
    order_desc: { label: t('Sort descending'), default: true },
  },
};

export default config;
