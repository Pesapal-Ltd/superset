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
import HtmlContent from '../src/HtmlContent';

const render = (ui: ReactElement) =>
  rtlRender(<ThemeProvider theme={supersetTheme}>{ui}</ThemeProvider>);

test('renders sanitized template into a shadow root', () => {
  const { container } = render(
    <HtmlContent
      width={300}
      height={200}
      rows={[{ name: 'Nairobi', v: 10 }]}
      columns={['name', 'v']}
      headerTemplate=""
      rowTemplate='<p class="x" onclick="evil()">{{ name }} {{ v | number:,.1f }}</p><script>bad()</script>'
      footerTemplate=""
      customCss=".x { color: red; }"
      renderMode="template"
      htmlPage=""
    />,
  );
  const host = container.querySelector('.html-content-chart') as HTMLElement;
  const html = host.shadowRoot!.innerHTML;
  expect(html).toContain('<p class="x">Nairobi 10.0</p>');
  expect(html).not.toContain('onclick');
  expect(html).not.toContain('<script');
  expect(host.shadowRoot!.querySelector('style')!).toHaveTextContent(
    /\.x \{ color: red; \}/,
  );
});

test('shows template errors', () => {
  const { getByText } = render(
    <HtmlContent
      width={300}
      height={200}
      rows={[{ v: 1 }]}
      columns={['v']}
      headerTemplate=""
      rowTemplate="{{ v | bogus }}"
      footerTemplate=""
      customCss=""
      renderMode="template"
      htmlPage=""
    />,
  );
  expect(getByText(/Unknown filter "bogus"/)).toBeInTheDocument();
});

test('page mode renders a sandboxed iframe', () => {
  const { container } = render(
    <HtmlContent
      width={300}
      height={200}
      rows={[{ v: 1 }]}
      columns={['v']}
      headerTemplate=""
      rowTemplate=""
      footerTemplate=""
      customCss=""
      renderMode="page"
      htmlPage="<p>{{ v }}</p><script>1</script>"
    />,
  );
  const frame = container.querySelector('iframe')!;
  expect(frame).toHaveAttribute(
    'sandbox',
    'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-top-navigation-by-user-activation',
  );
  expect(frame).toHaveAttribute('srcdoc', expect.stringContaining('<p>1</p>'));
});
