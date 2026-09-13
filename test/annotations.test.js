import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv from 'ajv/dist/2020.js';
import { loadAnnotation } from '../src/compose.js';
import { lint } from '../src/lint.js';
import { plan } from '../src/plan.js';
import { toPdf } from '../src/emit/pdf.js';
import { toSvg } from '../src/emit/svg.js';

const ajv = new Ajv.default({ allErrors: true, strict: false });
const annotationSchema = ajv.compile(JSON.parse(readFileSync('schema/tfa-1.0.schema.json', 'utf8')));
const planSchema = ajv.compile(JSON.parse(readFileSync('schema/print-plan-1.0.schema.json', 'utf8')));
const files = readdirSync('annotations').filter((f) => f.endsWith('.json'));

const returnData = JSON.parse(readFileSync('data/return-2025-sample.json', 'utf8'));
const payrollData = JSON.parse(readFileSync('data/form941-2026q1.json', 'utf8'));

test('every shipped annotation validates against the schema', () => {
  assert.ok(files.length >= 4);
  for (const f of files) {
    const ok = annotationSchema(JSON.parse(readFileSync(`annotations/${f}`, 'utf8')));
    assert.ok(ok, `${f}: ${JSON.stringify(annotationSchema.errors?.slice(0, 4))}`);
  }
});

test('a composed patch document satisfies the full root shape', () => {
  const composed = loadAnnotation('annotations/us-irs-1040-2026.tfa.json');
  delete composed.$file; delete composed.$inheritedFrom; delete composed.extends;
  assert.ok(annotationSchema(composed), JSON.stringify(annotationSchema.errors?.slice(0, 4)));
});

test('every production annotation lints clean against its pinned PDF', () => {
  const cases = [
    ['annotations/us-irs-1040-2025.tfa.json', 'fixtures/f1040.pdf'],
    ['annotations/us-irs-1040-sch-c-2025.tfa.json', 'fixtures/f1040sc.pdf'],
    ['annotations/us-irs-941-2026.tfa.json', 'fixtures/f941.pdf'],
    ['annotations/us-irs-941-sch-b-2026.tfa.json', 'fixtures/f941sb.pdf'],
  ];
  for (const [file, pdf] of cases) {
    const issues = lint(loadAnnotation(file), { pdf }).filter((i) => i.severity !== 'info');
    assert.deepEqual(issues, [], `${file}: ${JSON.stringify(issues)}`);
  }
});

test('the pinned checksums match the fixtures byte for byte', () => {
  for (const [file, pdf] of [['annotations/us-irs-1040-2025.tfa.json', 'fixtures/f1040.pdf'],
                             ['annotations/us-irs-1040-sch-c-2025.tfa.json', 'fixtures/f1040sc.pdf'],
                             ['annotations/us-irs-941-2026.tfa.json', 'fixtures/f941.pdf'],
                             ['annotations/us-irs-941-sch-b-2026.tfa.json', 'fixtures/f941sb.pdf']]) {
    const doc = loadAnnotation(file);
    assert.equal(createHash('sha256').update(readFileSync(pdf)).digest('hex'), doc.media.sha256, file);
  }
});

test('the rollover draft is caught by the linter before it can be used', () => {
  const issues = lint(loadAnnotation('annotations/us-irs-1040-2026.tfa.json'));
  const codes = issues.map((i) => i.code);
  assert.ok(codes.includes('NO_CHECKSUM'), 'an unpinned annotation must not pass silently');
  assert.ok(codes.includes('BOX_OVERLAP'), 'the line 12e move collides with line 13a');
});

const findText = (p, fieldId) => p.pages.flatMap((pg) => pg.ops).find((o) => o.fieldId === fieldId)?.text;

test('Form 1040: values land on the lines they belong to', () => {
  const p = plan(loadAnnotation('annotations/us-irs-1040-2025.tfa.json'), returnData);
  assert.deepEqual(p.diagnostics.filter((d) => d.severity === 'error'), []);
  assert.equal(findText(p, 'line1a'), '189,521', 'two W-2 box 1 amounts, summed then rounded');
  assert.equal(findText(p, 'line2b'), '1,204');
  assert.equal(findText(p, 'line3b'), '3,982');
  assert.equal(findText(p, 'line4a'), '12,000', 'only the 1099-R rows filtered to distributionType IRA');
  assert.equal(findText(p, 'line5a'), '8,400', 'and only the PENSION rows');
  assert.equal(findText(p, 'line7a'), '(3,000)', 'a loss prints in parentheses');
  assert.equal(findText(p, 'line11a'), '264,848');
  assert.equal(findText(p, 'line25a'), '25,675');
  assert.equal(findText(p, 'line37'), undefined, 'a zero balance due leaves the box blank');
  assert.equal(findText(p, 'taxpayer.firstName'), 'DANIEL R');
  assert.equal(findText(p, 'spouse.firstName'), 'PRIYA N', 'resolved through the fallback path');
  assert.equal(findText(p, 'preparer.date'), '03/04/2026', 'the preparer row is dated like the taxpayer rows');
});

