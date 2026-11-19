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
import { ChartProps, supersetTheme } from '@superset-ui/core';
import { escapeHtml, renderHtmlContent, renderTemplate } from '../src/template';
import { sanitize } from '../src/sanitize';
import buildQuery from '../src/plugin/buildQuery';
import transformProps from '../src/plugin/transformProps';

const rows = [
  { region: 'Nairobi', amount: 1500.5, growth: 0.12, ds: 1700000000000 },
  { region: 'Mombasa', amount: 500, growth: -0.05, ds: 1700000000000 },
];
const ctx = { rows };

describe('template', () => {
  test('escapes by default, raw with triple braces', () => {
    const r = { name: '<b>x</b>' };
    expect(renderTemplate('{{name}}', r, 0, { rows: [r] })).toBe(
      escapeHtml('<b>x</b>'),
    );
    expect(renderTemplate('{{{name}}}', r, 0, { rows: [r] })).toBe('<b>x</b>');
  });

  test('filters', () => {
    const r = rows[0];
    expect(renderTemplate('{{ amount | number:,.2f }}', r, 0, ctx)).toBe(
      '1,500.50',
    );
    expect(renderTemplate('{{ growth | percent }}', r, 0, ctx)).toBe('12.0%');
    expect(renderTemplate('{{ growth | gt:0:green:red }}', r, 0, ctx)).toBe(
      'green',
    );
    expect(
      renderTemplate('{{ growth | gt:0:green:red }}', rows[1], 1, ctx),
    ).toBe('red');
    expect(renderTemplate('{{ amount | pctOfMax }}', rows[1], 1, ctx)).toBe(
      '33.32',
    );
    expect(renderTemplate('{{ region | upper }}', r, 0, ctx)).toBe('NAIROBI');
    expect(renderTemplate('{{ missing | default:- }}', r, 0, ctx)).toBe('-');
    expect(renderTemplate('{{ ds | date:%Y }}', r, 0, ctx)).toBe('2023');
    expect(renderTemplate('{{ @number }}', r, 1, ctx)).toBe('2');
    expect(renderTemplate('{{ amount | currency:KES }}', r, 0, ctx)).toMatch(
      /1,500\.50/,
    );
  });

  test('aggregates', () => {
    expect(renderTemplate('{{ sum(amount) }}', undefined, 0, ctx)).toBe(
      '2000.5',
    );
    expect(renderTemplate('{{ count() }}', undefined, 0, ctx)).toBe('2');
    expect(renderTemplate('{{ max(amount) }}', undefined, 0, ctx)).toBe(
      '1500.5',
    );
    expect(renderTemplate('{{ distinct(region) }}', undefined, 0, ctx)).toBe(
      '2',
    );
  });

  test('unknown filter throws', () => {
    expect(() =>
      renderTemplate('{{ amount | nope }}', rows[0], 0, ctx),
    ).toThrow('Unknown filter');
  });

  test('header + rows + footer, and auto table fallback', () => {
    const html = renderHtmlContent({
      header: '<ul>',
      row: '<li>{{region}}</li>',
      footer: '</ul>',
      rows,
      columns: ['region'],
    });
    expect(html).toBe('<ul><li>Nairobi</li><li>Mombasa</li></ul>');
    expect(renderHtmlContent({ rows, columns: ['region'] })).toContain(
      '<th>region</th>',
    );
  });
});

describe('sanitize', () => {
  test('strips scripts and handlers, keeps styles and svg', () => {
    const out = sanitize(
      '<div style="color:red" onclick="x()">a</div><script>alert(1)</script>' +
        // eslint-disable-next-line no-script-url
        '<a href="javascript:alert(1)">l</a><svg viewBox="0 0 10 10"><rect width="5" fill="red"/></svg>' +
        '<span data-id="7">s</span>',
    );
    expect(out).toContain('style="color:red"');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert(1)</');
    // eslint-disable-next-line no-script-url
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<rect width="5" fill="red"');
    expect(out).toContain('data-id="7"');
  });
});

describe('query + props', () => {
  test('aggregate mode sorts by first metric', () => {
    const q = buildQuery({
      datasource: '1__table',
      viz_type: 'html_content',
      groupby: ['region'],
      metrics: ['sum__amount'],
    }).queries[0];
    expect(q.columns).toEqual(['region']);
    expect(q.orderby).toEqual([['sum__amount', false]]);
  });

  test('raw mode uses all_columns', () => {
    const q = buildQuery({
      datasource: '1__table',
      viz_type: 'html_content',
      query_mode: 'raw',
      all_columns: ['region', 'amount'],
      metrics: ['sum__amount'],
    }).queries[0];
    expect(q.columns).toEqual(['region', 'amount']);
    expect(q.metrics).toBeUndefined();
  });

  test('transformProps', () => {
    const props = transformProps(
      new ChartProps({
        formData: { viz_type: 'html_content', row_template: '<p>{{a}}</p>' },
        width: 100,
        height: 100,
        theme: supersetTheme,
        queriesData: [{ data: [{ a: 1 }], colnames: ['a'] }],
      }),
    );
    expect(props.rowTemplate).toBe('<p>{{a}}</p>');
    expect(props.columns).toEqual(['a']);
  });
});
