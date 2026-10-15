// Independent expectations written from CONTRACT.md before reading core.mjs.
// All examples are synthetic. Run: node --test tests/core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuote, totalsByCurrency, cosineMatrix, suggestPairs,
  comparePair, reviewCsv, reviewSummary,
} from '../dist/core.mjs';

const HEADER = 'description,quantity,unit,unit_price,currency';
const csvCell = value => `"${String(value).replaceAll('"', '""')}"`;
const quoteCsv = records => [HEADER, ...records.map(record => record.map(csvCell).join(','))].join('\r\n');
const record = (description, quantity = '1', unit = 'project', price = '100.00', currency = 'USD') =>
  [description, quantity, unit, price, currency];
const row = (description = 'Website design', quantity = '1', unit = 'project', price = '100.00', currency = 'USD') =>
  parseQuote(quoteCsv([record(description, quantity, unit, price, currency)]))[0];

// This small reader inspects exported CSV independently of the production parser.
// Export columns differ from import columns, so reusing parseQuote would hide defects.
function readExport(text) {
  const records = []; let current = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) { current.push(cell); cell = ''; }
    else if ((ch === '\r' || ch === '\n') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      current.push(cell); records.push(current); current = []; cell = '';
    } else cell += ch;
  }
  assert.equal(quoted, false, 'Export must have balanced CSV quoting');
  if (cell !== '' || current.length) { current.push(cell); records.push(current); }
  assert.ok(records.length >= 1, 'Export needs a header');
  for (const entry of records) assert.equal(entry.length, records[0].length, 'Export records must have equal width');
  return records;
}

test('CSV accepts reordered required headers and returns exact normalized fields', () => {
  const input = 'currency,unit_price,description,unit,quantity\r\nUSD,12.34,Homepage layout,hour,2.500';
  const rows = parseQuote(input, 'Supplier A');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: '1', description: 'Homepage layout', quantity: '2.5', quantityMilli: 2500,
    unit: 'hour', unitPriceCents: 1234, currency: 'USD', totalCents: 3085,
  });
});

test('real quoted CSV retains comma, escaped quote, embedded CRLF, and stable row IDs', () => {
  const description = 'Design "About us", team and contact\r\nInclude two revision rounds';
  const input = quoteCsv([record(description), record('Second item')]);
  const first = parseQuote(input);
  assert.equal(first[0].description, description);
  assert.deepEqual(first.map(entry => entry.id), ['1', '2']);
  assert.deepEqual(parseQuote(input).map(entry => entry.id), ['1', '2']);
});

test('line totals round half up in exact cents, including sub-cent quantities', () => {
  const rows = parseQuote(quoteCsv([
    record('One and a half cents', '0.5', 'unit', '0.03'),
    record('Half a cent', '0.5', 'unit', '0.01'),
    record('Below half a cent', '0.499', 'unit', '0.01'),
    record('Tiny fraction', '0.001', 'unit', '0.01'),
    record('Binary floating point trap', '3', 'unit', '0.29'),
  ]));
  assert.deepEqual(rows.map(entry => entry.totalCents), [2, 1, 0, 0, 87]);
});

test('currency totals sum rounded lines and keep currencies separate', () => {
  const rows = parseQuote(quoteCsv([
    record('Small USD item 1', '0.5', 'unit', '0.01'),
    record('Small USD item 2', '0.5', 'unit', '0.01'),
    record('Euro item', '2', 'hour', '9.99', 'EUR'),
    record('Free USD support', '1', 'project', '0'),
  ]));
  assert.deepEqual(totalsByCurrency(rows), {USD: 2, EUR: 1998});
  assert.deepEqual(totalsByCurrency([]), {});
});

test('inclusive numeric limits retain safe integer totals across 30 rows', () => {
  const rows = parseQuote(quoteCsv(Array.from({length: 30}, (_, i) => record(`Max line ${i + 1}`, '1000000', 'unit', '1000000'))));
  assert.equal(rows.length, 30);
  assert.equal(rows[0].totalCents, 100000000000000);
  assert.equal(totalsByCurrency(rows).USD, 3000000000000000);
  assert.ok(Number.isSafeInteger(totalsByCurrency(rows).USD));
});

const malformedCsvCases = [
  ['missing header', 'description,quantity,unit,unit_price\nSite,1,project,10'],
  ['additional header', HEADER + ',note\nSite,1,project,10,USD,extra'],
  ['duplicate header', 'description,quantity,unit,unit_price,currency,currency\nSite,1,project,10,USD,USD'],
  ['missing data cell', HEADER + '\nSite,1,project,10'],
  ['extra data cell', HEADER + '\nSite,1,project,10,USD,extra'],
  ['unterminated quoted field', HEADER + '\n"Site,1,project,10,USD'],
];
for (const [name, input] of malformedCsvCases) {
  test(`reject malformed CSV: ${name}`, () => assert.throws(() => parseQuote(input), Error));
}

