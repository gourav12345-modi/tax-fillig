export class TaxPathError extends Error {
  constructor(message, path, index) {
    super(index == null ? message : `${message} (in "${path}" at offset ${index})`);
    this.name = 'TaxPathError';
    this.path = path;
    this.offset = index;
  }
}

const PUNCT = new Set(['.', '[', ']', '(', ')', ',', '?', ':', '*', '!']);
const OPERATORS = ['==', '!=', '<=', '>=', '&&', '||', '~=', '<', '>'];

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (c === '$' || c === '@' || c === '#') { out.push({ k: 'root', v: c, i }); i++; continue; }
    if (c === "'" || c === '"') {
      const quote = c; let j = i + 1, s = '';
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\') { s += src[j + 1]; j += 2; } else { s += src[j++]; }
      }
      if (j >= src.length) throw new TaxPathError('unterminated string literal', src, i);
      out.push({ k: 'string', v: s, i }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + (c === '-' ? 1 : 0);
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ k: 'number', v: Number(src.slice(i, j)), i }); i = j; continue;
    }
    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) { out.push({ k: 'op', v: op, i }); i += op.length; continue; }
    if (PUNCT.has(c)) { out.push({ k: 'punct', v: c, i }); i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_$-]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const kind = ['true', 'false', 'null'].includes(word) ? 'literal'
        : ['in', 'nin', 'exists', 'missing', 'isTrue', 'isFalse', 'empty', 'notEmpty'].includes(word) ? 'op'
          : 'name';
      out.push({ k: kind, v: word, i }); i = j; continue;
    }
    throw new TaxPathError(`unexpected character ${JSON.stringify(c)}`, src, i);
  }
  out.push({ k: 'end', v: null, i: src.length });
  return out;
}

class Parser {
  constructor(src) { this.src = src; this.toks = tokenize(src); this.p = 0; }
  peek(n = 0) { return this.toks[this.p + n]; }
  next() { return this.toks[this.p++]; }
  at(k, v) { const t = this.peek(); return t.k === k && (v === undefined || t.v === v); }
  expect(k, v) {
    const t = this.next();
    if (t.k !== k || (v !== undefined && t.v !== v)) {
      throw new TaxPathError(`expected ${v ?? k} but found ${JSON.stringify(t.v)}`, this.src, t.i);
    }
    return t;
  }

  parsePath() {

    if (!this.at('root')) {
      const t = this.peek();
      throw new TaxPathError(
        `expected a path starting with $, @ or #, or a literal, but found ${JSON.stringify(t.v)}`,
        this.src, t.i,
      );
    }
    const steps = [{ t: 'root', which: this.next().v }];
    for (;;) {
      if (this.at('punct', '.')) { this.next(); steps.push({ t: 'member', name: this.expect('name').v }); continue; }
      if (this.at('punct', '[')) { this.next(); steps.push(this.parseSubscript()); this.expect('punct', ']'); continue; }
      break;
    }
    return steps;
  }

  parseSubscript() {
    if (this.at('punct', '*')) { this.next(); return { t: 'wildcard' }; }
    if (this.at('punct', '?')) { this.next(); return { t: 'filter', expr: this.parseExpr() }; }
    if (this.at('string')) return { t: 'member', name: this.next().v };
    if (this.at('punct', ':') || this.at('number')) {
      const from = this.at('number') ? this.next().v : null;
      if (this.at('punct', ':')) { this.next(); const to = this.at('number') ? this.next().v : null; return { t: 'slice', from, to }; }
      if (!Number.isInteger(from)) throw new TaxPathError('array index must be an integer', this.src, this.peek().i);
      return { t: 'index', i: from };
    }
    throw new TaxPathError('invalid subscript', this.src, this.peek().i);
  }

  parseExpr() { return this.parseOr(); }
  parseOr() {
    let a = this.parseAnd();
    while (this.at('op', '||')) { this.next(); a = { t: 'or', a, b: this.parseAnd() }; }
    return a;
  }
  parseAnd() {
    let a = this.parseUnary();
    while (this.at('op', '&&')) { this.next(); a = { t: 'and', a, b: this.parseUnary() }; }
    return a;
  }
  parseUnary() {
    if (this.at('punct', '!')) { this.next(); return { t: 'not', a: this.parseUnary() }; }
    if (this.at('punct', '(')) { this.next(); const e = this.parseExpr(); this.expect('punct', ')'); return e; }
    const left = this.parseOperand();
    if (this.at('op')) {
      const op = this.next().v;
      if (['exists', 'missing', 'isTrue', 'isFalse', 'empty', 'notEmpty'].includes(op)) return { t: 'unary', op, arg: left };
      return { t: 'cmp', op, left, right: this.parseOperand() };
    }
    return { t: 'unary', op: 'isTrue', arg: left };
  }
  parseOperand() {
    if (this.at('punct', '[')) {
      this.next();
      const items = [];
      while (!this.at('punct', ']')) {
        items.push(this.parseOperand().v);
        if (this.at('punct', ',')) this.next();
      }
      this.expect('punct', ']');
      return { t: 'lit', v: items };
    }
    if (this.at('string')) return { t: 'lit', v: this.next().v };
    if (this.at('number')) return { t: 'lit', v: this.next().v };
    if (this.at('literal')) { const w = this.next().v; return { t: 'lit', v: w === 'null' ? null : w === 'true' }; }
    return { t: 'path', steps: this.parsePath() };
  }
}

