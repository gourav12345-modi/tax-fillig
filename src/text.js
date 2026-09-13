import { GLYPH_WIDTHS, FONT_METRICS } from './metrics.js';
import { winAnsiCode } from './encoding.js';

export class TextLayoutError extends Error {
  constructor(msg) { super(msg); this.name = 'TextLayoutError'; }
}

const DEFAULT_METRICS = { ascender: 718, descender: -207, capHeight: 718, xHeight: 523 };

export function measure(text, fontName, size, letterSpacing = 0) {
  const table = GLYPH_WIDTHS[fontName];
  if (!table) throw new TextLayoutError(`no metrics for font "${fontName}"`);
  let units = 0;
  for (const ch of String(text)) {
    const code = winAnsiCode(ch) ?? '?'.charCodeAt(0);
    const w = code >= table.first && code < table.first + table.widths.length
      ? table.widths[code - table.first]
      : table.widths['n'.charCodeAt(0) - table.first];
    units += w;
  }
  return (units * size) / 1000 + Math.max(0, String(text).length - 1) * letterSpacing;
}

export const metricsFor = (fontName) => FONT_METRICS[fontName] ?? DEFAULT_METRICS;

function normalizePad(pad) {
  if (pad === undefined || pad === null) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (typeof pad === 'number') return { top: pad, right: pad, bottom: pad, left: pad };
  return { top: pad.top ?? 0, right: pad.right ?? 0, bottom: pad.bottom ?? 0, left: pad.left ?? 0 };
}

export function contentBox(box, pad) {
  const p = normalizePad(pad);
  return {
    x: box.x + p.left,
    y: box.y + p.top,
    w: Math.max(0, box.w - p.left - p.right),
    h: Math.max(0, box.h - p.top - p.bottom),
  };
}

export function baselineFor(content, valign, fontName, size) {
  const m = metricsFor(fontName);
  const asc = (m.ascender * size) / 1000;
  const desc = (m.descender * size) / 1000;
  const cap = (m.capHeight * size) / 1000;
  switch (valign ?? 'middle') {
    case 'top': return content.y + asc;
    case 'middle': return content.y + (content.h + cap) / 2;
    case 'bottom': return content.y + content.h + desc;
    case 'baseline': return content.y + content.h;
    default: throw new TextLayoutError(`unknown valign "${valign}"`);
  }
}

export function alignX(text, width, content, style) {
  const align = style.align ?? 'left';
  switch (align) {
    case 'left': return content.x;
    case 'center': return content.x + (content.w - width) / 2;
    case 'right': return content.x + content.w - width;
    case 'decimal': {
      const sep = style.decimalSeparator ?? '.';
      const at = text.lastIndexOf(sep);
      const head = at === -1 ? text : text.slice(0, at);
      const headWidth = measure(head, style.fontName, style.size, style.letterSpacing);
      const tab = style.decimalTab ?? 0;
      return content.x + content.w - tab - headWidth;
    }
    default: throw new TextLayoutError(`unknown align "${align}"`);
  }
}

export function wrap(text, fontName, size, width, letterSpacing = 0) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, fontName, size, letterSpacing) <= width || !line) {
        if (measure(candidate, fontName, size, letterSpacing) > width && !line) {
          let chunk = '';
          for (const ch of word) {
            if (measure(chunk + ch, fontName, size, letterSpacing) > width && chunk) { lines.push(chunk); chunk = ch; }
            else chunk += ch;
          }
          line = chunk;
        } else line = candidate;
      } else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

export function fit(text, style, content) {
  const { fontName, letterSpacing = 0 } = style;
  const policy = style.fit ?? { mode: 'clip' };
  const size = style.size;
  const width = content.w;
  const measured = measure(text, fontName, size, letterSpacing);
  if (measured <= width) return { text, size, scale: 1, lines: [text], overflow: false };

  switch (policy.mode) {
    case 'clip':
      return { text, size, scale: 1, lines: [text], overflow: true };
    case 'shrink': {
      const min = policy.min ?? 6;
      const step = policy.step ?? 0.25;
      for (let s = size - step; s >= min; s -= step) {
        if (measure(text, fontName, s, letterSpacing) <= width) {
          return { text, size: Number(s.toFixed(2)), scale: 1, lines: [text], overflow: false };
        }
      }
      return { text, size: min, scale: 1, lines: [text], overflow: true };
    }
    case 'condense': {
      const minScale = policy.minScale ?? 0.75;
      const scale = Math.max(minScale, width / measured);
      return { text, size, scale: Number(scale.toFixed(4)), lines: [text], overflow: scale === minScale && width / measured < minScale };
    }
    case 'ellipsis': {
      let out = text;
      while (out.length > 1 && measure(`${out}…`, fontName, size, letterSpacing) > width) out = out.slice(0, -1);
      return { text: `${out}…`, size, scale: 1, lines: [`${out}…`], overflow: true };
    }
    case 'wrap': {
      const lines = wrap(text, fontName, size, width, letterSpacing);
      const maxLines = policy.maxLines ?? Math.max(1, Math.floor(content.h / (policy.lineHeight ?? size * 1.15)));
      return { text, size, scale: 1, lines: lines.slice(0, maxLines), overflow: lines.length > maxLines };
    }
    default:
      throw new TextLayoutError(`unknown fit mode "${policy.mode}"`);
  }
}