const invalidRecordCases = [
  ['zero quantity', record('Site', '0')],
  ['negative quantity', record('Site', '-1')],
  ['quantity over limit', record('Site', '1000000.001')],
  ['too many quantity decimals', record('Site', '1.0001')],
  ['non-finite quantity', record('Site', 'Infinity')],
  ['negative price', record('Site', '1', 'project', '-0.01')],
  ['price over limit', record('Site', '1', 'project', '1000000.01')],
  ['too many price decimals', record('Site', '1', 'project', '1.001')],
  ['empty description', record('')],
  ['description over 300 characters', record('x'.repeat(301))],
  ['empty unit', record('Site', '1', '')],
  ['unit over 30 characters', record('Site', '1', 'x'.repeat(31))],
  ['currency containing a digit', record('Site', '1', 'project', '10', 'US1')],
  ['currency with non-ASCII letter', record('Site', '1', 'project', '10', 'UŚD')],
  ['currency too long', record('Site', '1', 'project', '10', 'USDX')],
];
for (const [name, input] of invalidRecordCases) {
  test(`reject invalid quote field: ${name}`, () => assert.throws(() => parseQuote(quoteCsv([input])), Error));
}

test('31 rows fail the documented maximum', () => {
  assert.throws(() => parseQuote(quoteCsv(Array.from({length: 31}, (_, i) => record(`Line ${i}`)))), Error);
});

test('inclusive text limits and a free item remain valid', () => {
  const output = row('x'.repeat(300), '0.001', 'x'.repeat(30), '0.00');
  assert.equal(output.unitPriceCents, 0);
  assert.equal(output.totalCents, 0);
});

test('cosine matrix preserves orientation and signed cosine similarity', () => {
  assert.deepEqual(cosineMatrix([[1, 0], [0, 1]], [[0, 1], [-1, 0], [1, 0]]), [[0, -1, 1], [1, 0, 0]]);
  assert.deepEqual(cosineMatrix([], [[1, 0]]), []);
  assert.deepEqual(cosineMatrix([[1, 0]], []), [[]]);
});

test('suggestions are sorted, capped at three, and retain their row indices', () => {
  const a = [row('Build home page')];
  const b = ['Blog', 'Homepage', 'Contact', 'Support'].map(value => row(value));
  const suggestions = suggestPairs(a, b, [[0.10, 0.91, 0.50, 0.30]]);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].aIndex, 0);
  assert.equal(suggestions[0].recommendedB, 1);
  assert.equal(suggestions[0].ambiguous, false);
  assert.deepEqual(suggestions[0].candidates.map(value => value.bIndex), [1, 2, 3]);
  assert.deepEqual(suggestions[0].candidates.map(value => value.score), [0.91, 0.50, 0.30]);
  for (const candidate of suggestions[0].candidates) assert.ok(Array.isArray(candidate.flags));
});

test('weak similarity yields no recommendation; threshold is inclusive', () => {
  const a = [row('A')]; const b = [row('B')];
  assert.equal(suggestPairs(a, b, [[0.349]])[0].recommendedB, null);
  assert.equal(suggestPairs(a, b, [[0.35]])[0].recommendedB, 0);
  assert.equal(suggestPairs(a, b, [[-0.2]])[0].recommendedB, null);
});

test('close or tied candidates require ambiguity review', () => {
  const a = [row('A')]; const b = [row('B'), row('C')];
  assert.equal(suggestPairs(a, b, [[0.82, 0.75]])[0].ambiguous, true);
  assert.equal(suggestPairs(a, b, [[0.82, 0.82]])[0].ambiguous, true);
  assert.equal(suggestPairs(a, b, [[0.90, 0.70]])[0].ambiguous, false);
});

test('empty candidate quote yields no recommendation', () => {
  const output = suggestPairs([row('A')], [], [[]]);
  assert.equal(output[0].recommendedB, null);
  assert.deepEqual(output[0].candidates, []);
});

test('price differences use B minus A; quantity and total differences are distinct', () => {
  const comparison = comparePair(row('Design', '2', 'hour', '10.00'), row('Design', '3', 'hour', '9.00'));
  assert.equal(comparison.quantityChanged, true);
  assert.equal(comparison.unitChanged, false);
  assert.equal(comparison.currencyChanged, false);
  assert.equal(comparison.unitPriceDeltaCents, -100);
  assert.equal(comparison.lineTotalDeltaCents, 700);
  assert.ok(comparison.flags.length > 0);
});

test('different currencies suppress both monetary deltas', () => {
  const comparison = comparePair(row('Design', '1', 'project', '100.00', 'USD'), row('Design', '1', 'project', '90.00', 'EUR'));
  assert.equal(comparison.currencyChanged, true);
  assert.equal(comparison.unitPriceDeltaCents, null);
  assert.equal(comparison.lineTotalDeltaCents, null);
  assert.ok(comparison.flags.length > 0);
});

