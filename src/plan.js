import { query, queryOne, test, TaxPathError } from './taxpath.js';
import { applyTransforms } from './transform.js';
import { formatValue } from './format.js';
import { measure, contentBox, baselineFor, alignX, fit, metricsFor } from './text.js';
import { resolveNamed, normalizeBox, matchSelector, deepMerge } from './compose.js';
import { unsupportedGlyphs } from './encoding.js';

export class PlanError extends Error {
  constructor(msg) { super(msg); this.name = 'PlanError'; }
}

class Diagnostics {
  constructor(strict) { this.items = []; this.strict = strict; }
  add(severity, code, fieldId, message, extra = {}) {
    this.items.push({ severity, code, fieldId, message, ...extra });
    if (this.strict && severity === 'error') throw new PlanError(`${code} on "${fieldId}": ${message}`);
  }
}

function resolveBind(bind, ctx, fieldId, diag) {
  if (bind === undefined) return { value: undefined, from: null };
  const spec = typeof bind === 'string' ? { path: bind } : bind;

  if ('literal' in spec) return { value: spec.literal, from: 'literal' };

  const candidates = [spec.path, ...(spec.fallback ?? [])].filter(Boolean);
  for (const path of candidates) {
    let found;
    try {
      found = spec.transform ? query(path, ctx) : [queryOne(path, ctx)].filter((v) => v !== undefined);
    } catch (e) {
      if (e instanceof TaxPathError) { diag.add('error', 'BIND_INVALID', fieldId, e.message, { path }); return { value: undefined, from: null }; }
      throw e;
    }
    let value = spec.transform ? applyTransforms(found, spec.transform, ctx) : found[0];
    if (value !== undefined && value !== null && value !== '') return { value, from: path };
    if (spec.transform && value !== undefined) return { value, from: path };
  }

  if (spec.default !== undefined) return { value: spec.default, from: 'default' };
  if (spec.required) diag.add('error', 'BIND_REQUIRED', fieldId, `required value not found at ${candidates.join(' | ')}`);
  return { value: undefined, from: null };
}

function evalWhen(when, ctx) {
  if (when === undefined) return true;
  if (typeof when === 'string') return test(when, ctx);
  if (when.allOf) return when.allOf.every((c) => evalWhen(c, ctx));
  if (when.anyOf) return when.anyOf.some((c) => evalWhen(c, ctx));
  if (when.not) return !evalWhen(when.not, ctx);
  throw new PlanError(`invalid \`when\` clause: ${JSON.stringify(when)}`);
}

function resolveStyle(doc, field, inherited) {
  const named = resolveNamed(doc.styles, field.style, 'style');
  return deepMerge(deepMerge(doc.defaults?.style ?? {}, inherited ?? {}), named);
}

function resolveFormat(doc, field) {
  const named = resolveNamed(doc.formats, field.format, 'format');
  return deepMerge(doc.defaults?.format ?? {}, named);
}

function fontNameFor(doc, style) {
  const entry = doc.fonts?.[style.font ?? 'sans'];
  if (!entry) throw new PlanError(`style references unknown font "${style.font ?? 'sans'}"`);
  if (style.weight === 'bold' && entry.bold) return entry.bold;
  if (style.italic && entry.italic) return entry.italic;
  return entry.base14 ?? entry.family;
}

export function combCells(box, comb) {
  if (Array.isArray(comb.cells)) {
    return comb.cells.map(([x, w]) => ({ x: box.x + x, y: box.y, w, h: box.h }));
  }
  const count = comb.cells;
  if (!Number.isInteger(count) || count < 1) throw new PlanError(`comb.cells must be a positive integer or an array, got ${JSON.stringify(comb.cells)}`);
  const pitch = box.w / count;
  return Array.from({ length: count }, (_, i) => ({ x: box.x + i * pitch, y: box.y, w: pitch, h: box.h }));
}

