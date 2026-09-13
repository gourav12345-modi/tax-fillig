import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, combCells, splitSegments, PlanError } from '../src/plan.js';

const base = {
  tfa: '1.0', id: 'test.form:2025', version: '1.0.0',
  form: { title: 'Test', authority: 'US-IRS', formNumber: 'T', taxYear: 2025 },
  media: { units: 'pt', origin: 'top-left', pages: [{ index: 0, width: 612, height: 792 }] },
  fonts: { sans: { family: 'Helvetica', base14: 'Helvetica' } },
  defaults: { style: { font: 'sans', size: 9, valign: 'middle' }, format: { type: 'text' } },
  styles: { money: { align: 'right', pad: { right: 4 } }, comb: { align: 'center', pad: 0 } },
  formats: { usd: { type: 'number', decimals: 0, zero: 'blank', negative: 'parens' }, ssn: { type: 'digits', length: 9 } },
  fields: [],
};
const doc = (fields, extra = {}) => ({ ...base, ...extra, fields });
const opsOf = (p, page = 0) => p.pages.find((x) => x.index === page).ops;
const textOf = (p, page = 0) => opsOf(p, page).map((o) => o.text);
const codes = (p) => p.diagnostics.map((d) => d.code);

test('a text field becomes one pre-measured draw op', () => {
  const p = plan(doc([{ id: 'agi', box: [504, 750, 72, 12], style: 'money', format: 'usd', bind: '$.agi' }]),
    { agi: 250443 });
  assert.equal(opsOf(p).length, 1);
  const op = opsOf(p)[0];
  assert.equal(op.text, '250,443');
  assert.ok(Math.abs(op.x + op.width - 572) < 0.01, 'right-aligned against the padded content box');
  assert.equal(op.font, 'Helvetica');
  assert.equal(p.diagnostics.length, 0);
});

test('an empty value draws nothing at all', () => {
  const f = [{ id: 'a', box: [0, 0, 50, 12], format: 'usd', bind: '$.zero' },
             { id: 'b', box: [0, 20, 50, 12], format: 'usd', bind: '$.missing' }];
  assert.equal(opsOf(plan(doc(f), { zero: 0 })).length, 0);
});

test('a required binding that resolves to nothing is an error, not a blank box', () => {
  const p = plan(doc([{ id: 'ssn', box: [0, 0, 100, 12], bind: { path: '$.nope', required: true } }]), {});
  assert.deepEqual(codes(p), ['BIND_REQUIRED']);
  assert.throws(() => plan(doc([{ id: 'ssn', box: [0, 0, 100, 12], bind: { path: '$.nope', required: true } }]), {}, { strict: true }), PlanError);
});

test('fallback paths are tried in order and recorded in the trace', () => {
  const f = [{ id: 'name', box: [0, 0, 200, 12], bind: { path: '$.a.preferred', fallback: ['$.a.legal'] } }];
  const p = plan(doc(f), { a: { legal: 'Priya N' } });
  assert.deepEqual(textOf(p), ['Priya N']);
  assert.equal(p.trace[0].path, '$.a.legal');
});

test('when gates a field on the data', () => {
  const f = [{ id: 'spouse', box: [0, 0, 200, 12], bind: '$.spouse.name', when: '$.status in ["MFJ","MFS"]' }];
  assert.deepEqual(textOf(plan(doc(f), { status: 'MFJ', spouse: { name: 'Priya' } })), ['Priya']);
  assert.deepEqual(textOf(plan(doc(f), { status: 'SINGLE', spouse: { name: 'Priya' } })), []);
});

test('comb cells can be evenly divided or given explicitly', () => {
  assert.deepEqual(combCells({ x: 100, y: 0, w: 90, h: 12 }, { cells: 9 }).map((c) => c.x),
    [100, 110, 120, 130, 140, 150, 160, 170, 180]);
  const explicit = combCells({ x: 467.94, y: 94, w: 108.06, h: 14 }, { cells: [[0, 10.9], [10.9, 10.9], [21.8, 13.4]] });
  assert.deepEqual(explicit.map((c) => c.x), [467.94, 478.84, 489.74]);
});

test('a comb prints one character per cell, centred', () => {
  const f = [{
    id: 'ssn', box: [100, 0, 90, 12], style: 'comb', format: 'ssn',
    layout: { mode: 'comb', cells: 9 }, bind: '$.ssn',
  }];
  const p = plan(doc(f), { ssn: '412-55-7801' });
  assert.deepEqual(textOf(p), ['4', '1', '2', '5', '5', '7', '8', '0', '1']);
  assert.deepEqual(opsOf(p).map((o) => o.fieldId), Array.from({ length: 9 }, (_, i) => `ssn#c${i}`));
});

test('a value too long for its comb is an error', () => {
  const f = [{ id: 'ssn', box: [0, 0, 40, 12], style: 'comb', format: { type: 'text' },
               layout: { mode: 'comb', cells: 4 }, bind: '$.v' }];
  assert.deepEqual(codes(plan(doc(f), { v: '123456' })), ['COMB_OVERFLOW']);
});

