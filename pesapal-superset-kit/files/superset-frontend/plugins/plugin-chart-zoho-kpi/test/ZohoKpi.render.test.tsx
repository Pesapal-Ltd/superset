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
import '@testing-library/jest-dom';
import { ReactElement } from 'react';
import { render as rtlRender } from '@testing-library/react';
import { ThemeProvider, supersetTheme } from '@superset-ui/core';
import ZohoKpi from '../src/ZohoKpi';

const render = (ui: ReactElement) =>
  rtlRender(<ThemeProvider theme={supersetTheme}>{ui}</ThemeProvider>);

test('renders value, comparison, target and sparkline', () => {
  const { getByText, container } = render(
    <ZohoKpi
      width={300}
      height={220}
      title="Revenue"
      formattedValue="KES 1.2M"
      comparison={{
        pct: 0.12,
        formattedPct: '+12.0%',
        formattedPrevious: 'KES 1.07M',
        label: 'vs last month',
        status: 'good',
      }}
      target={{
        formatted: 'KES 1.5M',
        label: 'Target',
        ratio: 0.8,
        formattedRatio: '80%',
        status: 'bad',
      }}
      sparkline={[1, 3, 2, 5]}
      showSparkline
      accentColor="#20A7C9"
    />,
  );
  expect(getByText('KES 1.2M')).toBeInTheDocument();
  expect(getByText('+12.0%')).toBeInTheDocument();
  expect(getByText('80%')).toBeInTheDocument();
  expect(container.querySelectorAll('svg path')).toHaveLength(2);
});
