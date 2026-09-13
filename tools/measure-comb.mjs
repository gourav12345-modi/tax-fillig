#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USAGE = `Measure the printed dividers of a comb box (SSN, EIN, routing number, PIN) and
emit a ready-to-paste TFA "layout.cells" array.

Widget rectangles tell you where a box is; they do not tell you where the little
vertical ticks inside it fall, and on IRS forms those ticks are not evenly
spaced. Rather than eyeball them, rasterise the page and look.

    node tools/measure-comb.mjs fixtures/f1040.pdf --page 1 \\
        --rect 466 94 114 14 --digits 9 --right 576

Needs Ghostscript (gs) on PATH. Prints the divider x-positions in points and the
cells array they imply.

Options:
  --page N          1-based page number (default 1)
  --rect X Y W H    search rectangle in points, top-left origin (required)
  --digits N        number of characters the box holds (required)
  --coverage F      fraction of the band a column must be dark to count (default 0.6)
  --right X         closing edge in points, for boxes whose right rule doubles as a
                    page rule and so is not detected inside the crop`;

const DPI = 600;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseCli(argv) {
  const opts = { page: 1, coverage: 0.6, right: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const num = () => {
      const v = Number(argv[++i]);
      if (Number.isNaN(v)) fail(`${a} expects a number\n\n${USAGE}`);
      return v;
    };
    if (a === '--page') opts.page = num();
    else if (a === '--digits') opts.digits = num();
    else if (a === '--coverage') opts.coverage = num();
    else if (a === '--right') opts.right = num();
    else if (a === '--rect') opts.rect = [num(), num(), num(), num()];
    else if (a === '--help' || a === '-h') fail(USAGE);
    else if (a.startsWith('--')) fail(`unknown option ${a}\n\n${USAGE}`);
    else positional.push(a);
  }
  if (!positional[0] || !opts.rect || !opts.digits) fail(USAGE);
  return { pdf: positional[0], ...opts };
}

// Exact decimal rounding, ties to even, so re-measuring reproduces the cells already in the annotations.
function roundHalfEven(value, digits = 0) {
  const [whole, frac] = Math.abs(value).toFixed(digits + 20).split('.');
  const rest = frac.slice(digits);
  const half = `5${'0'.repeat(19)}`;
  let n = BigInt(whole + frac.slice(0, digits));
  if (rest > half || (rest === half && n % 2n === 1n)) n += 1n;
  return (Math.sign(value) * Number(n)) / 10 ** digits;
}

const fmt = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const fmtList = (list) => `[${list.map((v) => (Array.isArray(v) ? fmtList(v) : fmt(v))).join(', ')}]`;

function render(pdf, page) {
  const dir = mkdtempSync(join(tmpdir(), 'tfa-comb-'));
  const out = join(dir, 'page.pgm');
  execFileSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=pgmraw', `-r${DPI}`,
    `-dFirstPage=${page}`, `-dLastPage=${page}`, `-sOutputFile=${out}`, pdf], { stdio: ['ignore', 'ignore', 'inherit'] });
  const buf = readFileSync(out);
  rmSync(dir, { recursive: true, force: true });

  const tokens = [];
  let pos = 0;
  while (tokens.length < 4) {
    while (/\s/.test(String.fromCharCode(buf[pos]))) pos++;
    if (buf[pos] === 0x23) {
      while (buf[pos] !== 0x0a) pos++;
      continue;
    }
    const start = pos;
    while (!/\s/.test(String.fromCharCode(buf[pos]))) pos++;
    tokens.push(buf.toString('latin1', start, pos));
  }
  const [magic, width, height, maxval] = tokens;
  if (magic !== 'P5' || Number(maxval) > 255) fail(`unexpected Ghostscript output (${magic}, maxval ${maxval})`);
  return { width: Number(width), height: Number(height), pixels: buf.subarray(pos + 1) };
}

function dividers(img, [x, y, w, h], coverage) {
  const scale = DPI / 72;
  const x0 = Math.max(0, roundHalfEven(x * scale));
  const x1 = Math.min(img.width, roundHalfEven((x + w) * scale));
  const y0 = Math.max(0, roundHalfEven((y + h * 0.15) * scale));
  const y1 = Math.min(img.height, roundHalfEven((y + h * 0.85) * scale));
  const groups = [];
  for (let c = x0; c < x1; c++) {
    let dark = 0;
    for (let r = y0; r < y1; r++) if (img.pixels[r * img.width + c] < 128) dark++;
    if (dark <= (y1 - y0) * coverage) continue;
    const last = groups.at(-1);
    if (last && c - last.at(-1) <= 2) last.push(c);
    else groups.push([c]);
  }
  return groups.map((g) => roundHalfEven(g.reduce((a, b) => a + b, 0) / g.length / scale, 2));
}

function cellsFrom(edges, digits) {
  if (edges.length < 2) fail('found fewer than two rules; widen --rect or lower --coverage');

  if (edges.length === 2 * digits) {
    const origin = edges[0];
    const cells = Array.from({ length: digits }, (_, i) => [roundHalfEven(edges[2 * i] - origin, 2), roundHalfEven(edges[2 * i + 1] - edges[2 * i], 2)]);
    return { origin, width: edges.at(-1) - origin, cells };
  }

  const spans = edges.slice(0, -1).map((a, i) => [a, edges[i + 1]]);
  if (spans.length > digits) {
    fail(`measured ${edges.length} rules, which is neither ${digits + 1} group edges nor ${2 * digits} cell edges; check --rect and --coverage`);
  }
  const origin = edges[0];
  const total = edges.at(-1) - origin;
  const counts = spans.map(([a, b]) => Math.max(1, roundHalfEven((digits * (b - a)) / total)));
  while (counts.reduce((s, n) => s + n, 0) > digits) counts[counts.indexOf(Math.max(...counts))] -= 1;
  while (counts.reduce((s, n) => s + n, 0) < digits) counts[counts.indexOf(Math.min(...counts))] += 1;
  const cells = [];
  spans.forEach(([a, b], k) => {
    const width = (b - a) / counts[k];
    for (let i = 0; i < counts[k]; i++) cells.push([roundHalfEven(a + i * width - origin, 2), roundHalfEven(width, 2)]);
  });
  return { origin, width: total, cells };
}

const opts = parseCli(process.argv.slice(2));
const edges = dividers(render(opts.pdf, opts.page), opts.rect, opts.coverage);
if (opts.right !== null && (!edges.length || edges.at(-1) < opts.right - 0.5)) edges.push(opts.right);
console.log(`rules at (pt): ${fmtList(edges)}`);
const { origin, width, cells } = cellsFrom(edges, opts.digits);
console.log(`"box": [${fmt(origin)}, ${fmt(opts.rect[1])}, ${fmt(roundHalfEven(width, 2))}, ${fmt(opts.rect[3])}],`);
console.log(`"layout": { "mode": "comb", "cells": ${fmtList(cells)} }`);
