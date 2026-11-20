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
import { useLayoutEffect, useMemo, useRef } from 'react';
import { styled } from '@superset-ui/core';
import { HtmlContentProps } from './types';
import { renderHtmlContent } from './template';
import { isSanitizationEnabled, sanitize } from './sanitize';
import { buildPageDocument, getCurrentUser, getPageNonce } from './page';
import ViewerFilterBar from './ViewerFilterBar';

const BASE_CSS = `
:host { display: block; font: inherit; color: inherit; }
.hc-root { box-sizing: border-box; }
.hc-auto-table { border-collapse: collapse; width: 100%; font-size: 13px; }
.hc-auto-table th, .hc-auto-table td {
  padding: 6px 10px; border-bottom: 1px solid #e0e0e0; text-align: left;
}
.hc-auto-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
.hc-auto-table thead th {
  position: sticky; top: 0; background: #f7f7f7; font-weight: 600;
}
`;

const ErrorBox = styled.pre`
  ${({ theme }) => `
    white-space: pre-wrap;
    color: ${theme.colors.error.dark1};
    background: ${theme.colors.error.light2};
    padding: ${theme.gridUnit * 2}px;
    border-radius: ${theme.gridUnit}px;
    margin: 0;
  `}
`;

export default function HtmlContent(props: HtmlContentProps) {
  const {
    width,
    height,
    rows,
    columns,
    headerTemplate,
    rowTemplate,
    footerTemplate,
    customCss,
    renderMode,
    htmlPage,
    filterFields = [],
    filterSelection = {},
    applyFilters = () => {},
  } = props;
  const isPage = renderMode === 'page';
  const hostRef = useRef<HTMLDivElement>(null);

  const pageDoc = useMemo(() => {
    if (!isPage) return { doc: '', error: '' };
    try {
      return {
        doc: buildPageDocument(
          htmlPage,
          rows,
          columns,
          getPageNonce(),
          getCurrentUser(),
          filterSelection,
        ),
        error: '',
      };
    } catch (e) {
      return { doc: '', error: (e as Error).message };
    }
  }, [isPage, htmlPage, rows, columns, filterSelection]);

  const { html, error } = useMemo(() => {
    if (isPage) return { html: '', error: '' };
    try {
      const raw = renderHtmlContent({
        header: headerTemplate,
        row: rowTemplate,
        footer: footerTemplate,
        rows,
        columns,
      });
      return { html: isSanitizationEnabled() ? sanitize(raw) : raw, error: '' };
    } catch (e) {
      return { html: '', error: (e as Error).message };
    }
  }, [isPage, headerTemplate, rowTemplate, footerTemplate, rows, columns]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || isPage) return;
    // Shadow DOM keeps the user's CSS from leaking into the dashboard.
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    // textContent (not innerHTML) so CSS can never inject markup
    style.textContent = `${BASE_CSS}\n${(customCss || '').replace(/<\/?style[^>]*>/gi, '')}`;
    const container = document.createElement('div');
    container.className = 'hc-root';
    container.innerHTML = html;
    root.innerHTML = '';
    root.append(style, container);
  }, [isPage, html, customCss]);

  let body: JSX.Element;
  if (error || pageDoc.error) {
    body = <ErrorBox>{`Template error: ${error || pageDoc.error}`}</ErrorBox>;
  } else if (isPage) {
    body = (
      <iframe
        className="html-content-chart"
        title="HTML content"
        // No allow-same-origin: the page can't touch Superset's cookies, DOM or API.
        // allow-top-navigation-by-user-activation: a link with target="_top" may open
        // another dashboard, but only when the user clicks it.
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-top-navigation-by-user-activation"
        srcDoc={pageDoc.doc}
        style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
      />
    );
  } else {
    body = (
      <div
        ref={hostRef}
        className="html-content-chart"
        style={{ width: '100%', height: '100%', overflow: 'auto' }}
      />
    );
  }
  return (
    <div style={{ width, height, display: 'flex', flexDirection: 'column' }}>
      <ViewerFilterBar
        fields={filterFields}
        selection={filterSelection}
        onApply={applyFilters}
      />
      <div style={{ flex: 1, minHeight: 0 }}>{body}</div>
    </div>
  );
}
