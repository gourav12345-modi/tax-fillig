import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compile, compilePredicate, TaxPathError } from './taxpath.js';
import { normalizeBox, resolveNamed } from './compose.js';
import { combCells } from './plan.js';

const SEV = { error: 3, warning: 2, info: 1 };

export function lint(doc, { pdf = null } = {}) {
  const issues = [];
  const at = (severity, code, fieldId, message) => issues.push({ severity, code, fieldId, message });

  if (doc.tfa !== '1.0') at('error', 'BAD_VERSION', null, `unsupported \`tfa\` version ${JSON.stringify(doc.tfa)}`);
  if (!doc.id) at('error', 'NO_ID', null, 'document needs an `id`');
  if (!doc.media?.pages?.length) at('error', 'NO_PAGES', null, '`media.pages` must describe at least one page');
  if (!doc.media?.sha256) at('warning', 'NO_CHECKSUM', null, 'no `media.sha256`: the annotation is not pinned to a specific PDF revision');

  if (pdf && doc.media?.sha256) {
    const actual = createHash('sha256').update(readFileSync(pdf)).digest('hex');
    if (actual !== doc.media.sha256) {
      at('error', 'CHECKSUM_MISMATCH', null, `${pdf} hashes to ${actual.slice(0, 16)}… but the annotation pins ${doc.media.sha256.slice(0, 16)}…`);
    }
  }

  const pages = new Map((doc.media?.pages ?? []).map((p) => [p.index, p]));
  const seenIds = new Set();
  const seenAcro = new Map();
  const boxesByPage = new Map();

  const checkPath = (expr, fieldId, where) => {
    if (expr === undefined || expr === null) return;
    const path = typeof expr === 'string' ? expr : expr.path;
    if (!path) return;
    try { compile(path); }
    catch (e) { if (e instanceof TaxPathError) at('error', 'BAD_PATH', fieldId, `${where}: ${e.message}`); else throw e; }
    for (const fb of expr.fallback ?? []) checkPath(fb, fieldId, `${where} fallback`);
  };

  const checkWhen = (when, fieldId) => {
    if (!when) return;
    if (typeof when === 'string') { try { compilePredicate(when); } catch (e) { at('error', 'BAD_WHEN', fieldId, e.message); } return; }
    for (const c of when.allOf ?? when.anyOf ?? []) checkWhen(c, fieldId);
    if (when.not) checkWhen(when.not, fieldId);
  };

  const visit = (field, prefix = '', inheritedPage = 0) => {
    const id = prefix + field.id;
    if (!field.id) { at('error', 'NO_FIELD_ID', id, 'every field needs an `id`'); return; }
    if (seenIds.has(id)) at('error', 'DUPLICATE_ID', id, 'field id is not unique');
    seenIds.add(id);

    const kind = field.kind ?? 'text';
    const page = field.page ?? inheritedPage;
    if (!pages.has(page) && kind !== 'repeat') at('error', 'BAD_PAGE', id, `page ${page} is not declared in media.pages`);

    if (field.style) { try { resolveNamed(doc.styles, field.style, 'style'); } catch (e) { at('error', 'BAD_STYLE', id, e.message); } }
    if (field.format) { try { resolveNamed(doc.formats, field.format, 'format'); } catch (e) { at('error', 'BAD_FORMAT', id, e.message); } }
    checkPath(field.bind, id, 'bind');
    checkWhen(field.when, id);

    const boxes = [];
    if (field.box) boxes.push(['box', normalizeBox(field.box)]);
    for (const [i, o] of (field.options ?? []).entries()) {
      if (!o.box) at('error', 'NO_BOX', id, `option ${i} (${o.value}) has no box`);
      else boxes.push([`option ${o.value}`, normalizeBox(o.box)]);
    }

    for (const [label, b] of boxes) {
      const p = pages.get(page);
      if (!p) continue;
      if (b.w <= 0 || b.h <= 0) at('error', 'BAD_BOX', id, `${label} has non-positive size`);
      if (b.x < 0 || b.y < 0 || b.x + b.w > p.width + 0.5 || b.y + b.h > p.height + 0.5) {
        at('error', 'BOX_OFF_PAGE', id, `${label} [${b.x}, ${b.y}, ${b.w}, ${b.h}] falls outside the ${p.width}×${p.height} page`);
      }
      if (!prefix && kind === 'text') (boxesByPage.get(page) ?? boxesByPage.set(page, []).get(page)).push({ id, label, b });
    }

    if (kind === 'text') {
      if (field.bind === undefined) at('warning', 'NO_BIND', id, 'text field has no `bind`; it will never print');
      if (!field.box) at('error', 'NO_BOX', id, 'text field has no `box`');
      if (field.layout?.mode === 'comb') {
        try {
          const cells = combCells(normalizeBox(field.box), field.layout);
          const fmt = resolveNamed(doc.formats, field.format, 'format');
          if (fmt.length && fmt.length !== cells.length) {
            at('error', 'COMB_MISMATCH', id, `format expects ${fmt.length} digits but the comb declares ${cells.length} cells`);
          }
          if (cells.length && cells[0].w < 4) at('warning', 'COMB_TIGHT', id, `cells are only ${cells[0].w.toFixed(1)}pt wide`);
        } catch (e) { at('error', 'BAD_COMB', id, e.message); }
      }
      if (field.layout?.mode === 'split') {
        const segments = field.layout.segments ?? [];
        const declared = segments.reduce((a, s) => a + (s.w ?? 0), 0);
        const w = normalizeBox(field.box).w;
        if (declared > w + 0.01) at('error', 'SPLIT_OVERFLOW', id, `segments total ${declared}pt in a ${w}pt box`);
        const parts = segments.map((s) => s.part).filter(Boolean);
        if (!parts.includes('integer')) at('error', 'SPLIT_NO_INTEGER', id, 'no segment carries `"part": "integer"`');
        if (new Set(parts).size !== parts.length) at('error', 'SPLIT_DUPLICATE_PART', id, `part ${parts.join(', ')} is claimed more than once`);
      }
    }

    if (kind === 'choice') {
      if (!field.options?.length) at('error', 'NO_OPTIONS', id, 'choice field has no options');
      const values = new Set();
      for (const o of field.options ?? []) {
        if (values.has(o.value)) at('error', 'DUPLICATE_OPTION', id, `option value ${JSON.stringify(o.value)} appears twice`);
        values.add(o.value);
      }
    }

    if (kind === 'mark' && field.when === undefined && field.bind === undefined) {
      at('warning', 'ALWAYS_MARKED', id, 'mark has neither `when` nor `bind`, so it always prints');
    }

    if (kind === 'repeat') {
      if (!field.template?.length) at('error', 'NO_TEMPLATE', id, 'repeat has no template');
      if (!field.slots?.count) at('warning', 'NO_SLOTS', id, 'repeat has no `slots.count`; overflow cannot be detected');
      else if (!field.overflow) at('warning', 'NO_OVERFLOW', id, `no overflow strategy for the ${field.slots.count + 1}th item`);
      for (const child of field.template ?? []) visit(child, `${id}.`, page);
    }

    if (field.refs?.acroField) {
      const prev = seenAcro.get(field.refs.acroField);
      if (prev) at('warning', 'DUPLICATE_ACRO', id, `AcroForm name "${field.refs.acroField}" is also claimed by "${prev}" (XFA forms reuse names; ours must stay unique)`);
      else seenAcro.set(field.refs.acroField, id);
    }

    if (!field.refs?.line && (field.tags ?? []).includes('money')) {
      at('info', 'NO_LINE_REF', id, 'money field has no `refs.line`; review and audit output will be harder to read');
    }
    if (!field.refs?.label && !prefix) at('info', 'NO_LABEL', id, 'no `refs.label`; the field will be hard to identify in review output');
  };

  for (const f of doc.fields ?? []) visit(f);

  for (const [page, boxes] of boxesByPage) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].b; const b = boxes[j].b;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 1 && oy > 1) {
          at('warning', 'BOX_OVERLAP', boxes[i].id, `overlaps "${boxes[j].id}" on page ${page} by ${ox.toFixed(1)}×${oy.toFixed(1)}pt`);
        }
      }
    }
  }

  issues.sort((x, y) => SEV[y.severity] - SEV[x.severity]);
  return issues;
}