test('Form 1040: the fifth dependent overflows onto a statement', () => {
  const p = plan(loadAnnotation('annotations/us-irs-1040-2025.tfa.json'), returnData);
  assert.equal(findText(p, 'firstName[3]'), 'MARGARET', 'four printed columns');
  assert.equal(findText(p, 'firstName[4]'), undefined);
  assert.equal(p.statements.length, 1);
  assert.equal(p.statements[0].items.length, 1);
  assert.equal(p.statements[0].items[0].name.first, 'Elias');
  const marked = p.pages[0].ops.some((o) => o.fieldId === 'dependents.moreThanFour');
  assert.ok(marked, 'and the form\'s own "more than four dependents" box is checked');
});

test('Form 1040: the client profile masks identifiers and stamps both pages', () => {
  const doc = loadAnnotation('annotations/us-irs-1040-2025.tfa.json');
  const filing = plan(doc, returnData, { profile: 'filing' });
  const client = plan(doc, returnData, { profile: 'client' });
  const ssn = (p) => p.pages[0].ops.filter((o) => o.fieldId.startsWith('taxpayer.ssn#c')).map((o) => o.text).join('');
  assert.equal(ssn(filing), '412557801');
  assert.equal(ssn(client), 'XXXXX7801');
  assert.equal(client.pages.filter((pg) => pg.ops.some((o) => o.text === 'CLIENT COPY — DO NOT FILE')).length, 2);
  const pin = client.pages[1].ops.filter((o) => o.fieldId.startsWith('ipPin.taxpayer#c')).map((o) => o.text).join('');
  assert.equal(pin, 'XXXXXX', 'an IP PIN is masked completely, never partially');
});

test('Schedule C: instance scoping, slices and the Part V statement', () => {
  const p = plan(loadAnnotation('annotations/us-irs-1040-sch-c-2025.tfa.json'), returnData);
  assert.equal(p.instance.count, 2, 'the sample return carries two businesses');
  assert.deepEqual(p.diagnostics.filter((d) => d.severity === 'error'), []);
  assert.equal(p.instance.path, '$.schedules.scheduleC');
  assert.equal(findText(p, 'business.name'), 'WHITFIELD ANALYTICS');
  assert.equal(findText(p, 'proprietor.name'), 'DANIEL R WHITFIELD', '$ still reaches outside the instance');
  assert.equal(findText(p, 'line48'), '23,070', 'every other expense, summed');
  assert.equal(findText(p, 'line31'), '41,250');
  assert.equal(findText(p, 'line27b'), '23,070', 'other expenses go on 27b; 27a is the energy efficient buildings deduction');
  assert.equal(findText(p, 'line27a'), undefined);
  const ein = p.pages[0].ops.filter((o) => o.fieldId.startsWith('business.ein#c')).map((o) => o.text).join('');
  assert.equal(ein, '478829135', 'one EIN digit per printed cell');
  assert.ok(p.pages[0].ops.some((o) => o.fieldId === 'madeReportablePayments[true]'), 'contract labor and rent require Forms 1099');
  assert.ok(p.pages[0].ops.some((o) => o.fieldId === 'willFile1099[true]'), 'so line J is answered');
  assert.equal(findText(p, 'vehicle.commutingMiles'), '0', 'zero commuting miles is an answer, not a blank');
  assert.equal(findText(p, 'vehicle.month'), '02', 'sliced out of an ISO date');
  assert.equal(findText(p, 'remainder'), '5,742', 'the spilled rows are subtotalled on the form');
  assert.equal(p.statements[0].items.length, 4);

  const second = plan(loadAnnotation('annotations/us-irs-1040-sch-c-2025.tfa.json'), returnData, { instance: 1 });
  assert.equal(findText(second, 'business.name'), 'MERIDIAN FIELD NOTES');
  assert.equal(findText(second, 'proprietor.name'), 'DANIEL R WHITFIELD');
  assert.equal(findText(second, 'line31'), '15,500');
  assert.equal(findText(second, 'business.ein'), undefined, 'a sole proprietor with no EIN leaves the box empty');
  assert.equal(second.statements.length, 0, 'two other expenses fit in nine printed rows');
  assert.ok(!second.pages[0].ops.some((o) => o.fieldId.startsWith('willFile1099')), 'line J stays blank when line I is No');
});

test('Form 941: dollars and cents land in their separate boxes', () => {
  const p = plan(loadAnnotation('annotations/us-irs-941-2026.tfa.json'), payrollData);
  assert.deepEqual(p.diagnostics.filter((d) => d.severity === 'error'), []);
  assert.equal(findText(p, 'line2#dollars'), '1,284,650');
  assert.equal(findText(p, 'line2#cents'), '42');
  assert.equal(findText(p, 'line5a.column2#dollars'), '154,541');
  assert.equal(findText(p, 'line5a.column2#cents'), '20');
  const ein = p.pages[0].ops.filter((o) => o.fieldId.startsWith('employer.ein')).map((o) => o.text).join('');
  assert.equal(ein, '871234567', 'one EIN split across two comb groups by transform');
});

