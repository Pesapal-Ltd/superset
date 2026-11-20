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
import { getNumberFormatter, getTimeFormatter } from '@superset-ui/core';

/**
 * A tiny, logic-less template language for the HTML Content chart.
 *
 *   {{ column }}                  value, HTML-escaped
 *   {{{ column }}}                value inserted as HTML (still sanitized later)
 *   {{ column | number:,.2f }}    pipe the value through filters
 *   {{ sum(column) }}             aggregates over all rows: sum avg min max count distinct
 *   {{ @index }} {{ @number }}    0-based / 1-based row number
 *   {{ @rowCount }}               number of rows
 *   {{ "text" }} {{ 42 }}         literals
 *
 * Filters (chain with |):
 *   number[:d3format]  percent[:d3format]  currency[:ISO code]  date[:d3 time format]
 *   round[:digits]  abs  upper  lower  trim  truncate:n  default:text
 *   pctOfMax  pctOfTotal          value as % (0-100) of the column max / total
 *   gt:N:then:else  lt:N:then:else  eq:V:then:else     conditional values (e.g. colours)
 */

export type Row = Record<string, unknown>;

export interface TemplateContext {
  rows: Row[];
}

const TOKEN = /\{\{\{([\s\S]+?)\}\}\}|\{\{([\s\S]+?)\}\}/g;
const AGG = /^(sum|avg|min|max|count|distinct)\(\s*(.*?)\s*\)$/i;

export class TemplateError extends Error {}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean')
    return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function lookup(row: Row | undefined, name: string): unknown {
  if (!row) return undefined;
  if (name in row) return row[name];
  const lower = name.toLowerCase();
  const key = Object.keys(row).find(k => k.toLowerCase() === lower);
  return key === undefined ? undefined : row[key];
}

function columnNumbers(rows: Row[], col: string): number[] {
  return rows
    .map(r => toNumber(lookup(r, col)))
    .filter((n): n is number => n !== null);
}

function aggregate(fn: string, col: string, rows: Row[]): number | null {
  const f = fn.toLowerCase();
  if (f === 'count') {
    return col
      ? rows.filter(r => {
          const v = lookup(r, col);
          return v !== null && v !== undefined;
        }).length
      : rows.length;
  }
  if (f === 'distinct') {
    return new Set(rows.map(r => toText(lookup(r, col)))).size;
  }
  const nums = columnNumbers(rows, col);
  if (!nums.length) return null;
  switch (f) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'avg':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    default:
      return null;
  }
}

