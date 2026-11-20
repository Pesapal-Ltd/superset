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
/**
 * DAX -> SQL compiler for Superset metrics.
 *
 * DAX measures are evaluated in a filter context (the visual's row/column).
 * Superset metrics are SQL aggregate expressions over a GROUP BY query, so:
 *  - plain aggregations compile to SUM(...), COUNT(...), ...
 *  - CALCULATE filters push into the aggregate: SUM(CASE WHEN cond THEN x END)
 *  - ALL / REMOVEFILTERS / ALLEXCEPT, time intelligence and filters that
 *    override a grouped column become window functions over the grouped
 *    rows. The PARTITION BY depends on the chart's grouping, so it is filled
 *    in at query time by the Jinja helpers in superset/semantic/dax.py.
 */
import { DaxError, Node, parseMeasure } from './parser';

export interface ModelColumn {
  name: string;
  /** SQL for calculated columns */
  expression?: string | null;
  isDate?: boolean;
}

export interface ModelParameter {
  /** display name, used as [Name] or [Name Value] in formulas */
  name: string;
  /** dataset column that carries the value (filter target) */
  column: string;
  default: number;
}

export interface Model {
  dialect: string;
  columns: ModelColumn[];
  /** measure name -> DAX formula */
  measures: Record<string, string>;
  parameters?: ModelParameter[];
}

export interface CompileResult {
  sql: string;
  warnings: string[];
  dependsOn: string[];
  usesTemplates: boolean;
}

interface Ctx {
  filters: string[];
  /** grouping columns ignored by the measure ("all" = every column) */
  remove: 'all' | string[];
  /** ALLEXCEPT: only these columns keep their grouping */
  keep?: string[];
  /** columns overridden by CALCULATE filters (DAX replaces their filter) */
  filterCols: string[];
  time?: 'ytd' | 'qtd' | 'mtd';
  shift?: { unit: string; n: number };
  date?: string;
  /** inside an iterator (SUMX) or a filter condition: row-level SQL */
  row: boolean;
}

const AGGREGATIONS: Record<string, string> = {
  SUM: 'SUM',
  AVERAGE: 'AVG',
  MIN: 'MIN',
  MAX: 'MAX',
  COUNT: 'COUNT',
  COUNTA: 'COUNT',
  COUNTBLANK: 'COUNTBLANK',
  DISTINCTCOUNT: 'DISTINCT',
  COUNTROWS: 'ROWS',
};
const ITERATORS: Record<string, string> = {
  SUMX: 'SUM',
  AVERAGEX: 'AVG',
  MINX: 'MIN',
  MAXX: 'MAX',
  COUNTX: 'COUNT',
};
const SHIFTS: Record<string, [string, number]> = {
  SAMEPERIODLASTYEAR: ['year', -1],
  PREVIOUSYEAR: ['year', -1],
  PREVIOUSQUARTER: ['quarter', -1],
  PREVIOUSMONTH: ['month', -1],
  PREVIOUSDAY: ['day', -1],
  NEXTYEAR: ['year', 1],
  NEXTQUARTER: ['quarter', 1],
  NEXTMONTH: ['month', 1],
  NEXTDAY: ['day', 1],
};
const TO_DATE: Record<string, Ctx['time']> = {
  DATESYTD: 'ytd',
  DATESQTD: 'qtd',
  DATESMTD: 'mtd',
};
const TOTALS: Record<string, string> = {
  TOTALYTD: 'DATESYTD',
  TOTALQTD: 'DATESQTD',
  TOTALMTD: 'DATESMTD',
};
const REAGG: Record<string, string> = {
  SUM: 'SUM',
  COUNT: 'SUM',
  ROWS: 'SUM',
  MIN: 'MIN',
  MAX: 'MAX',
};

export const quoteIdent = (name: string) =>
  /^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
const strLit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const norm = (s: string) => s.trim().toLowerCase();

class Compiler {
  warnings = new Set<string>();

  deps = new Set<string>();

  private stack: string[] = [];

  private parsed = new Map<string, Node>();

  private model: Model;

  constructor(model: Model) {
    this.model = model;
  }

  // ---------------------------------------------------------------- lookup

  findColumn(table: string, name: string, pos: number) {
    const n = norm(name);
    const t = norm(table);
    const col =
      this.model.columns.find(c => norm(c.name) === `${t}__${n}`) ||
      this.model.columns.find(c => norm(c.name) === `${t}.${n}`) ||
      this.model.columns.find(c => norm(c.name) === n);
    if (!col)
      throw new DaxError(
        `Unknown column ${table ? `'${table}'` : ''}[${name}]`,
        pos,
      );
    return col;
  }

