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
import { t, ChartMetadata, ChartPlugin } from '@superset-ui/core';
import buildQuery from './buildQuery';
import controlPanel from './controlPanel';
import transformProps from './transformProps';
import thumbnail from '../images/thumbnail.png';

export default class HtmlContentChartPlugin extends ChartPlugin {
  constructor() {
    const metadata = new ChartMetadata({
      name: t('HTML Content'),
      description: t(
        'Design your own visual with HTML and CSS, like the Power BI "HTML Content" visual. ' +
          'Bind query columns and metrics with {{ placeholders }}, repeat a row template for every record, ' +
          'and use filters for number, currency, date and conditional formatting. Output is sanitized.',
      ),
      category: t('Table'),
      tags: [t('Text'), t('Report'), t('Formattable'), t('Advanced-Analytics')],
      thumbnail,
    });

    super({
      buildQuery,
      controlPanel,
      loadChart: () => import('../HtmlContent'),
      metadata,
      transformProps,
    });
  }
}
