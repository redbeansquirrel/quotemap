import { parseQuote, totalsByCurrency, cosineMatrix, suggestPairs, comparePair, reviewCsv, reviewSummary } from './core.mjs';
import { loadEmbeddingModel } from './embeddings.mjs';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['quote-a','quote-b','file-a','file-b','file-name-a','file-name-b','load-sample','sample-note','run-ai','manual-review','input-error','progress-area','progress-text','status','review-section','review-mode','review-explanation','review-list','quote-totals','unmatched-list','export-section','export-csv','review-summary','model-status','model-metadata'].map(id => [id, $(id)]));
const examples = [
  'description,quantity,unit,unit_price,currency\nDiscovery workshop,1,session,250,USD\nResponsive website (5 pages),1,project,1400,USD\nCustom visual design,1,project,850,USD\nContact form with spam protection,1,form,180,USD\nCMS setup and editor training,1,project,320,USD\nAccessibility review,1,audit,240,USD',
  'description,quantity,unit,unit_price,currency\nProject discovery session,1,session,300,USD\nResponsive website (8 pages),1,project,1900,USD\nBespoke user interface design,1,project,750,USD\nContact form without spam protection,1,form,100,USD\nCMS configuration and handover training,1,project,280,USD\nAccessibility audit,1,audit,275,USD\nHosting and support,12,month,25,USD'
];
let generation = 0;
let review = null;
let engine = null;
let enginePromise = null;
let activeRun = null;