export function splitSegments(box, segments) {
  const fixed = segments.reduce((a, s) => a + (s.w ?? 0), 0);
  const flexCount = segments.filter((s) => s.w === undefined).length;
  const flexW = flexCount ? (box.w - fixed) / flexCount : 0;
  const out = []; let x = box.x;
  for (const s of segments) {
    const w = s.w ?? flexW;
    out.push({ ...s, box: { x, y: box.y, w, h: box.h } });
    x += w;
  }
  return out;
}

function partitionForSplit(text, layout) {
  const sep = layout.separator ?? '.';
  const at = text.lastIndexOf(sep);
  if (at === -1) return { integer: text, fraction: layout.fractionWhenAbsent ?? '' };
  return { integer: text.slice(0, at), fraction: text.slice(at + 1) };
}

function textOps(field, box, style, fontName, text, ctx, diag, idSuffix = '') {
  const ops = [];
  const layout = field.layout ?? { mode: 'line' };
  const fieldId = field.id + idSuffix;

  const emitLine = (str, b, overrideStyle = style, suffix = '') => {
    if (str === '') return;
    const content = contentBox(b, overrideStyle.pad);
    const st = { ...overrideStyle, fontName };
    const fitted = fit(str, st, content);
    if (fitted.overflow) {
      diag.add(overrideStyle.fit?.mode === 'clip' ? 'warning' : 'warning', 'TEXT_OVERFLOW', fieldId + suffix,
        `"${str}" is wider than its ${content.w.toFixed(1)}pt box`);
    }
    const lineHeight = overrideStyle.fit?.lineHeight ?? fitted.size * (overrideStyle.lineHeight ?? 1.15);
    fitted.lines.forEach((lineText, i) => {
      const w = measure(lineText, fontName, fitted.size, overrideStyle.letterSpacing) * fitted.scale;
      const baseTop = { ...content, h: fitted.lines.length > 1 ? lineHeight : content.h, y: content.y + i * lineHeight };
      ops.push({
        op: 'text',
        fieldId: fieldId + suffix + (fitted.lines.length > 1 ? `#l${i}` : ''),
        text: lineText,
        x: Number(alignX(lineText, w, baseTop, { ...st, size: fitted.size }).toFixed(3)),
        baseline: Number(baselineFor(baseTop, fitted.lines.length > 1 ? 'top' : overrideStyle.valign, fontName, fitted.size).toFixed(3)),
        width: Number(w.toFixed(3)),
        font: fontName,
        size: fitted.size,
        scale: fitted.scale,
        color: overrideStyle.color ?? '#000000',
        letterSpacing: overrideStyle.letterSpacing ?? 0,
        align: overrideStyle.align ?? 'left',
        rotate: box.rotate ?? 0,
      });
    });
  };

  switch (layout.mode) {
    case 'line':
    case 'wrap':
      emitLine(text, box, layout.mode === 'wrap' ? { ...style, fit: { mode: 'wrap', ...(style.fit ?? {}), ...layout } } : style);
      break;

    case 'comb': {
      const cells = combCells(box, layout);
      const chars = [...text];
      if (chars.length > cells.length) {
        diag.add('error', 'COMB_OVERFLOW', fieldId, `${chars.length} characters do not fit in ${cells.length} cells ("${text}")`);
      }
      const offset = (layout.align ?? 'left') === 'right' ? Math.max(0, cells.length - chars.length) : 0;
      chars.slice(0, cells.length).forEach((ch, i) => {
        emitLine(ch, cells[i + offset], { ...style, align: 'center', pad: 0 }, `#c${i}`);
      });
      break;
    }

    case 'split': {
      const segs = splitSegments(box, layout.segments);
      const parts = partitionForSplit(text, layout);
      for (const seg of segs) {

        const str = seg.part === 'fraction' ? parts.fraction : seg.part === 'integer' ? parts.integer : '';
        if (!seg.part) continue;
        emitLine(str, seg.box, { ...style, align: seg.align ?? style.align, pad: seg.pad ?? style.pad }, `#${seg.id ?? seg.part}`);
      }
      break;
    }

    default:
      throw new PlanError(`unknown layout mode "${layout.mode}" on field "${fieldId}"`);
  }
  return ops;
}

