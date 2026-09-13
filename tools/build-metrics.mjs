#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const FONTS = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Times-Roman', 'Times-Bold', 'Courier', 'Courier-Bold'];
const FIRST = 32;
const LAST = 255;

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node tools/build-metrics.mjs <directory containing Helvetica.afm etc.>');
  process.exit(1);
}

const winansi = JSON.parse(readFileSync(new URL('./winansi-glyphs.json', import.meta.url), 'utf8'));

function parseAfm(path) {
  const src = readFileSync(path, 'latin1');
  const widths = new Map();
  for (const line of src.split('\n')) {
    const m = /^C\s+(-?\d+)\s*;\s*WX\s+(-?\d+)\s*;\s*N\s+(\S+)\s*;/.exec(line);
    if (m) widths.set(m[3], Number(m[2]));
  }
  const scalar = (key, fallback) => {
    const m = new RegExp(`^${key}\\s+(-?\\d+)`, 'm').exec(src);
    return m ? Number(m[1]) : fallback;
  };
  return {
    widths,
    metrics: {
      ascender: scalar('Ascender', 718),
      descender: scalar('Descender', -207),
      capHeight: scalar('CapHeight', 718),
      xHeight: scalar('XHeight', 523),
    },
  };
}

const available = new Set(readdirSync(dir));
const out = { widths: {}, metrics: {} };
for (const font of FONTS) {
  const file = `${font}.afm`;
  if (!available.has(file)) { console.error(`missing ${file} in ${dir}`); process.exit(1); }
  const { widths, metrics } = parseAfm(join(dir, file));
  const missing = new Set();
  const row = [];
  for (let code = FIRST; code <= LAST; code++) {
    const name = winansi[String(code)];
    if (!name) { row.push(0); continue; }
    const w = widths.get(name);
    if (w === undefined) { missing.add(name); row.push(widths.get('n') ?? 500); continue; }
    row.push(w);
  }
  if (missing.size) console.error(`${font}: no metric for ${[...missing].join(', ')}`);
  out.widths[font] = row;
  out.metrics[font] = metrics;
}

const lines = [
  '// GENERATED FILE — do not edit by hand.',
  '// Adobe AFM metrics for the PDF base-14 fonts, in a 1000-unit em, indexed by',
  '// WinAnsi character code (32-255). Regenerate with:',
  '//     node tools/build-metrics.mjs <afm-directory> > src/metrics.js',
  '',
  'export const GLYPH_WIDTHS = {',
  ...FONTS.map((f) => `  ${JSON.stringify(f)}: { first: ${FIRST}, widths: ${JSON.stringify(out.widths[f])} },`),
  '};',
  '',
  '// Vertical metrics (1000-unit em): used to resolve `valign` to a text baseline.',
  'export const FONT_METRICS = {',
  ...FONTS.map((f) => `  ${JSON.stringify(f)}: ${JSON.stringify(out.metrics[f])},`),
  '};',
  '',
];
process.stdout.write(lines.join('\n'));