test('split spreads one number across a dollars box and a cents box', () => {
  const f = [{
    id: 'line2', box: [446.4, 316, 128.85, 14], style: 'money',
    format: { type: 'number', decimals: 2, grouping: true },
    layout: {
      mode: 'split',
      segments: [
        { id: 'dollars', part: 'integer', w: 100.8, align: 'right', pad: { right: 4 } },
        { id: 'point', w: 7.2 },
        { id: 'cents', part: 'fraction', w: 20.85, align: 'center' },
      ],
    },
    bind: '$.wages',
  }];
  const p = plan(doc(f), { wages: 1284650.42 });
  assert.deepEqual(textOf(p), ['1,284,650', '42']);
  const [dollars, cents] = opsOf(p);
  assert.ok(dollars.x + dollars.width <= 543.3, 'dollars stay left of the printed decimal point');
  assert.ok(cents.x >= 554.4, 'cents start after the spacer');
  assert.deepEqual(opsOf(p).map((o) => o.fieldId), ['line2#dollars', 'line2#cents']);
});

test('splitSegments shares leftover width between flexible segments', () => {
  const segs = splitSegments({ x: 0, y: 0, w: 100, h: 10 }, [{ id: 'a', w: 40 }, { id: 'b' }, { id: 'c' }]);
  assert.deepEqual(segs.map((s) => s.box.w), [40, 30, 30]);
});

test('choice marks exactly the selected option', () => {
  const f = [{
    id: 'filingStatus', kind: 'choice', bind: '$.status', mark: { glyph: 'X' },
    options: [{ value: 'SINGLE', box: [10, 10, 8, 8] }, { value: 'MFJ', box: [10, 22, 8, 8] }],
  }];
  const p = plan(doc(f), { status: 'MFJ' });
  assert.equal(opsOf(p).length, 1);
  assert.equal(opsOf(p)[0].fieldId, 'filingStatus[MFJ]');
  assert.ok(opsOf(p)[0].baseline > 22 && opsOf(p)[0].baseline < 30);
});

test('a choice value with no matching option is an error rather than a silent blank', () => {
  const f = [{ id: 'fs', kind: 'choice', bind: '$.status', options: [{ value: 'SINGLE', box: [10, 10, 8, 8] }] }];
  assert.deepEqual(codes(plan(doc(f), { status: 'HOH' })), ['CHOICE_UNMATCHED']);
  const lenient = [{ ...f[0], exhaustive: false }];
  assert.deepEqual(codes(plan(doc(lenient), { status: 'HOH' })), []);
});

test('repeat walks a column-major grid and offsets every child box', () => {
  const f = [{
    id: 'dependents', kind: 'repeat', bind: '$.dependents',
    slots: { count: 4, advance: { dx: 108, dy: 0 } },
    overflow: { strategy: 'truncate' },
    template: [
      { id: 'first', box: [145, 309, 106, 12], bind: '@.first' },
      { id: 'flag', kind: 'mark', box: [169.6, 359, 8, 8], when: '@.lived isTrue' },
    ],
  }];
  const p = plan(doc(f), { dependents: [{ first: 'Amelia', lived: true }, { first: 'Julian', lived: false }] });
  const names = opsOf(p).filter((o) => o.fieldId.startsWith('dependents.first') || o.fieldId.includes('first'));
  assert.deepEqual(opsOf(p).map((o) => o.fieldId), ['first[0]', 'flag[0]', 'first[1]']);
  assert.equal(names[0].x - 145 < 1, true);
  assert.ok(Math.abs(names[1].x - 253) < 1, 'the second column is one advance to the right');
});

test('# gives a row its ordinal inside a repeat', () => {
  const f = [{
    id: 'rows', kind: 'repeat', bind: '$.items', slots: { count: 3, advance: { dy: 12 } },
    overflow: { strategy: 'truncate' },
    template: [{ id: 'n', box: [0, 0, 40, 12], format: { type: 'number' }, bind: '#.number' }],
  }];
  assert.deepEqual(textOf(plan(doc(f), { items: [{}, {}] })), ['1', '2']);
});

test('overflow: rows past the last slot go to a statement, not off the page', () => {
  const f = [{
    id: 'other', kind: 'repeat', bind: '$.items',
    slots: { count: 2, advance: { dy: 24 } },
    overflow: {
      strategy: 'statement', statementId: 'sched-c-48',
      onOverflow: [{ id: 'notice', box: [36, 732, 400, 12], bind: { literal: 'See attached statement' } }],
    },
    template: [{ id: 'desc', box: [36, 540, 400, 12], bind: '@.description' }],
  }];
  const p = plan(doc(f), { items: [{ description: 'a' }, { description: 'b' }, { description: 'c' }, { description: 'd' }] });
  assert.deepEqual(textOf(p), ['a', 'b', 'See attached statement']);
  assert.equal(p.statements.length, 1);
  assert.deepEqual(p.statements[0].items.map((i) => i.description), ['c', 'd']);
  assert.deepEqual(codes(p), ['REPEAT_STATEMENT']);
});