function planField(doc, field, ctx, diag, out, opts, inheritedStyle, offset = { dx: 0, dy: 0 }, idSuffix = '') {
  if (!evalWhen(field.when, ctx)) return;
  if (opts.only && !opts.only.some((s) => matchSelector(field, s))) return;
  if (opts.exclude?.some((s) => matchSelector(field, s))) return;

  const page = field.page ?? 0;
  const shift = (b) => { const n = normalizeBox(b); return { ...n, x: n.x + offset.dx, y: n.y + offset.dy }; };
  const push = (ops) => { (out.pages[page] ??= []).push(...ops); };

  const kind = field.kind ?? 'text';
  const style = resolveStyle(doc, field, inheritedStyle);
  const fontName = fontNameFor(doc, style);

  switch (kind) {
    case 'text': {
      const box = shift(field.box);
      const { value, from } = resolveBind(field.bind, ctx, field.id + idSuffix, diag);
      const format = resolveFormat(doc, field);
      const redact = opts.redactionFor(field);
      let text;
      try { text = formatValue(value, format, { redact }); }
      catch (e) {
        if (redact) diag.add('error', 'FORMAT_FAILED', field.id + idSuffix, 'redacted value could not be formatted');
        else diag.add('error', 'FORMAT_FAILED', field.id + idSuffix, e.message, { value });
        return;
      }
      if (text === '') return;
      const missing = unsupportedGlyphs(text, doc.fonts?.[style.font ?? 'sans']?.encoding ?? 'WinAnsi');
      if (missing.length) {
        diag.add('warning', 'GLYPH_UNSUPPORTED', field.id + idSuffix,
          `${JSON.stringify(missing.join(''))} cannot be drawn in ${fontName}; a renderer with an embedded Unicode font is required`);
      }
      push(textOps(field, box, style, fontName, text, ctx, diag, idSuffix));
      if (opts.trace) {
        out.trace.push({ fieldId: field.id + idSuffix, page, line: field.refs?.line, path: from, raw: redact ? text : value, printed: text, redacted: Boolean(redact) });
      }
      break;
    }

    case 'mark': {
      const box = shift(field.box);
      let on = true;
      if (field.bind !== undefined) {
        const { value } = resolveBind(field.bind, ctx, field.id + idSuffix, diag);
        on = Boolean(value);
      }
      if (!on) return;
      push([markOp(field, box, style, fontName, field.id + idSuffix)]);
      if (opts.trace) out.trace.push({ fieldId: field.id + idSuffix, page, line: field.refs?.line, printed: field.mark?.glyph ?? 'X' });
      break;
    }

    case 'choice': {
      const { value, from } = resolveBind(field.bind, ctx, field.id, diag);
      const selected = Array.isArray(value) ? value : [value];
      const hit = new Set();
      for (const option of field.options) {
        if (!selected.includes(option.value)) continue;
        hit.add(option.value);
        const box = shift(option.box);
        const merged = { ...field, mark: deepMerge(field.mark ?? {}, option.mark ?? {}) };
        push([markOp(merged, box, style, fontName, `${field.id}[${option.value}]`)]);
        if (opts.trace) out.trace.push({ fieldId: `${field.id}[${option.value}]`, page, line: field.refs?.line, path: from, raw: option.value, printed: merged.mark?.glyph ?? 'X' });
      }
      const unmatched = selected.filter((v) => v !== undefined && v !== null && !hit.has(v));
      if (unmatched.length && field.exhaustive !== false) {
        diag.add('error', 'CHOICE_UNMATCHED', field.id,
          `value ${JSON.stringify(unmatched)} has no option; declared options are ${field.options.map((o) => o.value).join(', ')}`);
      }
      if (!selected.some((v) => v !== undefined && v !== null) && field.required) {
        diag.add('error', 'CHOICE_REQUIRED', field.id, 'no option selected');
      }
      break;
    }

    case 'repeat': {
      const items = field.bind ? query(typeof field.bind === 'string' ? field.bind : field.bind.path, ctx) : [];
      const rows = items.length === 1 && Array.isArray(items[0]) ? items[0] : items;
      const slots = field.slots?.count ?? rows.length;
      const advance = field.slots?.advance ?? { dx: 0, dy: 0 };
      const shown = Math.min(rows.length, slots);

      for (let i = 0; i < shown; i++) {
        const rowCtx = { ...ctx, current: rows[i], meta: { index: i, number: i + 1, count: rows.length, first: i === 0, last: i === rows.length - 1 } };
        const rowOffset = { dx: offset.dx + (advance.dx ?? 0) * i, dy: offset.dy + (advance.dy ?? 0) * i };
        for (const child of field.template) {
          planField(doc, { page, ...child }, rowCtx, diag, out, opts, style, rowOffset, `${idSuffix}[${i}]`);
        }
      }

      if (rows.length > slots) {
        const strategy = field.overflow?.strategy ?? 'error';
        const spilled = rows.slice(slots);
        if (strategy === 'error') {
          diag.add('error', 'REPEAT_OVERFLOW', field.id, `${rows.length} items exceed ${slots} slots and no overflow strategy is declared`);
        } else if (strategy === 'truncate') {
          diag.add('warning', 'REPEAT_TRUNCATED', field.id, `${spilled.length} item(s) dropped`);
        } else if (strategy === 'statement') {
          diag.add('info', 'REPEAT_STATEMENT', field.id, `${spilled.length} item(s) moved to a continuation statement`);
          out.statements.push({
            id: field.overflow.statementId ?? `${field.id}-continuation`,
            title: field.overflow.title ?? field.refs?.label ?? field.id,
            fieldId: field.id,
            items: spilled,
          });
          for (const extra of field.overflow.onOverflow ?? []) {
            planField(doc, { page, ...extra }, ctx, diag, out, opts, style, offset, idSuffix);
          }
        } else {
          throw new PlanError(`unknown overflow strategy "${strategy}" on "${field.id}"`);
        }
      }
      break;
    }

    case 'image':
    case 'barcode': {
      const box = shift(field.box);
      const { value, from } = resolveBind(field.bind, ctx, field.id + idSuffix, diag);
      if (value === undefined || value === null || value === '') return;
      push([{
        op: kind, fieldId: field.id + idSuffix,
        x: box.x, y: box.y, w: box.w, h: box.h,
        ...(kind === 'image' ? { href: value, fit: field.fit ?? 'contain' } : { symbology: field.symbology ?? 'PDF417', data: String(value), errorCorrection: field.errorCorrection }),
      }]);
      if (opts.trace) out.trace.push({ fieldId: field.id + idSuffix, page, path: from, printed: `<${kind}>` });
      break;
    }

    default:
      throw new PlanError(`unknown field kind "${kind}" on "${field.id}"`);
  }
}