function element(tag, className = '', text = null) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== null) result.textContent = text;
  return result;
}
function status(message, tone = '') {
  ui.status.textContent = message;
  ui.status.dataset.tone = tone;
}
function money(cents, currency, signed = false) {
  const value = (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${signed && cents > 0 ? '+' : cents < 0 ? '−' : ''}${currency} ${value}`;
}
function setBusy() {
  ui['run-ai'].disabled = activeRun !== null;
  ui['run-ai'].setAttribute('aria-busy', String(activeRun !== null));
  ui['progress-area'].hidden = activeRun === null || activeRun !== generation;
}
function clearReview(message = 'Inputs changed. Run suggestions or start a manual review again.') {
  generation++;
  review = null;
  ui['review-section'].hidden = true;
  ui['export-section'].hidden = true;
  ui['review-list'].replaceChildren();
  ui['input-error'].hidden = true;
  ui['sample-note'].hidden = true;
  setBusy();
  status(message);
}
function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  ui['input-error'].textContent = message;
  ui['input-error'].hidden = false;
  status(message, 'error');
}
function startReview(mode) {
  const sampleVisible = !ui['sample-note'].hidden;
  clearReview('Reading your quotes…');
  ui['sample-note'].hidden = !sampleVisible;
  try {
    const a = parseQuote(ui['quote-a'].value, 'Quote A');
    const b = parseQuote(ui['quote-b'].value, 'Quote B');
    review = { a, b, mode, suggestions: [], selections: a.map(() => null), touched: a.map(() => false), confirmed: a.map(() => false) };
    renderReview();
    return generation;
  } catch (error) {
    showError(error);
    return null;
  }
}
function confirmedMatches() {
  return review.a.flatMap((_, aIndex) => review.confirmed[aIndex] && review.selections[aIndex] !== null ? [{ aIndex, bIndex: review.selections[aIndex] }] : []);
}
function renderTotals() {
  ui['quote-totals'].replaceChildren();
  for (const [label, rows] of [['A', review.a], ['B', review.b]]) {
    const card = element('div', 'total-card');
    const title = element('div', 'total-label');
    title.append(element('span', '', `Quote ${label} · stated total`), element('span', '', `${rows.length} items`));
    card.append(title);
    for (const [currency, amount] of Object.entries(totalsByCurrency(rows)).sort(([a], [b]) => a.localeCompare(b))) card.append(element('p', 'total-amount', money(amount, currency)));
    card.append(element('p', 'total-caption', 'All quoted lines, including unmatched items. Currencies kept separate.'));
    ui['quote-totals'].append(card);
  }
}
function itemPrice(row) {
  const p = element('p', 'item-price', `${row.quantity} ${row.unit} × ${money(row.unitPriceCents, row.currency)}`);
  p.append(element('strong', '', `Line total ${money(row.totalCents, row.currency)}`));
  return p;
}
function candidateInfo(aIndex, bIndex) {
  const suggestion = review.suggestions.find(item => item.aIndex === aIndex);
  if (review.mode !== 'ai') return review.mode === 'loading' ? 'AI is still running. You can make and confirm your own choices now.' : 'Manual pairing. AI suggestions have not run for this review.';
  if (!suggestion || suggestion.recommendedB === null) return 'No strong model suggestion. Review the available lines manually.';
  const candidate = suggestion.candidates.find(item => item.bIndex === bIndex);
  const score = candidate ? `Similarity ${candidate.score.toFixed(2)}. ` : '';
  const origin = bIndex === suggestion.recommendedB ? 'AI-suggested pairing. ' : 'You selected a different pairing. ';
  return `${origin}${score}${suggestion.ambiguous ? 'Top suggestions are close; inspect the scope carefully.' : 'Similarity is not confidence or a scope guarantee.'}`;
}
function renderCard(aIndex) {
  const a = review.a[aIndex];
  const selected = review.selections[aIndex];
  const b = selected === null ? null : review.b[selected];
  const confirmed = review.confirmed[aIndex];
  const card = element('article', `match-card${confirmed ? ' is-confirmed' : ''}`);
  card.id = `match-${aIndex}`;
  card.setAttribute('aria-labelledby', `item-title-${aIndex}`);
  const top = element('div', 'match-card-top');
  top.append(element('span', '', `Quote A / item ${aIndex + 1}`), element('span', confirmed ? 'confirmed-indicator' : '', confirmed ? '✓ Confirmed by you' : 'Needs your review'));
  const content = element('div', 'match-content');
  const source = element('div', 'match-a');
  const title = element('h3', 'item-description', a.description);
  title.id = `item-title-${aIndex}`;
  source.append(title, itemPrice(a));
  const target = element('div', 'match-b');
  const selectLabel = element('label', 'select-label', 'CORRESPONDING LINE IN QUOTE B');
  selectLabel.htmlFor = `select-${aIndex}`;
  const select = element('select', 'match-select');
  select.id = `select-${aIndex}`;
  select.setAttribute('aria-describedby', `suggestion-${aIndex}`);
  const empty = element('option', '', 'Leave unmatched');
  empty.value = '';
  select.append(empty);
  review.b.forEach((row, bIndex) => {
    const used = review.selections.some((value, index) => index !== aIndex && review.confirmed[index] && value === bIndex);
    const option = element('option', '', `${bIndex + 1}. ${row.description}${used ? ' (already confirmed)' : ''}`);
    option.value = String(bIndex);
    option.disabled = used;
    select.append(option);
  });
  select.value = selected === null ? '' : String(selected);
  select.addEventListener('change', () => {
    review.selections[aIndex] = select.value === '' ? null : Number(select.value);
    review.touched[aIndex] = true;
    review.confirmed[aIndex] = false;
    renderCards(select.id);
    renderSummary();
    status(`Quote A item ${aIndex + 1} changed. Confirm the new match when you are ready.`);
  });
  const suggestionText = element('p', 'suggestion-info', candidateInfo(aIndex, selected));
  suggestionText.id = `suggestion-${aIndex}`;
  target.append(selectLabel, select);
  if (b) target.append(itemPrice(b));
  target.append(suggestionText);
  const comparison = b ? comparePair(a, b) : null;
  if (comparison) {
    const flags = element('div', 'scope-flags');
    if (comparison.flags.length) comparison.flags.forEach(flag => flags.append(element('span', 'scope-flag', flag)));
    else flags.append(element('span', 'scope-flag clear', 'No rule-based scope flags · still check wording'));
    target.append(flags);
  }
  content.append(source, target);
  const footer = element('div', 'match-footer');
  const difference = element('p', 'delta-text');
  if (comparison) {
    const lineDelta = comparison.lineTotalDeltaCents === null ? 'Not comparable across currencies' : money(comparison.lineTotalDeltaCents, a.currency, true);
    const unitDelta = comparison.unitPriceDeltaCents === null ? 'Not comparable across currencies or units' : money(comparison.unitPriceDeltaCents, a.currency, true);
    difference.append(document.createTextNode('Line total difference: '), element('strong', '', lineDelta), element('br'), document.createTextNode(`Unit price difference: ${unitDelta}`));
  } else difference.textContent = 'Unmatched items remain visible in your review and export.';
  const confirm = element('button', 'button confirm-button', confirmed ? 'Undo confirmation' : 'Confirm match');
  confirm.type = 'button';
  confirm.id = `confirm-${aIndex}`;
  confirm.setAttribute('aria-label', `${confirmed ? 'Undo confirmation for' : 'Confirm match for'} Quote A item ${aIndex + 1}`);
  confirm.disabled = selected === null || (!confirmed && review.selections.some((value, index) => index !== aIndex && review.confirmed[index] && value === selected));
  confirm.addEventListener('click', () => {
    if (!review.confirmed[aIndex] && review.selections.some((value, index) => index !== aIndex && review.confirmed[index] && value === review.selections[aIndex])) {
      status('That Quote B line already has a confirmed match. Choose another line or undo the existing confirmation.', 'error');
      return;
    }
    review.confirmed[aIndex] = !review.confirmed[aIndex];
    const isConfirmed = review.confirmed[aIndex];
    renderCards(confirm.id);
    renderSummary();
    status(`Quote A item ${aIndex + 1} ${isConfirmed ? 'confirmed. This is now included as a match in your export.' : 'confirmation removed. The pairing needs review again.'}`);
  });
  footer.append(difference, confirm);
  card.append(top, content, footer);
  return card;
}
function renderCards(focusId = '') {
  ui['review-list'].replaceChildren(...review.a.map((_, index) => renderCard(index)));
  if (focusId) $(focusId)?.focus({ preventScroll: true });
}
function renderSummary() {
  const matches = confirmedMatches();
  const summary = reviewSummary(review.a, review.b, matches);
  ui['review-summary'].replaceChildren();
  for (const [key, label] of [['confirmed','Confirmed pairs'], ['unmatchedA','Unmatched in Quote A'], ['unmatchedB','Unmatched in Quote B'], ['flagged','Confirmed pairs with flags']]) {
    const stat = element('div', 'summary-stat');
    stat.append(element('strong', '', String(summary[key])), element('span', '', label));
    ui['review-summary'].append(stat);
  }
  ui['unmatched-list'].replaceChildren();
  for (const [label, rows, key] of [['A', review.a, 'aIndex'], ['B', review.b, 'bIndex']]) {
    const section = element('div');
    section.append(element('h4', '', `Quote ${label}`));
    const used = new Set(matches.map(match => match[key]));
    const unmatched = rows.map((row, index) => ({ row, index })).filter(({ index }) => !used.has(index));
    if (!unmatched.length) section.append(element('p', '', 'Every line has a confirmed match.'));
    else {
      const list = element('ul');
      for (const { row, index } of unmatched) list.append(element('li', '', `${index + 1}. ${row.description} · ${money(row.totalCents, row.currency)}`));
      section.append(list);
    }
    ui['unmatched-list'].append(section);
  }
}
function renderReview() {
  ui['review-section'].hidden = false;
  ui['export-section'].hidden = false;
  ui['review-mode'].textContent = review.mode === 'ai' ? 'Local AI suggestions' : review.mode === 'loading' ? 'AI running…' : 'Manual review';
  ui['review-explanation'].textContent = review.mode === 'ai'
    ? 'AI has suggested corresponding lines. Review each selection and scope flag, then confirm it yourself. No pairing is accepted automatically.'
    : 'Choose a line from Quote B for each line in Quote A, then confirm the match. Unmatched items remain in your export.';
  renderTotals();
  renderCards();
  renderSummary();
}
async function runAI() {
  if (activeRun !== null) return;
  const version = startReview('loading');
  if (version === null) return;
  activeRun = version;
  setBusy();
  const current = () => generation === version && review !== null;
  try {
    if (!engine) {
      ui['progress-text'].textContent = 'Loading the model and runtime for the first AI run…';
      if (!enginePromise) enginePromise = loadEmbeddingModel(message => {
        ui['model-status'].textContent = String(message);
        if (activeRun !== null && activeRun === generation) ui['progress-text'].textContent = String(message);
      }).catch(error => { enginePromise = null; throw error; });
      engine = await enginePromise;
      ui['model-status'].textContent = 'Local embedding model loaded. Inference runs in this browser.';
      ui['model-metadata'].textContent = JSON.stringify(engine.metadata ?? {}, null, 2);
      ui['model-metadata'].hidden = false;
    }
    if (!current()) return;
    ui['progress-text'].textContent = `Comparing ${review.a.length + review.b.length} descriptions in your browser…`;
    status('The local model is running. No matches will be confirmed automatically.');
    const rowsA = review.a;
    const rowsB = review.b;
    const vectors = await engine.encode([...rowsA, ...rowsB].map(row => row.description));
    if (!current()) return;
    const suggestions = suggestPairs(rowsA, rowsB, cosineMatrix(vectors.slice(0, rowsA.length), vectors.slice(rowsA.length)));
    review.suggestions = suggestions;
    review.mode = 'ai';
    for (const suggestion of suggestions) {
      // A person's choices made during loading always take precedence over suggestions.
      if (!review.touched[suggestion.aIndex] && !review.confirmed[suggestion.aIndex]) review.selections[suggestion.aIndex] = suggestion.recommendedB;
    }
    renderReview();
    status('Local AI suggestions are ready. Review the scope and confirm each pairing you want to keep.');
  } catch (error) {
    if (current()) {
      review.mode = 'manual';
      renderReview();
      const message = error instanceof Error ? error.message : String(error);
      showError(`AI suggestions could not finish: ${message}. Your quotes are ready for manual pairing. You can also retry the AI run.`);
      ui['model-status'].textContent = engine ? 'The model loaded, but this AI comparison failed. No AI suggestions were applied.' : 'The local model could not load. AI suggestions have not run.';
    }
  } finally {
    if (activeRun === version) activeRun = null;
    setBusy();
  }
}

for (const name of ['a', 'b']) {
  ui[`quote-${name}`].addEventListener('input', () => {
    ui[`file-name-${name}`].textContent = 'CSV entered in this page';
    clearReview();
  });
  ui[`file-${name}`].addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    clearReview('Reading the selected CSV file locally…');
    const version = generation;
    try {
      if (file.size > 1_000_000) throw new Error('Choose a CSV smaller than 1 MB. Each quote supports up to 30 line items.');
      const text = await file.text();
      if (version !== generation) return;
      ui[`quote-${name}`].value = text;
      ui[`file-name-${name}`].textContent = file.name;
      status(`Quote ${name.toUpperCase()} loaded from your file. Run suggestions or start a manual review.`);
    } catch (error) {
      if (version === generation) showError(error);
    } finally { event.target.value = ''; }
  });
}
ui['load-sample'].addEventListener('click', () => {
  clearReview('Synthetic example loaded. Run local AI suggestions or explore manual pairing.');
  ui['quote-a'].value = examples[0];
  ui['quote-b'].value = examples[1];
  ui['file-name-a'].textContent = 'Synthetic example · 6 items';
  ui['file-name-b'].textContent = 'Synthetic example · 7 items';
  ui['sample-note'].hidden = false;
});
ui['manual-review'].addEventListener('click', () => {
  if (startReview('manual') !== null) {
    status('Manual review is ready. AI suggestions have not run for this review. Choose and confirm your own pairings.');
    $('review-heading').focus({ preventScroll: true });
    ui['review-section'].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});
ui['run-ai'].addEventListener('click', runAI);
ui['export-csv'].addEventListener('click', () => {
  if (!review) return;
  try {
    const matches = confirmedMatches();
    const csv = reviewCsv(review.a, review.b, matches);
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = element('a');
    link.href = url;
    link.download = 'quotemap-review.csv';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    status(`CSV export prepared with ${matches.length} confirmed pairs. All unmatched lines are included. Check your browser downloads.`);
  } catch (error) { showError(error); }
});
