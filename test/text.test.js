import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, contentBox, baselineFor, alignX, fit, wrap } from '../src/text.js';
import { unsupportedGlyphs, toWinAnsi } from '../src/encoding.js';

const near = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${a} !~= ${b}`);

test('widths come from the real font metrics', () => {

  near(measure('123456', 'Helvetica', 9), 30.024);
  near(measure('', 'Helvetica', 9), 0);

  near(measure('abcdefghij', 'Courier', 10), 60);
});

test('letter spacing counts the gaps, not the glyphs', () => {
  near(measure('abc', 'Helvetica', 10, 2), measure('abc', 'Helvetica', 10) + 4);
});

test('padding shrinks the content box', () => {
  assert.deepEqual(contentBox({ x: 504, y: 750, w: 72, h: 12 }, { right: 4 }), { x: 504, y: 750, w: 68, h: 12 });
  assert.deepEqual(contentBox({ x: 0, y: 0, w: 10, h: 10 }, 2), { x: 2, y: 2, w: 6, h: 6 });
});

test('right alignment puts the last glyph on the right edge of the content box', () => {
  const box = contentBox({ x: 504, y: 750, w: 72, h: 12 }, { right: 4 });
  const w = measure('250,443', 'Helvetica', 9);
  near(alignX('250,443', w, box, { align: 'right', fontName: 'Helvetica', size: 9 }) + w, 572);
});

test('decimal alignment keeps a cents column straight across rows', () => {
  const box = contentBox({ x: 0, y: 0, w: 100, h: 12 }, 0);
  const style = { align: 'decimal', fontName: 'Helvetica', size: 9, decimalTab: 20 };
  const point = (s) => alignX(s, measure(s, 'Helvetica', 9), box, style) + measure(s.split('.')[0], 'Helvetica', 9);
  near(point('1,284,650.42'), point('34.00'));
});

test('vertical alignment resolves to a baseline', () => {
  const box = { x: 0, y: 100, w: 50, h: 12 };
  assert.ok(baselineFor(box, 'top', 'Helvetica', 9) < baselineFor(box, 'middle', 'Helvetica', 9));
  assert.ok(baselineFor(box, 'middle', 'Helvetica', 9) < baselineFor(box, 'baseline', 'Helvetica', 9));
  near(baselineFor(box, 'baseline', 'Helvetica', 9), 112, 0.001);
});

test('shrink finds the largest size that fits and reports no overflow', () => {
  const box = { x: 0, y: 0, w: 90, h: 14 };
  const r = fit('BARTHOLOMEW WINTERBOTTOM', { fontName: 'Helvetica', size: 9, fit: { mode: 'shrink', min: 4 } }, box);
  assert.equal(r.overflow, false);
  assert.ok(r.size < 9 && r.size >= 4);
  assert.ok(measure(r.text, 'Helvetica', r.size) <= box.w);
});

test('shrink stops at its floor and says so rather than printing 2pt type', () => {
  const box = { x: 0, y: 0, w: 20, h: 14 };
  const r = fit('BARTHOLOMEW WINTERBOTTOM-SMYTHE', { fontName: 'Helvetica', size: 9, fit: { mode: 'shrink', min: 7 } }, box);
  assert.equal(r.size, 7);
  assert.equal(r.overflow, true);
});

test('condense squeezes horizontally instead of changing the type size', () => {
  const r = fit('1,284,650', { fontName: 'Helvetica', size: 9, fit: { mode: 'condense', minScale: 0.6 } }, { x: 0, y: 0, w: 30, h: 12 });
  assert.ok(r.scale < 1 && r.scale >= 0.6);
  assert.equal(r.size, 9);
});

test('ellipsis and wrap', () => {
  const r = fit('Data subscriptions and market feeds', { fontName: 'Helvetica', size: 9, fit: { mode: 'ellipsis' } }, { x: 0, y: 0, w: 60, h: 12 });
  assert.ok(r.text.endsWith('…'));
  assert.ok(measure(r.text, 'Helvetica', 9) <= 60);
  const lines = wrap('a much longer explanation that has to break across lines', 'Helvetica', 9, 80);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(measure(l, 'Helvetica', 9) <= 80);
});

test('a string that already fits is left exactly alone', () => {
  const r = fit('250,443', { fontName: 'Helvetica', size: 9, fit: { mode: 'shrink', min: 5 } }, { x: 0, y: 0, w: 68, h: 12 });
  assert.deepEqual([r.text, r.size, r.scale, r.overflow], ['250,443', 9, 1, false]);
});

test('WinAnsi covers the punctuation real taxpayer data carries', () => {
  assert.deepEqual(unsupportedGlyphs('O’Brien — Sørensen'), []);
  assert.deepEqual(toWinAnsi('—').codes, [0x97]);
  assert.deepEqual(unsupportedGlyphs('Ωmega'), ['Ω']);
  assert.deepEqual(unsupportedGlyphs('Ωmega', 'Unicode'), [], 'an embedded Unicode font is not our problem');
});

test('measurement agrees with what the emitter will actually draw', () => {

  near(measure('—', 'Helvetica', 10), 10.0);
});