  colSql(col: ModelColumn) {
    return col.expression ? `(${col.expression})` : quoteIdent(col.name);
  }

  param(name: string) {
    const n = norm(name);
    return (this.model.parameters || []).find(
      p => norm(p.name) === n || `${norm(p.name)} value` === n,
    );
  }

  paramSql(p: ModelParameter) {
    const def = Number.isFinite(p.default) ? p.default : 0;
    return `{{ dax_num(filter_values(${JSON.stringify(p.column)}), ${def}) }}`;
  }

  measureNode(name: string): Node | undefined {
    const key = Object.keys(this.model.measures).find(
      k => norm(k) === norm(name),
    );
    if (key === undefined) return undefined;
    if (!this.parsed.has(key))
      this.parsed.set(key, parseMeasure(this.model.measures[key]).expr);
    return this.parsed.get(key);
  }

  // ---------------------------------------------------------------- helpers

  spec(ctx: Ctx, withTime = true): Record<string, unknown> {
    const s: Record<string, unknown> = {
      dialect: this.model.dialect || 'postgresql',
    };
    if (ctx.keep) s.keep = ctx.keep;
    else
      s.remove =
        ctx.remove === 'all'
          ? 'all'
          : [...new Set([...ctx.remove, ...ctx.filterCols])];
    if (withTime) {
      if (ctx.time) s.time = ctx.time;
      if (ctx.shift) s.shift = ctx.shift;
      if (ctx.time || ctx.shift) s.date = ctx.date;
    }
    return s;
  }

  needsWindow(ctx: Ctx, includeFilterCols = true) {
    return (
      ctx.remove === 'all' ||
      ctx.remove.length > 0 ||
      !!ctx.keep ||
      !!ctx.time ||
      !!ctx.shift ||
      (includeFilterCols && ctx.filterCols.length > 0)
    );
  }

  window(base: string, reagg: string, ctx: Ctx): string {
    const js = (o: unknown) => JSON.stringify(o);
    const spec = this.spec(ctx);
    const win = `${reagg}(${base}) {{ dax_over(columns, time_grain, ${js(spec)}) }}`;
    if (!ctx.time && !ctx.shift) return win;
    // time intelligence needs the chart to be split by the date column
    const noTime = this.spec(ctx, false);
    const hasOther =
      noTime.keep ||
      (Array.isArray(noTime.remove) ? noTime.remove.length : true);
    let fallback = 'NULL';
    if (ctx.time) {
      fallback = hasOther
        ? `${reagg}(${base}) {{ dax_over(columns, time_grain, ${js(noTime)}) }}`
        : base;
    }
    return `{% if dax_ok(columns, ${js(spec)}) %}${win}{% else %}${fallback}{% endif %}`;
  }

  aggregate(fn: string, arg: string, ctx: Ctx, pos: number): string {
    if (ctx.row)
      throw new DaxError(
        'Aggregations inside an iterator or filter row are not supported',
        pos,
      );
    const cond = ctx.filters.length
      ? ctx.filters.map(f => `(${f})`).join(' AND ')
      : '';
    const wrap = (x: string) => (cond ? `CASE WHEN ${cond} THEN ${x} END` : x);
    let base: string;
    let kind = fn;
    switch (fn) {
      case 'ROWS':
        base = cond ? `COUNT(CASE WHEN ${cond} THEN 1 END)` : 'COUNT(*)';
        break;
      case 'COUNTBLANK':
        base = `COUNT(CASE WHEN ${cond ? `${cond} AND ` : ''}${arg} IS NULL THEN 1 END)`;
        kind = 'ROWS';
        break;
      case 'DISTINCT':
        if (this.needsWindow(ctx, false)) {
          throw new DaxError(
            'DISTINCTCOUNT cannot be combined with ALL / time intelligence',
            pos,
          );
        }
        if (ctx.filterCols.length) {
          this.warnings.add(
            'DISTINCTCOUNT with a CALCULATE filter keeps the chart grouping on that column (Power BI would override it).',
          );
        }
        return `COUNT(DISTINCT ${wrap(arg)})`;
      case 'AVG':
        if (this.needsWindow(ctx)) {
          const s = this.window(`SUM(${wrap(arg)})`, 'SUM', ctx);
          const c = this.window(`COUNT(${wrap(arg)})`, 'SUM', ctx);
          return `((${s}) * 1.0 / NULLIF(${c}, 0))`;
        }
        return `AVG(${wrap(arg)})`;
      default:
        base = `${fn}(${wrap(arg)})`;
    }
    return this.needsWindow(ctx) ? this.window(base, REAGG[kind], ctx) : base;
  }

