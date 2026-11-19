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
 * DAX lexer + parser (the subset used for measures).
 *
 *   Revenue := SUM(sales[sales])
 *   Margin % := DIVIDE([Revenue] - [Cost], [Revenue])
 *   Revenue LY := CALCULATE([Revenue], SAMEPERIODLASTYEAR('Date'[order_date]))
 */

export class DaxError extends Error {
  constructor(
    message: string,
    public pos = -1,
  ) {
    super(message);
  }
}

export type Node =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'blank' }
  /** Table[Column] */
  | { kind: 'col'; table: string; name: string; pos: number }
  /** [Name]: a measure, parameter or (inside iterators) a column */
  | { kind: 'ref'; name: string; pos: number }
  /** a bare table name, e.g. the first argument of SUMX / ALL */
  | { kind: 'table'; name: string; pos: number }
  | { kind: 'bin'; op: string; left: Node; right: Node }
  | { kind: 'unary'; op: string; expr: Node }
  | { kind: 'call'; name: string; args: Node[]; pos: number }
  | { kind: 'list'; items: Node[] }
  | { kind: 'in'; expr: Node; list: Node; negate: boolean };

type Tok =
  | { t: 'num'; v: number; p: number }
  | { t: 'str'; v: string; p: number }
  | { t: 'id'; v: string; p: number }
  | { t: 'qtable'; v: string; p: number }
  | { t: 'bracket'; v: string; p: number }
  | { t: 'op'; v: string; p: number }
  | { t: 'eof'; v: ''; p: number };

const OPS = [
  '&&',
  '||',
  '<=',
  '>=',
  '<>',
  '==',
  ':=',
  '+',
  '-',
  '*',
  '/',
  '^',
  '&',
  '=',
  '<',
  '>',
  '(',
  ')',
  ',',
  '{',
  '}',
];

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
    } else if (src.startsWith('//', i) || src.startsWith('--', i)) {
      while (i < src.length && src[i] !== '\n') i += 1;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new DaxError('Unclosed /* comment', i);
      i = end + 2;
    } else if (
      /[0-9]/.test(c) ||
      (c === '.' && /[0-9]/.test(src[i + 1] || ''))
    ) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]), p: i });
      i += m[0].length;
    } else if (c === '"') {
      let j = i + 1;
      let v = '';
      for (;;) {
        if (j >= src.length) throw new DaxError('Unclosed "text"', i);
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            v += '"';
            j += 2;
          } else break;
        } else {
          v += src[j];
          j += 1;
        }
      }
      out.push({ t: 'str', v, p: i });
      i = j + 1;
    } else if (c === "'") {
      let j = i + 1;
      let v = '';
      for (;;) {
        if (j >= src.length) throw new DaxError("Unclosed 'table name'", i);
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            v += "'";
            j += 2;
          } else break;
        } else {
          v += src[j];
          j += 1;
        }
      }
      out.push({ t: 'qtable', v, p: i });
      i = j + 1;
    } else if (c === '[') {
      let j = i + 1;
      let v = '';
      for (;;) {
        if (j >= src.length) throw new DaxError('Unclosed [name]', i);
        if (src[j] === ']') {
          if (src[j + 1] === ']') {
            v += ']';
            j += 2;
          } else break;
        } else {
          v += src[j];
          j += 1;
        }
      }
      out.push({ t: 'bracket', v: v.trim(), p: i });
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0], p: i });
      i += m[0].length;
    } else {
      const at = i;
      const op = OPS.find(o => src.startsWith(o, at));
      if (!op) throw new DaxError(`Unexpected character "${c}"`, i);
      out.push({ t: 'op', v: op, p: i });
      i += op.length;
    }
  }
  out.push({ t: 'eof', v: '', p: src.length });
  return out;
}

class Parser {
  i = 0;

  toks: Tok[];

  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  peek(k = 0) {
    return this.toks[Math.min(this.i + k, this.toks.length - 1)];
  }

  next() {
    const t = this.peek();
    this.i += 1;
    return t;
  }

  isOp(v: string) {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }

  isWord(v: string) {
    const t = this.peek();
    return t.t === 'id' && t.v.toUpperCase() === v;
  }

  expectOp(v: string) {
    const t = this.next();
    if (t.t !== 'op' || t.v !== v) throw new DaxError(`Expected "${v}"`, t.p);
  }

  parse(): Node {
    const e = this.or();
    const t = this.peek();
    if (t.t !== 'eof') throw new DaxError(`Unexpected "${t.v}"`, t.p);
    return e;
  }

  or(): Node {
    let l = this.and();
    while (this.isOp('||')) {
      this.next();
      l = { kind: 'bin', op: '||', left: l, right: this.and() };
    }
    return l;
  }

  and(): Node {
    let l = this.cmp();
    while (this.isOp('&&')) {
      this.next();
      l = { kind: 'bin', op: '&&', left: l, right: this.cmp() };
    }
    return l;
  }