function markOp(field, box, style, fontName, fieldId) {
  const mark = field.mark ?? {};
  const inset = mark.inset ?? 0;
  const b = { x: box.x + inset, y: box.y + inset, w: box.w - 2 * inset, h: box.h - 2 * inset };
  const shape = mark.style ?? 'glyph';
  if (shape === 'glyph') {
    const glyph = mark.glyph ?? 'X';
    const size = mark.size ?? Math.min(b.h, b.w) * 1.0;
    const w = measure(glyph, fontName, size);
    const m = metricsFor(fontName);
    return {
      op: 'text', fieldId, text: glyph,
      x: Number((b.x + (b.w - w) / 2).toFixed(3)),
      baseline: Number((b.y + (b.h + (m.capHeight * size) / 1000) / 2).toFixed(3)),
      width: Number(w.toFixed(3)), font: fontName, size: Number(size.toFixed(2)), scale: 1,
      color: mark.color ?? style.color ?? '#000000', letterSpacing: 0, align: 'center', rotate: 0,
    };
  }
  return { op: 'mark', fieldId, shape, x: b.x, y: b.y, w: b.w, h: b.h, color: mark.color ?? style.color ?? '#000000', lineWidth: mark.lineWidth ?? 1 };
}

function profileOptions(doc, profileName, base) {
  const profile = doc.profiles?.[profileName];
  if (profileName && !profile) throw new PlanError(`unknown profile "${profileName}"`);
  const rules = profile?.redact ?? [];
  return {
    ...base,
    only: profile?.only ?? base.only,
    exclude: profile?.exclude ?? base.exclude,
    stamps: profile?.stamp ?? [],
    redactionFor(field) {
      for (const rule of rules) if (matchSelector(field, rule.select)) return rule.mode;
      return undefined;
    },
  };
}

