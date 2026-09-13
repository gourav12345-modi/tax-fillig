#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';

const USAGE = `Composite a TFA overlay PDF onto the government form it was measured against.

The reference renderer emits a standalone overlay with identical page geometry;
this lays each overlay page over the matching form page so the demo produces
something you can actually look at.

    node tools/stamp.mjs fixtures/f1040.pdf build/1040-overlay.pdf build/1040-filled.pdf`;

const [basePath, overlayPath, outPath] = process.argv.slice(2);
if (!outPath) {
  console.error(USAGE);
  process.exit(1);
}

const base = await PDFDocument.load(readFileSync(basePath), { ignoreEncryption: true, updateMetadata: false });
const overlay = await PDFDocument.load(readFileSync(overlayPath), { updateMetadata: false });
const pages = base.getPages();
const indices = overlay.getPageIndices().filter((i) => i < pages.length);
const embedded = await base.embedPdf(overlay, indices);
embedded.forEach((page, i) => pages[indices[i]].drawPage(page));

// Drop the fillable-form layer (AcroForm and its XFA); otherwise viewers treat the result as an empty
// form and some render the XFA layer instead of the page content drawn above.
base.catalog.delete(PDFName.of('AcroForm'));

writeFileSync(outPath, await base.save());
console.log(`wrote ${outPath}`);