  cmp(): Node {
    const l = this.concat();
    const t = this.peek();
    if (t.t === 'op' && ['=', '==', '<>', '<', '>', '<=', '>='].includes(t.v)) {
      this.next();
      return {
        kind: 'bin',
        op: t.v === '==' ? '=' : t.v,
        left: l,
        right: this.concat(),
      };
    }
    if (
      this.isWord('NOT') &&
      this.peek(1).t === 'id' &&
      String(this.peek(1).v).toUpperCase() === 'IN'
    ) {
      this.next();
      this.next();
      return { kind: 'in', expr: l, list: this.concat(), negate: true };
    }
    if (this.isWord('IN')) {
      this.next();
      return { kind: 'in', expr: l, list: this.concat(), negate: false };
    }
    return l;
  }

  concat(): Node {
    let l = this.add();
    while (this.isOp('&')) {
      this.next();
      l = { kind: 'bin', op: '&', left: l, right: this.add() };
    }
    return l;
  }

  add(): Node {
    let l = this.mul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = String(this.next().v);
      l = { kind: 'bin', op, left: l, right: this.mul() };
    }
    return l;
  }

  mul(): Node {
    let l = this.pow();
    while (this.isOp('*') || this.isOp('/')) {
      const op = String(this.next().v);
      l = { kind: 'bin', op, left: l, right: this.pow() };
    }
    return l;
  }

  pow(): Node {
    const l = this.unary();
    if (this.isOp('^')) {
      this.next();
      return { kind: 'bin', op: '^', left: l, right: this.pow() };
    }
    return l;
  }

  unary(): Node {
    if (this.isOp('-') || this.isOp('+')) {
      const op = String(this.next().v);
      return { kind: 'unary', op, expr: this.unary() };
    }
    if (
      this.isWord('NOT') &&
      !(this.peek(1).t === 'op' && this.peek(1).v === '(')
    ) {
      this.next();
      return { kind: 'unary', op: 'NOT', expr: this.unary() };
    }
    return this.primary();
  }

  args(): Node[] {
    this.expectOp('(');
    const out: Node[] = [];
    if (this.isOp(')')) {
      this.next();
      return out;
    }
    for (;;) {
      out.push(this.or());
      if (this.isOp(',')) {
        this.next();
      } else break;
    }
    this.expectOp(')');
    return out;
  }

  primary(): Node {
    const t = this.next();
    switch (t.t) {
      case 'num':
        return { kind: 'num', value: t.v };
      case 'str':
        return { kind: 'str', value: t.v };
      case 'bracket':
        return { kind: 'ref', name: t.v, pos: t.p };
      case 'qtable': {
        const n = this.peek();
        if (n.t === 'bracket') {
          this.next();
          return { kind: 'col', table: t.v, name: n.v, pos: t.p };
        }
        return { kind: 'table', name: t.v, pos: t.p };
      }
      case 'id': {
        const n = this.peek();
        if (n.t === 'bracket') {
          this.next();
          return { kind: 'col', table: t.v, name: n.v, pos: t.p };
        }
        if (n.t === 'op' && n.v === '(') {
          const name = t.v.toUpperCase();
          const args = this.args();
          if (name === 'TRUE' && !args.length)
            return { kind: 'bool', value: true };
          if (name === 'FALSE' && !args.length)
            return { kind: 'bool', value: false };
          if (name === 'BLANK' && !args.length) return { kind: 'blank' };
          return { kind: 'call', name, args, pos: t.p };
        }
        const up = t.v.toUpperCase();
        if (up === 'TRUE') return { kind: 'bool', value: true };
        if (up === 'FALSE') return { kind: 'bool', value: false };
        return { kind: 'table', name: t.v, pos: t.p };
      }
      case 'op':
        if (t.v === '(') {
          const e = this.or();
          this.expectOp(')');
          return e;
        }
        if (t.v === '{') {
          const items: Node[] = [];
          if (!this.isOp('}')) {
            for (;;) {
              items.push(this.or());
              if (this.isOp(',')) this.next();
              else break;
            }
          }
          this.expectOp('}');
          return { kind: 'list', items };
        }
        throw new DaxError(`Unexpected "${t.v}"`, t.p);
      default:
        throw new DaxError('Formula ended too early', t.p);
    }
  }
}

/** Parse "Name := formula" or just "formula". */
export function parseMeasure(src: string): { name?: string; expr: Node } {
  const idx = src.indexOf(':=');
  const prefix = idx >= 0 ? src.slice(0, idx) : '';
  if (idx >= 0 && !/["'(]/.test(prefix)) {
    const name = prefix
      .trim()
      .replace(/^\[|\]$/g, '')
      .trim();
    const offset = idx + 2;
    const toks = tokenize(src.slice(offset)).map(t => ({
      ...t,
      p: t.p + offset,
    }));
    return { name: name || undefined, expr: new Parser(toks as Tok[]).parse() };
  }
  return { expr: new Parser(tokenize(src)).parse() };
}
