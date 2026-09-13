#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString } from 'pdf-lib';

const USAGE = `Dump the AcroForm widget rectangles of a fillable government PDF as TFA boxes.

This is how the example annotations were measured: the IRS ships its PDFs with a
widget for (almost) every fillable box, so the geometry in annotations/*.tfa.json
is the form's own. Coordinates are converted from PDF user space (origin
bottom-left) to the top-left origin TFA uses.

    node tools/extract-widgets.mjs fixtures/f1040.pdf           # TSV
    node tools/extract-widgets.mjs fixtures/f1040.pdf --json    # box arrays`;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error(USAGE);
  process.exit(1);
}

// Exact decimal rounding, ties to even, so re-extracting reproduces the boxes already in the annotations.
function roundHalfEven(value, digits = 2) {
  const [whole, frac] = Math.abs(value).toFixed(digits + 20).split('.');
  const rest = frac.slice(digits);
  const half = `5${'0'.repeat(19)}`;
  let n = BigInt(whole + frac.slice(0, digits));
  if (rest > half || (rest === half && n % 2n === 1n)) n += 1n;
  return (Math.sign(value) * Number(n)) / 10 ** digits;
}
const round2 = (v) => roundHalfEven(v, 2);

const doc = await PDFDocument.load(readFileSync(file), { ignoreEncryption: true, updateMetadata: false });
const rows = [];
doc.getPages().forEach((page, pageIndex) => {
  const { height } = page.getMediaBox();
  const annots = page.node.Annots();
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const widget = annots.lookup(i, PDFDict);
    const parent = widget.lookupMaybe(PDFName.of('Parent'), PDFDict);
    const name = widget.lookupMaybe(PDFName.of('T'), PDFString, PDFHexString) ?? parent?.lookupMaybe(PDFName.of('T'), PDFString, PDFHexString);
    const type = widget.lookupMaybe(PDFName.of('FT'), PDFName) ?? parent?.lookupMaybe(PDFName.of('FT'), PDFName);
    const rect = widget.lookup(PDFName.of('Rect'), PDFArray);
    const [ax, ay, bx, by] = [0, 1, 2, 3].map((k) => rect.lookup(k, PDFNumber).asNumber());
    const [x0, y0, x1, y1] = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    rows.push({
      page: pageIndex,
      acroField: name ? name.decodeText() : null,
      type: type ? type.toString() : '',
      box: [round2(x0), round2(height - y1), round2(x1 - x0), round2(y1 - y0)],
    });
  }
});

if (args.includes('--json')) {
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
} else {
  console.log('page\tacroField\ttype\tx\ty\tw\th');
  for (const r of rows) console.log([r.page, r.acroField, r.type, ...r.box].join('\t'));
}
