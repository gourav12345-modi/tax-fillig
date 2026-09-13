import { query } from './taxpath.js';

export class TransformError extends Error {
  constructor(msg) { super(msg); this.name = 'TransformError'; }
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  if (Number.isNaN(n)) throw new TransformError(`expected a number, got ${JSON.stringify(v)}`);
  return n;
};
const list = (v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]);

export function round(value, decimals = 0, mode = 'half-up') {
  const f = 10 ** decimals;
  const x = value * f;
  let r;
  switch (mode) {
    case 'half-up': r = Math.sign(x) * Math.round(Math.abs(x) + Number.EPSILON * Math.abs(x)); break;
    case 'half-even': {
      const fl = Math.floor(x); const diff = x - fl;
      r = diff > 0.5 ? fl + 1 : diff < 0.5 ? fl : (fl % 2 === 0 ? fl : fl + 1);
      break;
    }
    case 'down': r = Math.trunc(x); break;
    case 'up': r = Math.sign(x) * Math.ceil(Math.abs(x)); break;
    case 'floor': r = Math.floor(x); break;
    case 'ceil': r = Math.ceil(x); break;
    default: throw new TransformError(`unknown rounding mode "${mode}"`);
  }
  return r / f;
}

const TRANSFORMS = {

  sum: (v) => list(v).reduce((a, b) => a + num(b), 0),
  count: (v) => list(v).length,
  min: (v) => (list(v).length ? Math.min(...list(v).map(num)) : undefined),
  max: (v) => (list(v).length ? Math.max(...list(v).map(num)) : undefined),
  first: (v) => list(v)[0],
  last: (v) => list(v)[list(v).length - 1],
  join: (v, o) => list(v).filter((x) => x !== null && x !== undefined && x !== '').join(o.separator ?? ', '),

  pluck: (v, o, ctx) => list(v).flatMap((item) => query(o.path, { ...ctx, current: item })),

  abs: (v) => Math.abs(num(v)),
  negate: (v) => -num(v),
  add: (v, o) => num(v) + num(o.value),
  subtract: (v, o) => num(v) - num(o.value),
  multiply: (v, o) => num(v) * num(o.value),
  divide: (v, o) => (num(o.value) === 0 ? undefined : num(v) / num(o.value)),
  round: (v, o) => round(num(v), o.decimals ?? 0, o.mode ?? 'half-up'),
  clamp: (v, o) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, num(v))),

  upper: (v) => String(v ?? '').toUpperCase(),
  lower: (v) => String(v ?? '').toLowerCase(),
  trim: (v) => String(v ?? '').trim(),
  digits: (v) => String(v ?? '').replace(/\D/g, ''),
  slice: (v, o) => String(v ?? '').slice(o.start ?? 0, o.end),
  padStart: (v, o) => String(v ?? '').padStart(o.length ?? 0, o.char ?? '0'),
  concat: (v, o) => `${o.prefix ?? ''}${v ?? ''}${o.suffix ?? ''}`,

  default: (v, o) => (v === undefined || v === null || v === '' ? o.value : v),
};

export function applyTransforms(value, pipeline, ctx) {
  let v = value;
  for (const step of pipeline ?? []) {
    const fn = TRANSFORMS[step.op];
    if (!fn) throw new TransformError(`unknown transform "${step.op}"`);
    v = fn(v, step, ctx);
  }
  return v;
}