const cache = new Map();
const predicateCache = new Map();

export function compile(expr) {
  if (typeof expr !== 'string') throw new TaxPathError(`path must be a string, got ${typeof expr}`, String(expr));
  let ast = cache.get(expr);
  if (ast) return ast;
  const parser = new Parser(expr);
  const steps = parser.parsePath();
  if (!parser.at('end')) throw new TaxPathError('trailing characters after path', expr, parser.peek().i);
  ast = { source: expr, steps };
  cache.set(expr, ast);
  return ast;
}

export function compilePredicate(expr) {
  if (typeof expr !== 'string') throw new TaxPathError(`predicate must be a string, got ${typeof expr}`, String(expr));
  let ast = predicateCache.get(expr);
  if (ast) return ast;
  const parser = new Parser(expr);
  const node = parser.parseExpr();
  if (!parser.at('end')) throw new TaxPathError('trailing characters after predicate', expr, parser.peek().i);
  ast = { source: expr, node };
  predicateCache.set(expr, ast);
  return ast;
}

function truthy(v) { return !(v === undefined || v === null || v === false || v === '' || v === 0 || (Array.isArray(v) && v.length === 0)); }

function compare(op, l, r) {
  switch (op) {
    case '==': return l === r || (l == null && r == null);
    case '!=': return !(l === r || (l == null && r == null));
    case '<': return l < r;
    case '<=': return l <= r;
    case '>': return l > r;
    case '>=': return l >= r;
    case 'in': return Array.isArray(r) && r.includes(l);
    case 'nin': return Array.isArray(r) && !r.includes(l);
    case '~=': return typeof l === 'string' && new RegExp(String(r)).test(l);
    default: throw new TaxPathError(`unknown comparison operator "${op}"`);
  }
}

function evalOperand(node, item, ctx) {
  if (node.t === 'lit') return node.v;
  const found = walk(node.steps, { ...ctx, current: item });
  return found.length === 0 ? undefined : found[0];
}

function evalExpr(node, item, ctx) {
  switch (node.t) {
    case 'and': return evalExpr(node.a, item, ctx) && evalExpr(node.b, item, ctx);
    case 'or': return evalExpr(node.a, item, ctx) || evalExpr(node.b, item, ctx);
    case 'not': return !evalExpr(node.a, item, ctx);
    case 'cmp': return compare(node.op, evalOperand(node.left, item, ctx), evalOperand(node.right, item, ctx));
    case 'unary': {
      const v = evalOperand(node.arg, item, ctx);
      switch (node.op) {
        case 'exists': return v !== undefined && v !== null;
        case 'missing': return v === undefined || v === null;
        case 'isTrue': return truthy(v);
        case 'isFalse': return !truthy(v);
        case 'empty': return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
        case 'notEmpty': return !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));
        default: throw new TaxPathError(`unknown predicate "${node.op}"`);
      }
    }
    default: throw new TaxPathError(`unknown expression node "${node.t}"`);
  }
}

function walk(steps, ctx) {
  let vals;
  const [head, ...rest] = steps;
  if (head.which === '$') vals = [ctx.root];
  else if (head.which === '@') vals = [ctx.current === undefined ? ctx.root : ctx.current];
  else vals = [ctx.meta ?? {}];

  for (const step of rest) {
    const out = [];
    for (const v of vals) {
      if (v === undefined || v === null) continue;
      switch (step.t) {
        case 'member':
          if (typeof v === 'object' && !Array.isArray(v) && step.name in v) out.push(v[step.name]);
          break;
        case 'index': {
          if (!Array.isArray(v)) break;
          const i = step.i < 0 ? v.length + step.i : step.i;
          if (i >= 0 && i < v.length) out.push(v[i]);
          break;
        }
        case 'wildcard':
          if (Array.isArray(v)) out.push(...v);
          else if (typeof v === 'object') out.push(...Object.values(v));
          break;
        case 'slice': {
          if (!Array.isArray(v)) break;
          out.push(...v.slice(step.from ?? 0, step.to ?? v.length));
          break;
        }
        case 'filter': {
          const items = Array.isArray(v) ? v : [v];
          for (const it of items) if (evalExpr(step.expr, it, ctx)) out.push(it);
          break;
        }
        default: throw new TaxPathError(`unknown step "${step.t}"`);
      }
    }
    vals = out;
    if (vals.length === 0) break;
  }
  return vals;
}

export function query(expr, ctx) {
  const ast = typeof expr === 'string' ? compile(expr) : expr;
  return walk(ast.steps, ctx);
}

export function test(expr, ctx) {
  const ast = typeof expr === 'string' ? compilePredicate(expr) : expr;
  return Boolean(evalExpr(ast.node, ctx.current === undefined ? ctx.root : ctx.current, ctx));
}

export function queryOne(expr, ctx) {
  const found = query(expr, ctx);
  if (found.length > 1) {
    const src = typeof expr === 'string' ? expr : expr.source;
    throw new TaxPathError(`path matched ${found.length} values but a single value is required`, src);
  }
  return found[0];
}
