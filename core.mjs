// QuoteMap: CSV and money operations are deterministic; AI never changes a price.
const HEADERS = ['description', 'quantity', 'unit', 'unit_price', 'currency'];
const MAX_ROWS = 30;

function csvRecords(text) {
  if (typeof text !== 'string') throw new Error('CSV must be text.');
  if (text.length > 100000) throw new Error('CSV is too large; use at most 30 rows.');
  text = text.replace(/^\uFEFF/, '');
  const records = []; let row = [], field = '', quoted = false, afterQuote = false;
  const finishField = () => { row.push(field); field = ''; afterQuote = false; };
  const finishRow = () => { finishField(); if (row.some(v => v.trim() !== '')) records.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else field += ch;
      continue;
    }
    if (afterQuote && ch !== ',' && ch !== '\r' && ch !== '\n') {
      if (ch === ' ' || ch === '\t') continue;
      throw new Error('Unexpected text after a closing CSV quote.');
    }
    if (ch === '"') {
      if (field !== '') throw new Error('A quoted CSV field must start with a quote.');
      quoted = true;
    } else if (ch === ',') finishField();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      finishRow();
    } else field += ch;
  }
  if (quoted) throw new Error('A CSV quoted field was not closed.');
  if (field !== '' || row.length || afterQuote) finishRow();
  return records;
}

function scaledDecimal(raw, places, label, positive) {
  const value = String(raw).trim();
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`);
  if (!pattern.test(value)) throw new Error(`${label}: use a plain nonnegative decimal with at most ${places} decimal places.`);
  const [whole, fraction = ''] = value.split('.');
  const scaled = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0'));
  if (scaled > 1000000n * 10n ** BigInt(places) || (positive && scaled === 0n)) {
    throw new Error(`${label}: must be ${positive ? 'greater than zero and ' : ''}at most 1,000,000.`);
  }
  return Number(scaled);
}

function quantityString(milli) {
  const whole = Math.floor(milli / 1000), fraction = String(milli % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${whole}${fraction ? '.' + fraction : ''}`;
}

export function parseQuote(csvText, label = 'Quote') {
  const records = csvRecords(csvText);
  if (records.length < 2) throw new Error(`${label}: add a header and at least one line item.`);
  const headers = records.shift().map(x => x.trim().toLowerCase());
  if (headers.length !== HEADERS.length || new Set(headers).size !== HEADERS.length || HEADERS.some(h => !headers.includes(h))) {
    throw new Error(`${label}: required columns are ${HEADERS.join(', ')}; remove any additional columns.`);
  }
  if (records.length > MAX_ROWS) throw new Error(`${label}: use at most ${MAX_ROWS} line items.`);
  return records.map((record, index) => {
    const where = `${label}, row ${index + 2}`;
    if (record.length !== headers.length) throw new Error(`${where}: expected ${headers.length} CSV fields, found ${record.length}.`);
    const input = Object.fromEntries(headers.map((h, i) => [h, record[i].trim()]));
    if (!input.description || input.description.length > 300) throw new Error(`${where}: description must contain 1–300 characters.`);
    if (!input.unit || input.unit.length > 30) throw new Error(`${where}: unit must contain 1–30 characters.`);
    if (!/^[a-z]{3}$/i.test(input.currency)) throw new Error(`${where}: currency must be a three-letter code, such as USD.`);
    const quantityMilli = scaledDecimal(input.quantity, 3, `${where} quantity`, true);
    const unitPriceCents = scaledDecimal(input.unit_price, 2, `${where} unit_price`, false);
    const totalCents = Number((BigInt(quantityMilli) * BigInt(unitPriceCents) + 500n) / 1000n);
    return {id: String(index + 1), description: input.description, quantity: quantityString(quantityMilli), quantityMilli,
      unit: input.unit, unitPriceCents, currency: input.currency.toUpperCase(), totalCents};
  });
}

export function totalsByCurrency(rows) {
  const totals = {};
  for (const row of rows) totals[row.currency] = (totals[row.currency] ?? 0) + row.totalCents;
  return totals;
}

function numbersIn(text) { return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(x => Number(x)).sort((a, b) => a - b); }
function hasNegation(text) { return /\b(no|not|without|exclude[ds]?|excluding|except)\b/i.test(text); }

export function comparePair(a, b) {
  const quantityChanged = a.quantityMilli !== b.quantityMilli;
  const unitChanged = a.unit.trim().toLowerCase() !== b.unit.trim().toLowerCase();
  const currencyChanged = a.currency !== b.currency;
  const descriptionNumbersChanged = JSON.stringify(numbersIn(a.description)) !== JSON.stringify(numbersIn(b.description));
  const negationChanged = hasNegation(a.description) !== hasNegation(b.description);
  const flags = [];
  if (quantityChanged) flags.push('Quantity differs');
  if (unitChanged) flags.push('Units differ');
  if (currencyChanged) flags.push('Currencies differ; no conversion');
  if (descriptionNumbersChanged) flags.push('Numbers in scope differ');
  if (negationChanged) flags.push('Inclusion or exclusion wording differs');
  return {flags, quantityChanged, unitChanged, currencyChanged, descriptionNumbersChanged, negationChanged,
    unitPriceDeltaCents: currencyChanged || unitChanged ? null : b.unitPriceCents - a.unitPriceCents,
    lineTotalDeltaCents: currencyChanged ? null : b.totalCents - a.totalCents};
}