test('different units suppress unit price delta but keep same-currency line total delta', () => {
  const comparison = comparePair(row('Support', '1', 'month', '100.00'), row('Support', '2', 'hour', '30.00'));
  assert.equal(comparison.unitChanged, true);
  assert.equal(comparison.unitPriceDeltaCents, null);
  assert.equal(comparison.lineTotalDeltaCents, -4000);
});

test('description counts and negation changes are explicitly flagged for review', () => {
  const numbers = comparePair(row('Design 5 pages'), row('Design 8 pages'));
  assert.equal(numbers.descriptionNumbersChanged, true);
  assert.ok(numbers.flags.length > 0);
  const negation = comparePair(row('Hosting is included'), row('Hosting is not included'));
  assert.equal(negation.negationChanged, true);
  assert.ok(negation.flags.length > 0);
  for (const flag of [...numbers.flags, ...negation.flags]) assert.equal(typeof flag, 'string');
});

test('identical rows produce zero deltas and no change flags', () => {
  const source = row('Website design 5 pages');
  const comparison = comparePair(source, {...source});
  for (const key of ['quantityChanged', 'unitChanged', 'currencyChanged', 'descriptionNumbersChanged', 'negationChanged']) assert.equal(comparison[key], false, key);
  assert.deepEqual(comparison.flags, []);
  assert.equal(comparison.unitPriceDeltaCents, 0);
  assert.equal(comparison.lineTotalDeltaCents, 0);
});

test('summary counts confirmed pairs and retains all unmatched rows', () => {
  const a = [row('A'), row('Unused item from A')];
  const b = [row('B', '2'), row('Unused B1'), row('Unused B2')];
  assert.deepEqual(reviewSummary(a, b, [{aIndex: 0, bIndex: 0}]), {confirmed: 1, unmatchedA: 1, unmatchedB: 2, flagged: 1});
  assert.deepEqual(reviewSummary(a, b, []), {confirmed: 0, unmatchedA: 2, unmatchedB: 3, flagged: 0});
  assert.deepEqual(reviewSummary([], [], []), {confirmed: 0, unmatchedA: 0, unmatchedB: 0, flagged: 0});
});

const invalidMatches = [
  ['same source confirmed twice', [{aIndex: 0, bIndex: 0}, {aIndex: 0, bIndex: 1}]],
  ['same target confirmed twice', [{aIndex: 0, bIndex: 0}, {aIndex: 1, bIndex: 0}]],
  ['identical pair repeated', [{aIndex: 0, bIndex: 0}, {aIndex: 0, bIndex: 0}]],
  ['negative index', [{aIndex: -1, bIndex: 0}]],
  ['out of range index', [{aIndex: 0, bIndex: 2}]],
  ['fractional index', [{aIndex: 0.5, bIndex: 0}]],
];
for (const [name, matches] of invalidMatches) {
  test(`manual correspondence rejects ${name}`, () => {
    const a = [row('A1'), row('A2')]; const b = [row('B1'), row('B2')];
    assert.throws(() => reviewSummary(a, b, matches), Error);
    assert.throws(() => reviewCsv(a, b, matches), Error);
  });
}

test('export preserves quoted original descriptions, every unmatched row, and original values', () => {
  const a = parseQuote(quoteCsv([record('Original A, "design"\r\nSecond line', '1.25', 'hour', '12.34'), record('Unmatched from A', '1', 'project', '7.00', 'EUR')]));
  const b = parseQuote(quoteCsv([record('Original B design', '2', 'hour', '10.00'), record('Unmatched from B', '3', 'page', '4.56', 'GBP')]));
  const exported = readExport(reviewCsv(a, b, [{aIndex: 0, bIndex: 0}]));
  const cells = exported.slice(1).flat();
  for (const description of [...a, ...b].map(value => value.description)) assert.ok(cells.includes(description), `Missing original description: ${description}`);
  for (const value of ['1.25', 'hour', 'USD', 'EUR', 'GBP']) assert.ok(cells.includes(value), `Missing original field: ${value}`);
});

test('export protects formula-leading text without losing original content', () => {
  const values = ['=SUM(1,1)', '+HYPERLINK("https://example.invalid","x")', '-1+2', '@SUM(A1:A2)'];
  const a = parseQuote(quoteCsv(values.map(description => record(description, '1', '=unit', '0.00'))));
  const cells = readExport(reviewCsv(a, [], [])).slice(1).flat();
  for (const value of [...values, '=unit']) {
    const protectedVersions = cells.filter(cell => cell.endsWith(value));
    assert.ok(protectedVersions.length > 0, `Missing protected original: ${value}`);
    assert.ok(protectedVersions.every(cell => /^['\t]/u.test(cell)), `Text can be interpreted as a spreadsheet formula: ${value}`);
  }
});
