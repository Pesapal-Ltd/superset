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
import { renderTemplate, Row } from './template';

export const DEFAULT_PAGE = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Inter, Helvetica, Arial, sans-serif; margin: 12px; color: #333; }
    h3 { margin: 0 0 12px; font-size: 14px; color: #666; text-transform: uppercase; }
    .row { display: flex; align-items: center; margin: 6px 0; font-size: 13px; }
    .label { width: 30%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bar { height: 18px; background: #20A7C9; border-radius: 3px; margin-right: 8px; }
  </style>
</head>
<body>
  <h3>My chart ({{ @rowCount }} rows)</h3>
  <div id="chart"></div>
  <script>
    // Query results are available as window.supersetData.rows / .columns
    const { rows, columns } = window.supersetData;
    const label = columns.find(c => typeof rows[0]?.[c] !== 'number') || columns[0];
    const value = columns.find(c => typeof rows[0]?.[c] === 'number');
    const max = Math.max(...rows.map(r => Math.abs(r[value] || 0)), 1);
    document.getElementById('chart').innerHTML = rows.map(r => \`
      <div class="row">
        <div class="label">\${r[label]}</div>
        <div class="bar" style="width:\${(Math.abs(r[value] || 0) / max) * 60}%"></div>
        \${(r[value] ?? '').toLocaleString()}
      </div>\`).join('');
  </script>
</body>
</html>
`;

const BANNER_STYLE =
  'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:8px 12px;' +
  'font:12px/1.4 Inter,Helvetica,Arial,sans-serif;background:#FAEDEE;color:#A7323F;' +
  'border-bottom:1px solid #EFA1AA;white-space:pre-wrap';

/** Runs first inside the page: clears the "blocked" banner, reports errors. */
const DIAGNOSTICS = `(function () {
  var style = ${JSON.stringify(BANNER_STYLE)};
  function show(msg) {
    var b = document.getElementById('__superset_diag');
    if (!b) {
      b = document.createElement('div');
      b.id = '__superset_diag';
      b.setAttribute('style', style);
      (document.body || document.documentElement).appendChild(b);
    }
    b.textContent = 'Error in your HTML page: ' + msg;
  }
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.getElementById('__superset_diag');
    if (b && b.textContent.indexOf('did not run') !== -1) b.remove();
  });
  window.addEventListener('error', function (e) {
    show((e.message || 'script failed to load') + (e.lineno ? ' (line ' + e.lineno + ')' : '') +
      (e.target && e.target.src ? ' ' + e.target.src : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    show(String(e.reason));
  });
})();`;

export interface PageUser {
  firstName: string;
  lastName: string;
  username: string;
}

/** Name of the person viewing the chart, from Superset's bootstrap data. */
export function getCurrentUser(): PageUser | null {
  try {
    const app = document.getElementById('app');
    const { user } = JSON.parse(app?.getAttribute('data-bootstrap') || '{}');
    if (!user?.username) return null;
    return {
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      username: user.username,
    };
  } catch (e) {
    return null;
  }
}

/** The CSP nonce Superset issued for this page load, if any. */
export function getPageNonce(): string {
  const el = document.querySelector(
    'script[nonce]',
  ) as HTMLScriptElement | null;
  return el?.nonce || el?.getAttribute('nonce') || '';
}

/**
 * Turn the user's pasted HTML into a self-contained document for a sandboxed
 * iframe: fill {{ placeholders }}, inject the query data as window.supersetData,
 * and tag every <script> with the page nonce so Superset's CSP lets it run.
 * The iframe has no allow-same-origin, so the page cannot read Superset's
 * cookies, DOM or API.
 */
export function buildPageDocument(
  html: string,
  rows: Row[],
  columns: string[],
  nonce = '',
  user: PageUser | null = null,
  filters: Record<string, unknown[]> = {},
): string {
  const filled = renderTemplate(html, rows[0], 0, { rows });
  const doc = new DOMParser().parseFromString(filled, 'text/html');

  const reset = doc.createElement('style');
  reset.textContent = 'html, body { margin: 0; }';
  const data = doc.createElement('script');
  data.textContent = `window.supersetData = ${JSON.stringify({
    rows,
    columns,
    filters,
  }).replace(/</g, '\\u003c')};
window.supersetUser = ${JSON.stringify(user).replace(/</g, '\\u003c')};
${DIAGNOSTICS}`;

  // Visible until the injected script runs. If it stays, scripts are blocked.
  const banner = doc.createElement('div');
  banner.id = '__superset_diag';
  banner.setAttribute('style', BANNER_STYLE);
  banner.textContent =
    'Scripts on this page did not run. Superset may be blocking them (Content Security Policy). ' +
    'Check the browser console for details.';
  doc.body.prepend(banner);
  const base = doc.createElement('base');
  base.setAttribute('target', '_blank');
  doc.head.prepend(base, reset, data);

  if (nonce) {
    doc.querySelectorAll('script').forEach(s => s.setAttribute('nonce', nonce));
  }
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}
