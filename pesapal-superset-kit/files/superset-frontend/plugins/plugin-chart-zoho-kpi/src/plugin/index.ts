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
import { t, ChartMetadata, ChartPlugin, Behavior } from '@superset-ui/core';
import buildQuery from './buildQuery';
import controlPanel from './controlPanel';
import transformProps from './transformProps';
import thumbnail from '../images/thumbnail.png';

export default class ZohoKpiChartPlugin extends ChartPlugin {
  constructor() {
    const metadata = new ChartMetadata({
      name: t('KPI Card (Zoho style)'),
      description: t(
        'A KPI widget in the style of Zoho Analytics: headline number, change vs a previous period with up/down colouring, optional target progress bar and a sparkline trend.',
      ),
      category: t('KPI'),
      tags: [t('Report'), t('Comparison'), t('Trend'), t('Popular')],
      behaviors: [Behavior.DrillToDetail],
      thumbnail,
    });

    super({
      buildQuery,
      controlPanel,
      loadChart: () => import('../ZohoKpi'),
      metadata,
      transformProps,
    });
  }
}