test('overflow with no declared strategy is an error', () => {
  const f = [{
    id: 'other', kind: 'repeat', bind: '$.items', slots: { count: 1, advance: { dy: 10 } },
    template: [{ id: 'desc', box: [0, 0, 100, 12], bind: '@.d' }],
  }];
  assert.deepEqual(codes(plan(doc(f), { items: [{ d: 'a' }, { d: 'b' }] })), ['REPEAT_OVERFLOW']);
});

test('instance scoping selects one of several copies of a form', () => {
  const f = [{ id: 'name', box: [0, 0, 300, 12], bind: '@.business.name' },
             { id: 'who', box: [0, 20, 300, 12], bind: '$.taxpayer.name' }];
  const d = doc(f, { instance: { path: '$.schedules.scheduleC' } });
  const data = { taxpayer: { name: 'Daniel' }, schedules: { scheduleC: [{ business: { name: 'First LLC' } }, { business: { name: 'Second LLC' } }] } };
  assert.deepEqual(textOf(plan(d, data, { instance: 0 })), ['First LLC', 'Daniel']);
  assert.deepEqual(textOf(plan(d, data, { instance: 1 })), ['Second LLC', 'Daniel']);
  const p = plan(d, data);
  assert.deepEqual(codes(p), ['INSTANCE_MULTIPLE'], 'defaulting to index 0 is reported, never assumed silently');
  assert.deepEqual(codes(plan(d, data, { instance: 5 })), ['INSTANCE_OUT_OF_RANGE']);
});

test('profiles redact by tag and stamp the page', () => {
  const f = [{ id: 'ssn', box: [0, 0, 120, 12], format: { type: 'digits', length: 9, mask: '###-##-####' }, bind: '$.ssn', tags: ['pii.ssn'] }];
  const d = doc(f, {
    styles: { ...base.styles, stamp: { size: 20, align: 'center' } },
    profiles: {
      client: {
        redact: [{ select: 'tag:pii.ssn', mode: 'last4' }],
        stamp: [{ id: 'watermark', page: 0, box: [100, 400, 400, 30], style: 'stamp', text: 'CLIENT COPY' }],
      },
    },
  });
  assert.deepEqual(textOf(plan(d, { ssn: '412557801' })), ['412-55-7801']);
  const client = plan(d, { ssn: '412557801' }, { profile: 'client' });
  assert.deepEqual(textOf(client), ['XXX-XX-7801', 'CLIENT COPY']);
  assert.equal(client.trace[0].redacted, true);
  assert.doesNotMatch(JSON.stringify(client), /412-?55-?7801/, 'real digits never enter a redacted plan');
  const bad = plan(d, { ssn: '4125578' }, { profile: 'client' });
  assert.deepEqual(codes(bad), ['FORMAT_FAILED']);
  assert.doesNotMatch(JSON.stringify(bad), /4125578/, 'nor its diagnostics');
});

test('the plan carries the provenance a renderer needs to refuse the wrong PDF', () => {
  const d = doc([], { media: { ...base.media, uri: 'https://example.gov/f.pdf', sha256: 'a'.repeat(64) } });
  const p = plan(d, {}, { now: '2026-03-04T00:00:00.000Z' });
  assert.equal(p.source.annotation, 'test.form:2025@1.0.0');
  assert.equal(p.source.media.sha256, 'a'.repeat(64));
  assert.equal(p.generatedAt, '2026-03-04T00:00:00.000Z');
});

test('text wider than its box is reported instead of quietly overprinting', () => {
  const f = [{ id: 'n', box: [0, 0, 30, 12], style: { fit: { mode: 'clip' } }, bind: '$.n' }];
  assert.deepEqual(codes(plan(doc(f), { n: 'a very long taxpayer name indeed' })), ['TEXT_OVERFLOW']);
});

test('characters the declared font cannot draw are reported', () => {
  const f = [{ id: 'n', box: [0, 0, 300, 12], bind: '$.n' }];
  assert.deepEqual(codes(plan(doc(f), { n: 'Ωmega Holdings' })), ['GLYPH_UNSUPPORTED']);
  assert.deepEqual(codes(plan(doc(f), { n: 'O’Brien — Sørensen' })), []);
});

test('one bad field does not abandon the rest of the page', () => {
  const f = [
    { id: 'good1', box: [0, 0, 100, 12], bind: '$.a' },
    { id: 'bad', box: [0, 20, 100, 12], format: { type: 'number' }, bind: '$.b' },
    { id: 'good2', box: [0, 40, 100, 12], bind: '$.c' },
  ];
  const p = plan(doc(f), { a: 'first', b: 'not-a-number', c: 'last' });
  assert.deepEqual(textOf(p), ['first', 'last']);
  assert.deepEqual(codes(p), ['FORMAT_FAILED']);
});
