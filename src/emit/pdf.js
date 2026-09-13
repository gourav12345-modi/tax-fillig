import { toWinAnsi } from '../encoding.js';

const BASE14 = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Times-Roman', 'Times-Bold', 'Courier', 'Courier-Bold'];

function pdfString(text) {
  let out = '';
  for (const code of toWinAnsi(text).codes) {
    const ch = String.fromCharCode(code);
    if (ch === '(' || ch === ')' || ch === '\\') out += `\\${ch}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += ch;
  }
  return `(${out})`;
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '#000000');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function pageContent(page, fontIds) {
  const H = page.height;
  const parts = ['q'];
  let color = null;
  for (const op of page.ops) {
    const [r, g, b] = hexToRgb(op.color);
    const rgb = `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`;
    if (op.op === 'text') {
      parts.push('BT');
      if (rgb !== color) { parts.push(`${rgb} rg`); color = rgb; }
      parts.push(`/${fontIds[op.font] ?? fontIds.Helvetica} ${op.size} Tf`);
      if (op.letterSpacing) parts.push(`${op.letterSpacing} Tc`);
      if (op.scale !== 1) parts.push(`${(op.scale * 100).toFixed(2)} Tz`);
      parts.push(`1 0 0 1 ${op.x.toFixed(3)} ${(H - op.baseline).toFixed(3)} Tm`);
      parts.push(`${pdfString(op.text)} Tj`);
      if (op.letterSpacing) parts.push('0 Tc');
      if (op.scale !== 1) parts.push('100 Tz');
      parts.push('ET');
    } else if (op.op === 'mark') {
      const y0 = H - (op.y + op.h);
      if (op.shape === 'fill') parts.push(`${rgb} rg`, `${op.x} ${y0} ${op.w} ${op.h} re f`);
      else {
        parts.push(`${rgb} RG`, `${op.lineWidth} w`);
        if (op.shape === 'check') {
          parts.push(`${op.x + op.w * 0.15} ${y0 + op.h * 0.45} m`, `${op.x + op.w * 0.42} ${y0 + op.h * 0.18} l`, `${op.x + op.w * 0.88} ${y0 + op.h * 0.82} l`, 'S');
        } else {
          parts.push(`${op.x} ${y0} m`, `${op.x + op.w} ${y0 + op.h} l`, 'S', `${op.x + op.w} ${y0} m`, `${op.x} ${y0 + op.h} l`, 'S');
        }
      }
      color = null;
    } else if (op.op === 'image' || op.op === 'barcode') {
      const label = op.op === 'barcode'
        ? `${op.symbology} (renderer does not implement symbologies)`
        : 'image (renderer does not embed bitmaps)';
      const y0 = H - (op.y + op.h);
      parts.push('0.8 0 0 RG', '1 w', '[2 2] 0 d', `${op.x} ${y0} ${op.w} ${op.h} re S`, '[] 0 d');
      parts.push('BT', '0.8 0 0 rg', `/${fontIds.Helvetica} 6 Tf`, `1 0 0 1 ${(op.x + 2).toFixed(3)} ${(H - op.y - 8).toFixed(3)} Tm`, `${pdfString(label)} Tj`, 'ET');
      color = null;
    }

  }
  parts.push('Q');
  return parts.join('\n');
}

export function toPdf(printPlan) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };

  const fontIds = {};
  const fontObjs = [];
  BASE14.forEach((name, i) => {
    const id = `F${i + 1}`;
    fontIds[name] = id;
    fontObjs.push([id, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`)]);
  });

  const pagesId = objects.length + 1 + printPlan.pages.length * 2;
  const kids = [];
  for (const page of printPlan.pages) {
    const content = pageContent(page, fontIds);
    const streamId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    const resources = `<< /Font << ${fontObjs.map(([id, oid]) => `/${id} ${oid} 0 R`).join(' ')} >> >>`;
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources ${resources} /Contents ${streamId} 0 R >>`));
  }
  const realPagesId = add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  if (realPagesId !== pagesId) throw new Error('internal: page tree id reservation drifted');

  const now = new Date(printPlan.generatedAt ?? Date.now());
  const stamp = `D:${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`
    + `${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}Z`;
  const infoId = add(`<< /Producer ${pdfString('TFA reference renderer')} /Title ${pdfString(`${printPlan.source?.form?.number ?? 'form'} overlay`)} /CreationDate (${stamp}) >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${realPagesId} 0 R >>`);

  let pdf = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