  dateColumn(node: Node): string {
    if (node.kind !== 'col' && node.kind !== 'ref') {
      throw new DaxError("Expected a date column, e.g. 'Date'[order_date]");
    }
    const col =
      node.kind === 'col'
        ? this.findColumn(node.table, node.name, node.pos)
        : this.findColumn('', node.name, node.pos);
    if (col.isDate === false)
      throw new DaxError(
        `${col.name} is not a date column`,
        node.kind === 'col' ? node.pos : -1,
      );
    return col.name;
  }

  setShift(ctx: Ctx, unit: string, n: number, date: string) {
    if (ctx.time)
      throw new DaxError(
        'Combining a YTD/QTD/MTD total with a date shift is not supported yet',
      );
    if (ctx.shift && ctx.shift.unit !== unit)
      throw new DaxError(
        'Combining date shifts of different units is not supported',
      );
    ctx.shift = { unit, n: (ctx.shift?.n || 0) + n };
    ctx.date = date;
  }

  columnsIn(node: Node, out: string[] = []): string[] {
    if (node.kind === 'col')
      out.push(this.findColumn(node.table, node.name, node.pos).name);
    else if (
      node.kind === 'ref' &&
      !this.measureNode(node.name) &&
      !this.param(node.name)
    ) {
      out.push(this.findColumn('', node.name, node.pos).name);
    } else if (node.kind === 'bin') {
      this.columnsIn(node.left, out);
      this.columnsIn(node.right, out);
    } else if (node.kind === 'unary') this.columnsIn(node.expr, out);
    else if (node.kind === 'in') this.columnsIn(node.expr, out);
    else if (node.kind === 'call')
      node.args.forEach(a => this.columnsIn(a, out));
    return out;
  }

  /** Apply one CALCULATE filter argument to the context. */
  applyFilter(arg: Node, ctx: Ctx) {
    if (arg.kind === 'call') {
      const { name } = arg;
      if (
        ['ALL', 'REMOVEFILTERS', 'ALLSELECTED', 'ALLNOBLANKROW'].includes(name)
      ) {
        const cols = arg.args.filter(a => a.kind !== 'table');
        if (!cols.length) ctx.remove = 'all';
        else if (ctx.remove !== 'all') {
          ctx.remove = [...ctx.remove, ...cols.map(c => this.dateOrCol(c))];
        }
        return;
      }
      if (name === 'ALLEXCEPT') {
        ctx.keep = arg.args
          .filter(a => a.kind !== 'table')
          .map(c => this.dateOrCol(c));
        return;
      }
      if (name === 'KEEPFILTERS') {
        arg.args.forEach(a => {
          if (a.kind === 'call') this.applyFilter(a, ctx);
          else
            ctx.filters.push(
              this.compile(a, { ...ctx, row: true, filters: [] }),
            );
        });
        return;
      }
      if (name === 'FILTER') {
        const [table, cond] = arg.args;
        if (table?.kind === 'call') this.applyFilter(table, ctx);
        if (!cond)
          throw new DaxError('FILTER needs a table and a condition', arg.pos);
        ctx.filters.push(
          this.compile(cond, { ...ctx, row: true, filters: [] }),
        );
        return;
      }
      if (SHIFTS[name]) {
        const [unit, n] = SHIFTS[name];
        this.setShift(ctx, unit, n, this.dateColumn(arg.args[0]));
        return;
      }
      if (name === 'DATEADD' || name === 'PARALLELPERIOD') {
        const [date, nNode, unitNode] = arg.args;
        const n = this.constNumber(nNode);
        const unit =
          unitNode?.kind === 'table' ? unitNode.name.toLowerCase() : '';
        if (!['year', 'quarter', 'month', 'day'].includes(unit)) {
          throw new DaxError(
            `${name} needs YEAR, QUARTER, MONTH or DAY`,
            arg.pos,
          );
        }
        this.setShift(ctx, unit, n, this.dateColumn(date));
        return;
      }
      if (TO_DATE[name]) {
        if (ctx.shift)
          throw new DaxError(
            'Combining a YTD/QTD/MTD total with a date shift is not supported yet',
          );
        ctx.time = TO_DATE[name];
        ctx.date = this.dateColumn(arg.args[0]);
        return;
      }
      if (name === 'USERELATIONSHIP' || name === 'CROSSFILTER') {
        this.warnings.add(
          `${name} is ignored: relationships are defined once in the model.`,
        );
        return;
      }
    }
    // boolean filter: DAX replaces any existing filter on those columns
    ctx.filters.push(this.compile(arg, { ...ctx, row: true, filters: [] }));
    if (ctx.remove !== 'all' && !ctx.keep)
      ctx.filterCols = [...ctx.filterCols, ...this.columnsIn(arg)];
  }

