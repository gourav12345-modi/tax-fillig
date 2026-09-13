import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, queryOne, test as predicate, compile, TaxPathError } from '../src/taxpath.js';

const data = {
  taxpayer: { name: { first: 'Daniel', last: 'Whitfield' }, ssn: '412-55-7801' },
  documents: {
    formW2: [
      { employer: { name: 'Lumenpath' }, box1: { wages: 128400 } },
      { employer: { name: 'St. Brigid' }, box1: { wages: 61120.5 } },
    ],
    form1099R: [
      { distributionType: 'IRA', box1: { grossDistribution: 12000 } },
      { distributionType: 'PENSION', box1: { grossDistribution: 8400 } },
    ],
  },
  dependents: [{ credit: 'CTC' }, { credit: 'CTC' }, { credit: 'ODC' }],
  return: { filingStatus: 'MFJ', digitalAssets: false, refund: { amount: 2187 } },
};
const ctx = { root: data };

test('member access reaches arbitrarily deep', () => {
  assert.equal(queryOne('$.taxpayer.name.first', ctx), 'Daniel');
  assert.equal(queryOne('$.return.refund.amount', ctx), 2187);
});

test('every path must name its root', () => {

  assert.throws(() => compile('taxpayer.name.last'), /expected a path starting with \$, @ or #/);
});

test('quoted members allow keys a bare identifier cannot express', () => {
  assert.equal(queryOne('$["taxpayer"]["name"]["first"]', ctx), 'Daniel');
});

test('index access, including from the end', () => {
  assert.equal(queryOne('$.documents.formW2[0].box1.wages', ctx), 128400);
  assert.equal(queryOne('$.documents.formW2[-1].box1.wages', ctx), 61120.5);
});

test('wildcard and slice fan out in document order', () => {
  assert.deepEqual(query('$.documents.formW2[*].box1.wages', ctx), [128400, 61120.5]);
  assert.deepEqual(query('$.dependents[0:2].credit', ctx), ['CTC', 'CTC']);
  assert.deepEqual(query('$.dependents[2:].credit', ctx), ['ODC']);
});

test('filters select by a nested predicate', () => {
  assert.deepEqual(query('$.documents.form1099R[?@.distributionType == "IRA"].box1.grossDistribution', ctx), [12000]);
  assert.deepEqual(query('$.dependents[?@.credit == "CTC"].credit', ctx), ['CTC', 'CTC']);
  assert.deepEqual(query('$.dependents[?@.credit in ["ODC","XYZ"]].credit', ctx), ['ODC']);
});

test('filters combine with && || ! and parentheses', () => {
  const expr = '$.documents.formW2[?@.box1.wages > 100000 && @.employer.name == "Lumenpath"].box1.wages';
  assert.deepEqual(query(expr, ctx), [128400]);
  assert.deepEqual(query('$.documents.formW2[?!(@.box1.wages > 100000)].box1.wages', ctx), [61120.5]);
});

test('a missing branch yields nothing rather than throwing', () => {
  assert.equal(queryOne('$.taxpayer.spouse.name.first', ctx), undefined);
  assert.deepEqual(query('$.nope[*].deeper', ctx), []);
});

test('queryOne refuses an ambiguous path', () => {

  assert.throws(() => queryOne('$.documents.formW2[*].box1.wages', ctx), TaxPathError);
});

test('@ addresses the current row and # the loop metadata', () => {
  const rowCtx = { root: data, current: { amount: 640 }, meta: { index: 2, number: 3, count: 5, last: false } };
  assert.equal(queryOne('@.amount', rowCtx), 640);
  assert.equal(queryOne('#.number', rowCtx), 3);
  assert.equal(queryOne('#.count', rowCtx), 5);
  assert.equal(queryOne('$.taxpayer.name.first', rowCtx), 'Daniel', '$ still reaches the whole return from inside a row');
});

test('predicates evaluate the same grammar outside a filter', () => {
  assert.equal(predicate('$.return.filingStatus in ["MFJ","MFS","QSS"]', ctx), true);
  assert.equal(predicate('$.return.filingStatus == "SINGLE"', ctx), false);
  assert.equal(predicate('$.taxpayer.ssn exists', ctx), true);
  assert.equal(predicate('$.taxpayer.spouse missing', ctx), true);
  assert.equal(predicate('$.return.digitalAssets isFalse', ctx), true);
  assert.equal(predicate('$.dependents notEmpty', ctx), true);
  assert.equal(predicate('$.taxpayer.name.first ~= "^Dan"', ctx), true);
});

test('recursive descent is deliberately not supported', () => {

  assert.throws(() => compile('$..wages'), TaxPathError);
});

test('syntax errors name the offset', () => {
  assert.throws(() => compile('$.a[?@.b ==]'), /offset/);
  assert.throws(() => compile('$.a['), TaxPathError);
});
