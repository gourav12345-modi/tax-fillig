import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

export class ComposeError extends Error {
  constructor(msg) { super(msg); this.name = 'ComposeError'; }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

function mergeFields(parentFields = [], childFields = []) {
  const order = parentFields.map((f) => f.id);
  const byId = new Map(parentFields.map((f) => [f.id, f]));
  for (const child of childFields) {
    if (!child.id) throw new ComposeError('every field needs an `id` to participate in inheritance');
    if (child.$op === 'remove') { byId.delete(child.id); continue; }
    if (byId.has(child.id)) byId.set(child.id, deepMerge(byId.get(child.id), child));
    else { byId.set(child.id, child); order.push(child.id); }
  }
  return order.filter((id) => byId.has(id)).map((id) => byId.get(id));
}

export function matchSelector(field, selector) {
  if (selector === '*') return true;
  if (selector.startsWith('#')) return field.id === selector.slice(1);
  if (selector.startsWith('tag:')) return (field.tags ?? []).includes(selector.slice(4));
  throw new ComposeError(`unknown selector "${selector}"`);
}

export function normalizeBox(box) {
  if (Array.isArray(box)) {
    if (box.length !== 4) throw new ComposeError(`box array must be [x,y,w,h], got ${JSON.stringify(box)}`);
    return { x: box[0], y: box[1], w: box[2], h: box[3] };
  }
  if (!isObject(box)) throw new ComposeError(`invalid box ${JSON.stringify(box)}`);
  return { x: box.x, y: box.y, w: box.w, h: box.h, rotate: box.rotate ?? 0 };
}

function shiftBoxes(field, dx, dy) {
  const shift = (b) => {
    const n = normalizeBox(b);
    return { ...n, x: n.x + dx, y: n.y + dy };
  };
  const out = { ...field };
  if (out.box) out.box = shift(out.box);
  if (out.options) out.options = out.options.map((o) => ({ ...o, box: shift(o.box) }));
  if (out.template) out.template = out.template.map((c) => shiftBoxes(c, dx, dy));
  return out;
}

export function resolveNamed(registry, ref, kind, seen = new Set()) {
  if (ref === undefined || ref === null) return {};
  if (typeof ref === 'object') {
    const base = ref.$extends ? resolveNamed(registry, ref.$extends, kind, seen) : {};
    const { $extends, ...rest } = ref;
    return deepMerge(base, rest);
  }
  if (seen.has(ref)) throw new ComposeError(`circular ${kind} reference at "${ref}"`);
  seen.add(ref);
  const entry = registry?.[ref];
  if (!entry) throw new ComposeError(`unknown ${kind} "${ref}"`);
  return resolveNamed(registry, entry, kind, seen);
}

export function loadAnnotation(file, seen = new Set()) {
  const abs = resolvePath(file);
  if (seen.has(abs)) throw new ComposeError(`circular \`extends\` at ${abs}`);
  seen.add(abs);

  let doc;
  try { doc = JSON.parse(readFileSync(abs, 'utf8')); }
  catch (e) { throw new ComposeError(`cannot read annotation ${abs}: ${e.message}`); }

  if (!doc.extends) return { ...doc, $file: abs };

  const parentRef = typeof doc.extends === 'string' ? doc.extends : doc.extends.href;
  const parent = loadAnnotation(resolvePath(dirname(abs), parentRef), seen);

  const { extends: _drop, fields: childFields, adjust, ...childRest } = doc;
  let merged = deepMerge(parent, childRest);
  merged.fields = mergeFields(parent.fields, childFields ?? []);

  for (const [pageKey, delta] of Object.entries(adjust?.pages ?? {})) {
    const page = Number(pageKey);
    merged.fields = merged.fields.map((f) => (
      (f.page ?? 0) === page ? shiftBoxes(f, delta.dx ?? 0, delta.dy ?? 0) : f
    ));
  }

  merged.$file = abs;
  merged.$inheritedFrom = [...(parent.$inheritedFrom ?? []), parent.id];
  return merged;
}

export { deepMerge };