function emptyPlan(doc, options, diag) {
  return {
    printPlan: '1.0',
    generatedAt: options.now ?? new Date().toISOString(),
    source: { annotation: `${doc.id}@${doc.version}` },
    profile: options.profile ?? null,
    instance: null,
    units: doc.media?.units ?? 'pt',
    pages: (doc.media?.pages ?? []).map((p) => ({ index: p.index, width: p.width, height: p.height, origin: doc.media.origin ?? 'top-left', ops: [] })),
    statements: [],
    diagnostics: diag.items,
  };
}

export function plan(doc, data, options = {}) {
  const diag = new Diagnostics(Boolean(options.strict));
  const out = { pages: {}, trace: [], statements: [] };
  const opts = profileOptions(doc, options.profile, {
    trace: options.trace !== false,
    only: options.only,
    exclude: options.exclude,
    redactionFor: () => undefined,
  });

  let instance = null;
  let current;
  if (doc.instance) {
    const found = query(doc.instance.path, { root: data });
    const rows = found.length === 1 && Array.isArray(found[0]) ? found[0] : found;
    const index = options.instance ?? 0;
    if (rows.length === 0) {
      if (doc.instance.required !== false) diag.add('error', 'INSTANCE_MISSING', null, `no form instance at ${doc.instance.path}`);
      return emptyPlan(doc, options, diag);
    }
    if (index >= rows.length) {
      diag.add('error', 'INSTANCE_OUT_OF_RANGE', null, `instance ${index} requested but only ${rows.length} exist`);
      return emptyPlan(doc, options, diag);
    }
    if (rows.length > 1 && options.instance === undefined) {
      diag.add('info', 'INSTANCE_MULTIPLE', null, `${rows.length} instances at ${doc.instance.path}; rendering index 0. Render each in turn for a complete return.`);
    }
    current = rows[index];
    instance = { path: doc.instance.path, index, count: rows.length };
  }
  const ctx = { root: data, current, meta: {} };

  for (const field of doc.fields ?? []) {
    try {
      planField(doc, field, ctx, diag, out, opts, undefined);
    } catch (e) {
      if (e instanceof PlanError && options.strict) throw e;
      diag.add('error', 'FIELD_FAILED', field.id, e.message);
    }
  }

  for (const stamp of opts.stamps ?? []) {
    const style = resolveStyle(doc, stamp, undefined);
    const fontName = fontNameFor(doc, style);
    const box = normalizeBox(stamp.box);
    (out.pages[stamp.page ?? 0] ??= []).push(
      ...textOps({ id: stamp.id ?? 'stamp', layout: { mode: 'line' } }, box, style, fontName, stamp.text, ctx, diag),
    );
  }

  const pages = (doc.media?.pages ?? []).map((p) => ({
    index: p.index,
    width: p.width,
    height: p.height,
    origin: doc.media.origin ?? 'top-left',
    ops: out.pages[p.index] ?? [],
  }));

  return {
    printPlan: '1.0',
    generatedAt: options.now ?? new Date().toISOString(),
    source: {
      annotation: `${doc.id}@${doc.version}`,
      inheritedFrom: doc.$inheritedFrom ?? [],
      form: { number: doc.form?.formNumber, taxYear: doc.form?.taxYear, revision: doc.form?.revision },
      media: { uri: doc.media?.uri, sha256: doc.media?.sha256 },
    },
    profile: options.profile ?? null,
    instance,
    units: doc.media?.units ?? 'pt',
    pages,
    statements: out.statements,
    diagnostics: diag.items,
    trace: opts.trace ? out.trace : undefined,
  };
}