  dateOrCol(node: Node): string {
    if (node.kind === 'col')
      return this.findColumn(node.table, node.name, node.pos).name;
    if (node.kind === 'ref')
      return this.findColumn('', node.name, node.pos).name;
    throw new DaxError('Expected a column, e.g. Customers[country]');
  }

  constNumber(node?: Node): number {
    if (node?.kind === 'num') return node.value;
    if (node?.kind === 'unary' && node.op === '-' && node.expr.kind === 'num')
      return -node.expr.value;
    throw new DaxError('Expected a number');
  }

  // ---------------------------------------------------------------- compile

  compileMeasure(name: string, ctx: Ctx): string {
    const node = this.measureNode(name)!;
    if (this.stack.includes(name.toLowerCase())) {
      throw new DaxError(
        `Measure [${name}] refers to itself (${[...this.stack, name].join(' → ')})`,
      );
    }
    this.deps.add(name);
    this.stack.push(name.toLowerCase());
    try {
      return `(${this.compile(node, ctx)})`;
    } finally {
      this.stack.pop();
    }
  }

  compile(node: Node, ctx: Ctx): string {
    switch (node.kind) {
      case 'num':
        return String(node.value);
      case 'str':
        return strLit(node.value);
      case 'bool':
        return node.value ? 'TRUE' : 'FALSE';
      case 'blank':
        return 'NULL';
      case 'col': {
        const p = this.param(node.table) || this.param(node.name);
        if (
          p &&
          (norm(node.name) === `${norm(p.name)} value` ||
            norm(node.table) === norm(p.name))
        ) {
          return this.paramSql(p);
        }
        const col = this.findColumn(node.table, node.name, node.pos);
        if (!ctx.row) {
          throw new DaxError(
            `${node.table}[${node.name}] needs an aggregation here, e.g. SUM(${node.table}[${node.name}])`,
            node.pos,
          );
        }
        return this.colSql(col);
      }
      case 'ref': {
        if (this.measureNode(node.name)) {
          if (ctx.row)
            throw new DaxError(
              `Measure [${node.name}] cannot be used inside a row expression`,
              node.pos,
            );
          return this.compileMeasure(node.name, ctx);
        }
        const p = this.param(node.name);
        if (p) return this.paramSql(p);
        const col = this.findColumn('', node.name, node.pos);
        if (!ctx.row)
          throw new DaxError(
            `[${node.name}] is a column: wrap it in SUM(...) or another aggregation`,
            node.pos,
          );
        return this.colSql(col);
      }
      case 'table':
        throw new DaxError(
          `"${node.name}" is a table: use it inside SUMX, COUNTROWS, FILTER or ALL`,
          node.pos,
        );
      case 'unary': {
        const e = this.compile(node.expr, ctx);
        return node.op === 'NOT'
          ? `(NOT ${e})`
          : node.op === '-'
            ? `(-${e})`
            : e;
      }
      case 'in': {
        if (node.list.kind !== 'list')
          throw new DaxError('IN needs a list like { "A", "B" }');
        const items = node.list.items.map(i => this.compile(i, ctx)).join(', ');
        return `(${this.compile(node.expr, ctx)} ${node.negate ? 'NOT IN' : 'IN'} (${items}))`;
      }
      case 'list':
        throw new DaxError('A list { ... } can only be used with IN');
      case 'bin': {
        const l = this.compile(node.left, ctx);
        const r = this.compile(node.right, ctx);
        switch (node.op) {
          case '/':
            return `(${l} * 1.0 / NULLIF(${r}, 0))`;
          case '^':
            return `POWER(${l}, ${r})`;
          case '&':
            return `(CAST(${l} AS VARCHAR) || CAST(${r} AS VARCHAR))`;
          case '&&':
            return `(${l} AND ${r})`;
          case '||':
            return `(${l} OR ${r})`;
          default:
            return `(${l} ${node.op} ${r})`;
        }
      }
      case 'call':
        return this.call(node, ctx);
      default:
        throw new DaxError('Unsupported expression');
    }
  }

