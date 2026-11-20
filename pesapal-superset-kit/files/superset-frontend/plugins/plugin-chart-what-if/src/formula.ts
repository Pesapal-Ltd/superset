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
 * Tiny formula language for scenarios:
 *   [SUM(sales)] * (1 + [Price %] / 100) * (1 + [Volume %] / 100)
 * numbers, [names], + - * / ^, comparisons, ( ), and MIN MAX ABS ROUND IF.
 */

export type Expr =
  | { k: 'n'; v: number }
  | { k: 'ref'; name: string }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'neg'; e: Expr }
  | { k: 'fn'; name: string; args: Expr[] };

export class FormulaError extends Error {}

export function parseFormula(src: string): Expr {
  const toks: { t: string; v: string }[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) i += 1;
    else if (c === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new FormulaError('Unclosed [name]');
      toks.push({ t: 'ref', v: src.slice(i + 1, j).trim() });
      i = j + 1;
    } else if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(e[+-]?[0-9]+)?/i.exec(src.slice(i));
      if (!m) throw new FormulaError(`Bad number at ${i}`);
      toks.push({ t: 'n', v: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      toks.push({ t: 'id', v: m[0].toUpperCase() });
      i += m[0].length;
    } else {
      const at = i;
      const op = [
        '<=',
        '>=',
        '<>',
        '+',
        '-',
        '*',
        '/',
        '^',
        '(',
        ')',
        ',',
        '<',
        '>',
        '=',
      ].find(o => src.startsWith(o, at));
      if (!op) throw new FormulaError(`Unexpected "${c}"`);
      toks.push({ t: 'op', v: op });
      i += op.length;
    }
  }
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected "${v}"`);
    p += 1;
  };
  let expr: () => Expr;
  // eslint-disable-next-line prefer-const
  let unary: () => Expr;
  const primary = (): Expr => {
    const tk = toks[p];
    p += 1;
    if (!tk) throw new FormulaError('Formula ended too early');
    if (tk.t === 'n') return { k: 'n', v: Number(tk.v) };
    if (tk.t === 'ref') return { k: 'ref', name: tk.v };
    if (tk.t === 'id') {
      expect('(');
      const args: Expr[] = [];
      if (!isOp(')')) {
        for (;;) {
          args.push(expr());
          if (isOp(',')) p += 1;
          else break;
        }
      }
      expect(')');
      return { k: 'fn', name: tk.v, args };
    }
    if (tk.v === '(') {
      const e = expr();
      expect(')');
      return e;
    }
    if (tk.v === '-') return { k: 'neg', e: unary() };
    throw new FormulaError(`Unexpected "${tk.v}"`);
  };
  unary = (): Expr => primary();
  const pow = (): Expr => {
    const l = unary();
    if (isOp('^')) {
      p += 1;
      return { k: 'bin', op: '^', l, r: pow() };
    }
    return l;
  };
  const level = (ops: string[], next: () => Expr) => (): Expr => {
    let l = next();
    while (peek()?.t === 'op' && ops.includes(peek().v)) {
      const op = toks[p].v;
      p += 1;
      l = { k: 'bin', op, l, r: next() };
    }
    return l;
  };
  const mul = level(['*', '/'], pow);
  const add = level(['+', '-'], mul);
  const cmp = level(['<', '>', '<=', '>=', '=', '<>'], add);
  expr = cmp;
  const out = expr();
  if (p < toks.length) throw new FormulaError(`Unexpected "${toks[p].v}"`);
  return out;
}

export function refsOf(e: Expr, out = new Set<string>()): Set<string> {
  if (e.k === 'ref') out.add(e.name);
  if (e.k === 'bin') {
    refsOf(e.l, out);
    refsOf(e.r, out);
  }
  if (e.k === 'neg') refsOf(e.e, out);
  if (e.k === 'fn') e.args.forEach(a => refsOf(a, out));
  return out;
}

export function evaluate(
  e: Expr,
  vars: Record<string, number | null>,
): number | null {
  const ev = (x: Expr) => evaluate(x, vars);
  switch (e.k) {
    case 'n':
      return e.v;
    case 'ref': {
      const key = Object.keys(vars).find(
        k => k.toLowerCase() === e.name.toLowerCase(),
      );
      if (key === undefined) throw new FormulaError(`Unknown name [${e.name}]`);
      return vars[key];
    }
    case 'neg': {
      const v = ev(e.e);
      return v === null ? null : -v;
    }
    case 'bin': {
      const a = ev(e.l);
      const b = ev(e.r);
      if (a === null || b === null) return null;
      switch (e.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return b === 0 ? null : a / b;
        case '^':
          return a ** b;
        case '<':
          return a < b ? 1 : 0;
        case '>':
          return a > b ? 1 : 0;
        case '<=':
          return a <= b ? 1 : 0;
        case '>=':
          return a >= b ? 1 : 0;
        case '=':
          return a === b ? 1 : 0;
        default:
          return a !== b ? 1 : 0;
      }
    }
    default: {
      const args = e.args.map(ev);
      switch (e.name) {
        case 'MIN':
          return args.some(v => v === null)
            ? null
            : Math.min(...(args as number[]));
        case 'MAX':
          return args.some(v => v === null)
            ? null
            : Math.max(...(args as number[]));
        case 'ABS':
          return args[0] === null ? null : Math.abs(args[0]);
        case 'ROUND': {
          const f = 10 ** (args[1] ?? 0);
          return args[0] === null ? null : Math.round(args[0] * f) / f;
        }
        case 'IF':
          return args[0] ? (args[1] ?? null) : (args[2] ?? null);
        default:
          throw new FormulaError(`Unknown function ${e.name}`);
      }
    }
  }
}