test('Form 941 page 2: deposit schedule, designee and signature', () => {
  const doc = loadAnnotation('annotations/us-irs-941-2026.tfa.json');
  const p = plan(doc, payrollData);
  assert.deepEqual(p.diagnostics.filter((d) => d.severity === 'error'), []);
  const page2 = p.pages[1].ops.map((o) => o.fieldId);
  assert.ok(page2.includes('line16.depositSchedule[SEMIWEEKLY]'), 'a semiweekly depositor ticks the third box');
  assert.ok(!page2.some((id) => id.startsWith('line16.month')), 'and leaves the monthly lines to Schedule B');
  assert.ok(page2.includes('part4.designeeNo'));
  assert.equal(findText(p, 'page2.employer.name'), 'INSTEAD TAX ADVISORS, LLC', 'page 2 repeats the header');
  assert.equal(['part5.dateMonth', 'part5.dateDay', 'part5.dateYear'].map((id) => findText(p, id)).join('/'), '04/28/2026',
    'one ISO date, split between the printed slashes');
  assert.equal(p.pages[2].ops.length, 0, 'nothing is owed, so the payment voucher stays blank');

  const unanswered = structuredClone(payrollData);
  delete unanswered.part4.thirdPartyDesignee.allowed;
  const ticks = plan(doc, unanswered).pages[1].ops.filter((o) => /^part4\.designee(Yes|No)$/.test(o.fieldId));
  assert.equal(ticks.length, 0, 'a missing answer ticks neither Yes nor No');
});

test('Schedule B: paydays land on their dates and the quarter equals Form 941 line 12', () => {
  const sb = plan(loadAnnotation('annotations/us-irs-941-sch-b-2026.tfa.json'), payrollData);
  assert.deepEqual(sb.diagnostics, []);
  const amount = (p, id) => `${findText(p, `${id}#dollars`)}.${findText(p, `${id}#cents`)}`;
  assert.equal(amount(sb, 'month1.days9to16.amount[6]'), '50,620.40', 'January 15 is slot 6 of the second column');
  assert.equal(amount(sb, 'month3.days25to31.amount[6]'), '63,858.55', 'March 31 is the last slot of the fourth');
  const days = sb.pages[0].ops.filter((o) => /\.amount\[\d+\]#dollars$/.test(o.fieldId));
  assert.equal(days.length, 6, 'six semi-monthly paydays and nothing else');
  assert.equal(amount(sb, 'month1.total'), '114,100.95', 'a month total is a sum over its days');
  const form941 = plan(loadAnnotation('annotations/us-irs-941-2026.tfa.json'), payrollData);
  assert.equal(amount(sb, 'quarter.total'), amount(form941, 'line12'), "the form's own rule: total must equal line 12 on Form 941");
});

test('every plan validates against the print-plan schema', () => {
  for (const [file, data] of [['annotations/us-irs-1040-2025.tfa.json', returnData],
                              ['annotations/us-irs-1040-sch-c-2025.tfa.json', returnData],
                              ['annotations/us-irs-941-2026.tfa.json', payrollData],
                              ['annotations/us-irs-941-sch-b-2026.tfa.json', payrollData]]) {
    const p = plan(loadAnnotation(file), data);
    assert.ok(planSchema(p), `${file}: ${JSON.stringify(planSchema.errors?.slice(0, 4))}`);
  }
});

test('the emitted PDF is structurally sound and carries the values', () => {
  const p = plan(loadAnnotation('annotations/us-irs-1040-2025.tfa.json'), returnData);
  const pdf = toPdf(p);
  const text = pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Type \/Catalog/);
  assert.equal((text.match(/\/Type \/Page\b/g) ?? []).length, 2);

  const startxref = Number(/startxref\s+(\d+)/.exec(text)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.ok(offsets.length > 0);
  offsets.forEach((off, i) => assert.match(text.slice(off, off + 12), new RegExp(`^${i + 1} 0 obj`)));

  assert.ok(text.includes('(264,848) Tj'), 'the AGI is in the content stream');
  assert.ok(text.includes('(\\(3,000\\)) Tj'), 'and a loss keeps its parentheses, escaped for PDF');
});

test('SVG output is well formed and page-sized', () => {
  const p = plan(loadAnnotation('annotations/us-irs-941-2026.tfa.json'), payrollData);
  const svg = toSvg(p, { pageIndex: 0 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="611\.976" height="791\.968"/);
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.equal((svg.match(/<text /g) ?? []).length, p.pages[0].ops.length);
});
