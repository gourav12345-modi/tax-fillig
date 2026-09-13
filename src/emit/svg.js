const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function toSvg(printPlan, { pageIndex = 0 } = {}) {
  const page = printPlan.pages.find((p) => p.index === pageIndex);
  if (!page) throw new Error(`plan has no page ${pageIndex}`);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
  ];

  for (const op of page.ops) {
    if (op.op === 'text') {
      const transform = op.scale !== 1 ? ` transform="translate(${op.x} ${op.baseline}) scale(${op.scale} 1)"` : '';
      const pos = op.scale !== 1 ? 'x="0" y="0"' : `x="${op.x}" y="${op.baseline}"`;
      parts.push(
        `<text ${pos}${transform} font-family="${esc(op.font)}, monospace" font-size="${op.size}" fill="${op.color}"`
        + `${op.letterSpacing ? ` letter-spacing="${op.letterSpacing}"` : ''} xml:space="preserve">${esc(op.text)}</text>`,
      );
    } else if (op.op === 'mark') {
      if (op.shape === 'fill') parts.push(`<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" fill="${op.color}"/>`);
      else if (op.shape === 'check') parts.push(`<path d="M${op.x + op.w * 0.15} ${op.y + op.h * 0.55} L${op.x + op.w * 0.42} ${op.y + op.h * 0.82} L${op.x + op.w * 0.88} ${op.y + op.h * 0.18}" fill="none" stroke="${op.color}" stroke-width="${op.lineWidth}"/>`);
      else parts.push(`<path d="M${op.x} ${op.y} L${op.x + op.w} ${op.y + op.h} M${op.x + op.w} ${op.y} L${op.x} ${op.y + op.h}" stroke="${op.color}" stroke-width="${op.lineWidth}"/>`);
    } else if (op.op === 'image') {
      parts.push(`<image href="${esc(op.href)}" x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" preserveAspectRatio="${op.fit === 'fill' ? 'none' : 'xMidYMid meet'}"/>`);
    } else if (op.op === 'barcode') {
      parts.push(`<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" fill="none" stroke="#c00" stroke-dasharray="2 2"/>`
        + `<text x="${op.x + 2}" y="${op.y + 8}" font-size="6" fill="#c00">${esc(op.symbology)} (renderer does not implement symbologies)</text>`);
    }
  }
  parts.push('</svg>');
  return parts.join('\n');
}