function resolve(
  name: string,
  row: Row | undefined,
  index: number,
  ctx: TemplateContext,
): unknown {
  if (name === '@index') return index;
  if (name === '@number') return index + 1;
  if (name === '@rowCount') return ctx.rows.length;
  const quoted = name.match(/^(["'])(.*)\1$/);
  if (quoted) return quoted[2];
  if (/^-?\d+(\.\d+)?$/.test(name)) return Number(name);
  const agg = name.match(AGG);
  if (agg) return aggregate(agg[1], agg[2], ctx.rows);
  return lookup(row, name);
}

function toTime(v: unknown): Date | number | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const d = Date.parse(v);
    return Number.isNaN(d) ? null : d;
  }
  return null;
}

function conditional(value: unknown, args: string[], op: 'gt' | 'lt' | 'eq') {
  const [cmp = '', then = '', otherwise = ''] = args;
  let hit: boolean;
  if (op === 'eq') {
    hit = toText(value) === cmp;
  } else {
    const a = toNumber(value);
    const b = toNumber(cmp);
    hit = a !== null && b !== null && (op === 'gt' ? a > b : a < b);
  }
  return hit ? then : otherwise;
}

function applyFilter(
  filter: string,
  value: unknown,
  source: string,
  ctx: TemplateContext,
): unknown {
  const colon = filter.indexOf(':');
  const name = (colon === -1 ? filter : filter.slice(0, colon)).trim();
  const arg = colon === -1 ? '' : filter.slice(colon + 1).trim();
  const num = toNumber(value);

  switch (name) {
    case 'number':
      return num === null ? value : getNumberFormatter(arg || undefined)(num);
    case 'percent':
      return num === null ? value : getNumberFormatter(arg || '.1%')(num);
    case 'currency': {
      if (num === null) return value;
      try {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: (arg || 'USD').toUpperCase(),
        }).format(num);
      } catch (e) {
        throw new TemplateError(`Invalid currency code "${arg}"`);
      }
    }
    case 'date': {
      const t = toTime(value);
      return t === null ? value : getTimeFormatter(arg || '%Y-%m-%d')(t);
    }
    case 'round': {
      if (num === null) return value;
      const digits = Number(arg || 0);
      const f = 10 ** digits;
      return Math.round(num * f) / f;
    }
    case 'abs':
      return num === null ? value : Math.abs(num);
    case 'upper':
      return toText(value).toUpperCase();
    case 'lower':
      return toText(value).toLowerCase();
    case 'trim':
      return toText(value).trim();
    case 'truncate': {
      const n = Number(arg || 50);
      const s = toText(value);
      return s.length > n ? `${s.slice(0, n)}…` : s;
    }
    case 'default':
      return value === null || value === undefined || value === ''
        ? arg
        : value;
    case 'pctOfMax':
    case 'pctOfTotal': {
      if (num === null) return 0;
      const nums = columnNumbers(ctx.rows, source);
      const base =
        name === 'pctOfMax'
          ? Math.max(...nums.map(Math.abs))
          : nums.reduce((a, b) => a + b, 0);
      return base ? Math.round((num / base) * 10000) / 100 : 0;
    }
    case 'gt':
    case 'lt':
    case 'eq':
      return conditional(value, arg.split(':'), name);
    default:
      throw new TemplateError(`Unknown filter "${name}"`);
  }
}

export function evaluate(
  expr: string,
  row: Row | undefined,
  index: number,
  ctx: TemplateContext,
): unknown {
  const [head, ...filters] = expr.split('|');
  const source = head.trim();
  let value = resolve(source, row, index, ctx);
  filters.forEach(f => {
    value = applyFilter(f.trim(), value, source, ctx);
  });
  return value;
}

export function renderTemplate(
  template: string,
  row: Row | undefined,
  index: number,
  ctx: TemplateContext,
): string {
  if (!template) return '';
  return template.replace(
    TOKEN,
    (_m, raw: string | undefined, escaped: string | undefined) => {
      const out = toText(
        evaluate((raw ?? escaped ?? '').trim(), row, index, ctx),
      );
      return raw !== undefined ? out : escapeHtml(out);
    },
  );
}

/** Fallback when no row template is given: a plain table of every column. */
export function renderAutoTable(rows: Row[], columns: string[]): string {
  const cols = columns.length ? columns : Object.keys(rows[0] || {});
  const head = cols.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rows
    .map(r => {
      const cells = cols
        .map(c => {
          const v = r[c];
          const n = toNumber(v);
          const text =
            typeof v === 'number' && n !== null
              ? n.toLocaleString()
              : toText(v);
          return `<td class="${typeof v === 'number' ? 'num' : ''}">${escapeHtml(text)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<table class="hc-auto-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export interface RenderOptions {
  header?: string;
  row?: string;
  footer?: string;
  rows: Row[];
  columns: string[];
}

export function renderHtmlContent({
  header = '',
  row = '',
  footer = '',
  rows,
  columns,
}: RenderOptions): string {
  const ctx: TemplateContext = { rows };
  // Header/footer: plain column references resolve against the first row.
  const first = rows[0];
  const body = row.trim()
    ? rows.map((r, i) => renderTemplate(row, r, i, ctx)).join('')
    : header.trim() || footer.trim()
      ? ''
      : renderAutoTable(rows, columns);
  return (
    renderTemplate(header, first, 0, ctx) +
    body +
    renderTemplate(footer, first, 0, ctx)
  );
}