export function cosineMatrix(embeddingsA, embeddingsB) {
  return embeddingsA.map(a => embeddingsB.map(b => {
    if (!a.length || a.length !== b.length) throw new Error('Embedding dimensions do not match.');
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) {
      if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error('Embedding contains a non-finite value.');
      dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];
    }
    if (aa === 0 || bb === 0) throw new Error('Embedding has zero length.');
    return Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb)));
  }));
}

export function suggestPairs(rowsA, rowsB, matrix) {
  if (matrix.length !== rowsA.length || matrix.some(row => row.length !== rowsB.length || row.some(x => !Number.isFinite(x)))) {
    throw new Error('Similarity matrix does not match the quote rows.');
  }
  return rowsA.map((a, aIndex) => {
    const candidates = rowsB.map((b, bIndex) => ({bIndex, score: matrix[aIndex][bIndex], flags: comparePair(a, b).flags}))
      .sort((x, y) => y.score - x.score || x.bIndex - y.bIndex).slice(0, 3);
    const recommendedB = candidates.length && candidates[0].score >= 0.35 ? candidates[0].bIndex : null;
    const ambiguous = candidates.length > 1 && candidates[0].score - candidates[1].score < 0.08;
    return {aIndex, recommendedB, ambiguous, candidates};
  });
}

function validatedMatches(rowsA, rowsB, matches) {
  if (!Array.isArray(matches)) throw new Error('Confirmed matches must be a list.');
  const seenA = new Set(), seenB = new Set();
  for (const match of matches) {
    const {aIndex, bIndex} = match;
    if (!Number.isInteger(aIndex) || !Number.isInteger(bIndex) || aIndex < 0 || aIndex >= rowsA.length || bIndex < 0 || bIndex >= rowsB.length) {
      throw new Error('A confirmed match refers to an invalid quote row.');
    }
    if (seenA.has(aIndex) || seenB.has(bIndex)) throw new Error('Each quote line can be confirmed only once.');
    seenA.add(aIndex); seenB.add(bIndex);
  }
  return {seenA, seenB};
}

export function reviewSummary(rowsA, rowsB, matches) {
  const {seenA, seenB} = validatedMatches(rowsA, rowsB, matches);
  return {confirmed: matches.length, unmatchedA: rowsA.length - seenA.size, unmatchedB: rowsB.length - seenB.size,
    flagged: matches.filter(m => comparePair(rowsA[m.aIndex], rowsB[m.bIndex]).flags.length > 0).length};
}

function csvCell(value, text = false) {
  let cell = value === null || value === undefined ? '' : String(value);
  // CSV exports are commonly opened in spreadsheet apps; text remains text there.
  if (text && /^[\s]*[=+\-@\t\r\n]/.test(cell)) cell = "'" + cell;
  return '"' + cell.replace(/"/g, '""') + '"';
}
const moneyDecimal = cents => cents === null ? '' : `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;

export function reviewCsv(rowsA, rowsB, matches) {
  const {seenA, seenB} = validatedMatches(rowsA, rowsB, matches);
  const headers = ['decision', 'a_row', 'a_description', 'a_quantity', 'a_unit', 'a_unit_price', 'a_currency', 'a_total',
    'b_row', 'b_description', 'b_quantity', 'b_unit', 'b_unit_price', 'b_currency', 'b_total', 'scope_flags', 'unit_price_change_b_minus_a', 'line_total_change_b_minus_a'];
  const textCols = new Set([0, 2, 4, 6, 9, 11, 13, 15]);
  const values = (r) => r ? [r.id, r.description, r.quantity, r.unit, moneyDecimal(r.unitPriceCents), r.currency, moneyDecimal(r.totalCents)] : ['', '', '', '', '', '', ''];
  const output = [headers.map(x => csvCell(x)).join(',')];
  const emit = (decision, a, b) => {
    const compared = a && b ? comparePair(a, b) : null;
    const row = [decision, ...values(a), ...values(b), compared?.flags.join('; ') ?? '',
      compared ? moneyDecimal(compared.unitPriceDeltaCents) : '', compared ? moneyDecimal(compared.lineTotalDeltaCents) : ''];
    output.push(row.map((v, i) => csvCell(v, textCols.has(i))).join(','));
  };
  for (const m of [...matches].sort((x, y) => x.aIndex - y.aIndex)) emit('confirmed', rowsA[m.aIndex], rowsB[m.bIndex]);
  rowsA.forEach((r, i) => { if (!seenA.has(i)) emit('unmatched_a', r, null); });
  rowsB.forEach((r, i) => { if (!seenB.has(i)) emit('unmatched_b', null, r); });
  return output.join('\r\n') + '\r\n';
}