  call(node: Extract<Node, { kind: 'call' }>, ctx: Ctx): string {
    const { name, args, pos } = node;
    const c = (n: Node, x: Ctx = ctx) => this.compile(n, x);
    const need = (k: number) => {
      if (args.length < k)
        throw new DaxError(
          `${name} needs ${k} argument${k > 1 ? 's' : ''}`,
          pos,
        );
    };

    // MIN / MAX with two values are scalar functions
    if ((name === 'MIN' || name === 'MAX') && args.length === 2) {
      return `${name === 'MIN' ? 'LEAST' : 'GREATEST'}(${c(args[0])}, ${c(args[1])})`;
    }
    if (AGGREGATIONS[name]) {
      const fn = AGGREGATIONS[name];
      if (fn === 'ROWS') {
        let inner = ctx;
        if (args[0]?.kind === 'call' && args[0].name === 'FILTER') {
          inner = { ...ctx, filters: [...ctx.filters] };
          this.applyFilter(args[0], inner);
        }
        return this.aggregate('ROWS', '1', inner, pos);
      }
      need(1);
      return this.aggregate(fn, c(args[0], { ...ctx, row: true }), ctx, pos);
    }
    if (ITERATORS[name]) {
      need(2);
      const inner: Ctx = { ...ctx, filters: [...ctx.filters] };
      if (args[0].kind === 'call') this.applyFilter(args[0], inner);
      return this.aggregate(
        ITERATORS[name],
        c(args[1], { ...inner, row: true, filters: [] }),
        inner,
        pos,
      );
    }
    if (name === 'CALCULATE') {
      need(1);
      const inner: Ctx = {
        ...ctx,
        filters: [...ctx.filters],
        filterCols: [...ctx.filterCols],
        remove: ctx.remove === 'all' ? 'all' : [...ctx.remove],
      };
      args.slice(1).forEach(a => this.applyFilter(a, inner));
      return c(args[0], inner);
    }
    if (TOTALS[name]) {
      need(2);
      const inner: Ctx = {
        ...ctx,
        filters: [...ctx.filters],
        filterCols: [...ctx.filterCols],
        remove: ctx.remove === 'all' ? 'all' : [...ctx.remove],
      };
      this.applyFilter(
        { kind: 'call', name: TOTALS[name], args: [args[1]], pos },
        inner,
      );
      args.slice(2).forEach(a => this.applyFilter(a, inner));
      return c(args[0], inner);
    }
    switch (name) {
      case 'DIVIDE': {
        need(2);
        const a = c(args[0]);
        const b = c(args[1]);
        const alt = args[2] ? c(args[2]) : 'NULL';
        return `(CASE WHEN ${b} = 0 OR ${b} IS NULL THEN ${alt} ELSE ${a} * 1.0 / ${b} END)`;
      }
      case 'IF': {
        need(2);
        return `(CASE WHEN ${c(args[0])} THEN ${c(args[1])} ELSE ${args[2] ? c(args[2]) : 'NULL'} END)`;
      }
      case 'SWITCH': {
        need(3);
        const [subject, ...rest] = args;
        const pairs: string[] = [];
        const isTrue = subject.kind === 'bool' && subject.value;
        for (let i = 0; i + 1 < rest.length; i += 2) {
          pairs.push(
            isTrue
              ? `WHEN ${c(rest[i])} THEN ${c(rest[i + 1])}`
              : `WHEN ${c(rest[i])} THEN ${c(rest[i + 1])}`,
          );
        }
        const other =
          rest.length % 2 ? ` ELSE ${c(rest[rest.length - 1])}` : '';
        return isTrue
          ? `(CASE ${pairs.join(' ')}${other} END)`
          : `(CASE ${c(subject)} ${pairs.join(' ')}${other} END)`;
      }
      case 'AND':
        need(2);
        return `(${c(args[0])} AND ${c(args[1])})`;
      case 'OR':
        need(2);
        return `(${c(args[0])} OR ${c(args[1])})`;
      case 'NOT':
        need(1);
        return `(NOT ${c(args[0])})`;
      case 'ISBLANK':
        need(1);
        return `(${c(args[0])} IS NULL)`;
      case 'COALESCE':
        need(2);
        return `COALESCE(${args.map(a => c(a)).join(', ')})`;
      case 'ABS':
      case 'SQRT':
      case 'EXP':
      case 'LN':
        need(1);
        return `${name}(${c(args[0])})`;
      case 'INT':
        need(1);
        return `FLOOR(${c(args[0])})`;
      case 'ROUND':
      case 'ROUNDUP':
      case 'ROUNDDOWN': {
        need(1);
        const digits = args[1] ? c(args[1]) : '0';
        const x = c(args[0]);
        const isPg = /postgres|redshift/.test(
          this.model.dialect || 'postgresql',
        );
        const num = isPg ? `CAST(${x} AS NUMERIC)` : x;
        if (name === 'ROUND') return `ROUND(${num}, ${digits})`;
        const f = name === 'ROUNDUP' ? 'CEIL' : 'FLOOR';
        return `(${f}(${x} * POWER(10, ${digits})) / POWER(10, ${digits}))`;
      }
      case 'POWER':
        need(2);
        return `POWER(${c(args[0])}, ${c(args[1])})`;
      case 'MOD':
        need(2);
        return `MOD(${c(args[0])}, ${c(args[1])})`;
      case 'CONCATENATE':
        need(2);
        return `(CAST(${c(args[0])} AS VARCHAR) || CAST(${c(args[1])} AS VARCHAR))`;
      case 'SELECTEDVALUE': {
        need(1);
        const col = c(args[0], { ...ctx, row: true });
        return `(CASE WHEN COUNT(DISTINCT ${col}) = 1 THEN MIN(${col}) ELSE ${args[1] ? c(args[1]) : 'NULL'} END)`;
      }
      case 'HASONEVALUE':
        need(1);
        return `(COUNT(DISTINCT ${c(args[0], { ...ctx, row: true })}) = 1)`;
      case 'RANKX': {
        need(2);
        const [table, expr, , orderNode, tiesNode] = args;
        const rctx: Ctx = {
          ...ctx,
          filters: [...ctx.filters],
          filterCols: [],
          remove: 'all',
        };
        if (table.kind === 'call') {
          rctx.remove = [];
          this.applyFilter(table, rctx);
        }
        const value = c(expr, { ...ctx });
        if (/dax_over|OVER \(/.test(value)) {
          throw new DaxError(
            'RANKX over a measure that uses ALL or time intelligence is not supported',
            pos,
          );
        }
        const asc =
          (orderNode?.kind === 'table' &&
            orderNode.name.toUpperCase() === 'ASC') ||
          (orderNode?.kind === 'num' && orderNode.value === 1);
        const dense =
          tiesNode?.kind === 'table' && tiesNode.name.toUpperCase() === 'DENSE';
        const spec = JSON.stringify(this.spec(rctx, false));
        return `${dense ? 'DENSE_RANK' : 'RANK'}() OVER ({{ dax_partition(columns, ${spec}) }} ORDER BY ${value} ${asc ? 'ASC' : 'DESC'})`;
      }
      default:
        if (
          SHIFTS[name] ||
          TO_DATE[name] ||
          name === 'DATEADD' ||
          name === 'ALL' ||
          name === 'FILTER'
        ) {
          throw new DaxError(`${name} must be used inside CALCULATE(...)`, pos);
        }
        throw new DaxError(`Function ${name} is not supported yet`, pos);
    }
  }
}

/** Compile a measure formula ("Name := ..." or just the formula). */
export function compileMeasure(formula: string, model: Model): CompileResult {
  const { name, expr } = parseMeasure(formula);
  const compiler = new Compiler({
    ...model,
    // a measure may not refer to itself
    measures: Object.fromEntries(
      Object.entries(model.measures).filter(
        ([k]) => !name || norm(k) !== norm(name),
      ),
    ),
  });
  const root: Ctx = { filters: [], remove: [], filterCols: [], row: false };
  if (name && model.measures[name] !== undefined) compiler.deps.delete(name);
  const sql = compiler.compile(expr, root);
  if (
    /OVER \(|dax_over|dax_partition/.test(sql) &&
    !/postgres|redshift|duckdb|snowflake/.test(model.dialect || 'postgresql')
  ) {
    compiler.warnings.add(
      'Time shifts on this database use row offsets: missing periods can shift results.',
    );
  }
  if (/dax_over|dax_partition|dax_num/.test(sql)) {
    compiler.warnings.add(
      'Uses Superset templates (ENABLE_TEMPLATE_PROCESSING) and the semantic helpers in superset_config.',
    );
  }
  return {
    sql,
    warnings: [...compiler.warnings],
    dependsOn: [...compiler.deps],
    usesTemplates: /\{\{|\{%/.test(sql),
  };
}

export { DaxError };
