import { round } from './transform.js';

export class FormatError extends Error {
  constructor(msg) { super(msg); this.name = 'FormatError'; }
}

const isBlank = (v) => v === undefined || v === null || v === '';

function groupDigits(intPart, sep) {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

function formatNumber(value, f) {
  const decimals = f.decimals ?? 0;
  let n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  if (Number.isNaN(n)) throw new FormatError(`value ${JSON.stringify(value)} is not numeric`);

  n = round(n, decimals, f.rounding ?? 'half-up');

  if (n === 0 && f.zero && f.zero !== 'zero') {
    if (f.zero === 'blank') return '';
    if (f.zero === 'dash') return '-0-';
    return String(f.zero);
  }

  const abs = Math.abs(n);
  const fixed = abs.toFixed(decimals);
  let [ip, dp] = fixed.split('.');
  if (f.grouping !== false) ip = groupDigits(ip, f.groupSeparator ?? ',');
  let body = dp ? `${ip}${f.decimalSeparator ?? '.'}${dp}` : ip;
  body = `${f.prefix ?? ''}${body}${f.suffix ?? ''}`;

  if (n < 0) {
    switch (f.negative ?? 'parens') {
      case 'parens': return `(${body})`;
      case 'minus': return `-${body}`;
      case 'trailing-minus': return `${body}-`;
      case 'abs': return body;
      default: throw new FormatError(`unknown negative style "${f.negative}"`);
    }
  }
  return body;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatDate(value, f) {
  let y, m, d;
  if (value instanceof Date) { y = value.getUTCFullYear(); m = value.getUTCMonth() + 1; d = value.getUTCDate(); }
  else {
    const s = String(value);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!iso) throw new FormatError(`date ${JSON.stringify(value)} is not an ISO-8601 date`);
    [, y, m, d] = iso.map(Number);
  }
  const pad = (v, n) => String(v).padStart(n, '0');
  return (f.pattern ?? 'MM/DD/YYYY')
    .replace(/YYYY/g, pad(y, 4)).replace(/YY/g, pad(y % 100, 2))
    .replace(/MMM/g, MONTHS[m - 1]).replace(/MM/g, pad(m, 2))
    .replace(/DD/g, pad(d, 2));
}

function applyMask(digits, mask) {
  let out = ''; let i = 0;
  for (const ch of mask) {
    if (ch === '#') { out += digits[i] ?? ''; i++; }
    else if (i < digits.length) out += ch;
  }
  return out + digits.slice(i);
}

function redactDigits(digits, mode, char = 'X') {
  if (!mode || mode === 'none') return digits;
  if (mode === 'full') return char.repeat(digits.length);
  if (mode === 'last4') return char.repeat(Math.max(0, digits.length - 4)) + digits.slice(-4);
  throw new FormatError(`unknown redaction mode "${mode}"`);
}

export function formatValue(value, f = {}, opts = {}) {
  const type = f.type ?? 'text';

  if (isBlank(value)) {
    if (type === 'number' && f.null === 'zero') value = 0;
    else return f.null === undefined || f.null === 'blank' ? '' : String(f.null);
  }

  let out;
  switch (type) {
    case 'text': out = String(value); break;
    case 'number': out = formatNumber(value, f); break;
    case 'date': out = formatDate(value, f); break;
    case 'boolean': out = value ? (f.trueText ?? 'X') : (f.falseText ?? ''); break;
    case 'digits': {
      let digits = String(value).replace(/\D/g, '');
      if (f.length && digits.length !== f.length) {
        if (f.onLengthMismatch === 'pad') digits = digits.padStart(f.length, '0');
        else if (f.onLengthMismatch !== 'ignore') {
          throw new FormatError(`expected ${f.length} digits but got ${digits.length} (${JSON.stringify(value)})`);
        }
      }
      digits = redactDigits(digits, opts.redact ?? f.redact, f.redactChar);
      out = f.mask ? applyMask(digits, f.mask) : digits;
      break;
    }
    default: throw new FormatError(`unknown format type "${type}"`);
  }

  if (f.case === 'upper') out = out.toUpperCase();
  else if (f.case === 'lower') out = out.toLowerCase();
  else if (f.case === 'title') out = out.replace(/\b\w/g, (c) => c.toUpperCase());

  if (f.maxLength && out.length > f.maxLength) {
    out = f.truncate === 'ellipsis' ? `${out.slice(0, Math.max(0, f.maxLength - 1))}…` : out.slice(0, f.maxLength);
  }
  return out;
}
