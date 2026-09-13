import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatValue, FormatError } from '../src/format.js';
import { applyTransforms, round } from '../src/transform.js';

const USD = { type: 'number', decimals: 0, rounding: 'half-up', grouping: true, negative: 'parens', zero: 'blank', null: 'blank' };

test('whole dollars round half away from zero, the IRS rule', () => {
  assert.equal(round(2.5, 0, 'half-up'), 3);
  assert.equal(round(-2.5, 0, 'half-up'), -3);
  assert.equal(round(0.49, 0, 'half-up'), 0);
  assert.equal(round(2.5, 0, 'half-even'), 2);
  assert.equal(round(1284650.415, 2, 'half-up'), 1284650.42);
});

test('money formats the way a 1040 expects', () => {
  assert.equal(formatValue(189520.5, USD), '189,521');
  assert.equal(formatValue(-3000, USD), '(3,000)');
  assert.equal(formatValue(0, USD), '');
  assert.equal(formatValue(null, USD), '');
  assert.equal(formatValue(0, { ...USD, zero: 'dash' }), '-0-');
  assert.equal(formatValue(0.4, USD), '', 'rounds to zero first, then applies the zero rule');
  assert.equal(formatValue(-3000, { ...USD, negative: 'minus' }), '-3,000');
});

test('cents are kept when the form has a cents column', () => {
  const cents = { ...USD, decimals: 2, zero: 'zero' };
  assert.equal(formatValue(1284650.42, cents), '1,284,650.42');
  assert.equal(formatValue(0, cents), '0.00');
  assert.equal(formatValue(-0.34, { ...cents, negative: 'minus' }), '-0.34');
});

test('digits, masks and redaction', () => {
  const ssn = { type: 'digits', length: 9, mask: '###-##-####' };
  assert.equal(formatValue('412-55-7801', ssn), '412-55-7801');
  assert.equal(formatValue('412557801', ssn), '412-55-7801');
  assert.equal(formatValue('412557801', ssn, { redact: 'last4' }), 'XXX-XX-7801');
  assert.equal(formatValue('412557801', ssn, { redact: 'full' }), 'XXX-XX-XXXX');
  assert.equal(formatValue('87-1234567', { type: 'digits', length: 9, mask: '##-#######' }), '87-1234567');
  assert.equal(formatValue('412557801', { type: 'digits', length: 9 }), '412557801', 'a comb field wants bare digits');
});

test('a wrong-length identifier is an error, not a quietly truncated one', () => {
  assert.throws(() => formatValue('4125578', { type: 'digits', length: 9 }), FormatError);
  assert.equal(formatValue('4125578', { type: 'digits', length: 9, onLengthMismatch: 'pad' }), '004125578');
});

test('dates are parsed textually, so no timezone can shift them', () => {
  assert.equal(formatValue('2026-03-04', { type: 'date', pattern: 'MM/DD/YYYY' }), '03/04/2026');
  assert.equal(formatValue('2026-03-04', { type: 'date', pattern: 'MMM DD, YYYY' }), 'MAR 04, 2026');
  assert.equal(formatValue('2026-01-01T23:00:00Z', { type: 'date', pattern: 'MM/DD/YY' }), '01/01/26');
});

test('text case, length and truncation', () => {
  assert.equal(formatValue('daniel r', { type: 'text', case: 'upper' }), 'DANIEL R');
  assert.equal(formatValue('Bartholomew', { type: 'text', maxLength: 8 }), 'Bartholo');
  assert.equal(formatValue('Bartholomew', { type: 'text', maxLength: 8, truncate: 'ellipsis' }), 'Barthol…');
});

test('transform pipelines aggregate without leaving the closed operator set', () => {
  const ctx = { root: {} };
  assert.equal(applyTransforms([128400, 61120.5], [{ op: 'sum' }, { op: 'round', decimals: 0 }], ctx), 189521);
  assert.equal(applyTransforms([], [{ op: 'sum' }], ctx), 0, 'an empty set sums to a real zero, not a blank');
  assert.equal(applyTransforms('412-55-7801', [{ op: 'digits' }, { op: 'slice', start: 0, end: 3 }], ctx), '412');
  assert.equal(applyTransforms(-500, [{ op: 'clamp', min: 0 }], ctx), 0);
  assert.equal(applyTransforms(['a', '', null, 'b'], [{ op: 'join', separator: ' / ' }], ctx), 'a / b');
});

test('an unknown transform fails loudly instead of passing the value through', () => {
  assert.throws(() => applyTransforms(1, [{ op: 'launchMissiles' }], { root: {} }), /unknown transform/);
});
