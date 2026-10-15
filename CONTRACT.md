# QuoteMap implementation contract

New project begun 2026-10-15 for the DEV Hacktoberfest Week 2 Side Hustle challenge. Competition entry is a route to a conditional cash prize, not a sale or confirmed income.

## User task
Compare two small English-language CSV quotes for freelance website work. Run open MiniLM weights in the browser to suggest corresponding line items, let a person confirm or override the correspondence, then compare the quantities and prices with deterministic arithmetic. Quote data stays in this page's memory; no quote uploads, inference APIs, analytics, localStorage or payment integration. Loading the page downloads the model and runtime from the same host.

## Input
Each quote is CSV with exactly these required headers (order arbitrary): `description,quantity,unit,unit_price,currency`. Additional columns rejected with a useful error. At most 30 rows. Descriptions 1–300 characters. Positive quantity with at most 3 decimal places, maximum 1,000,000. Nonnegative unit_price with at most 2 decimal places, maximum 1,000,000. Currency three ASCII letters. Unit nonempty, at most 30 characters. All example data explicitly synthetic.

## Owner boundaries
- Root implements `dist/core.mjs`, `dist/embeddings.mjs`, runtime/model assets, package configuration, publication, model verification.
- Frontend agent owns `dist/index.html`, `dist/styles.css`, `dist/app.mjs` only.
- Independent evaluation agent owns `tests/` fixtures and tests only. Do not read core implementation before writing expected examples.
- Submission agent may write top-level `README.md`, `LICENSE`, `SUBMISSION.md` and attribution files after confirmed facts are supplied. Do not invent usage, customer demand, payment, awards or scores.

## core.mjs API
- `parseQuote(csvText, label = 'Quote') -> rows`, throws Error on malformed input. Each row is `{id,description,quantity,quantityMilli,unit,unitPriceCents,currency,totalCents}`. `quantity` is a normalized decimal string, integer amounts are safe JS numbers. `id` is a deterministic row number string starting at 1. Totals round half up to cents using exact integer arithmetic.
- `totalsByCurrency(rows) -> {[currency]: integerCents}`.
- `cosineMatrix(embeddingsA, embeddingsB) -> number[][]` (embeddings are normalized number arrays).
- `suggestPairs(rowsA, rowsB, matrix) -> [{aIndex,recommendedB,ambiguous,candidates}]`, with up to 3 candidates each `{bIndex,score,flags}`; recommendedB may be null when the best score is below 0.35; ambiguity means top-two gap < 0.08. Scores are similarity, never probability or accuracy.
- `comparePair(a, b) -> {flags,quantityChanged,unitChanged,currencyChanged,descriptionNumbersChanged,negationChanged,unitPriceDeltaCents,lineTotalDeltaCents}`. Flags are human-readable English labels. Monetary deltas are null for different currencies; unit price delta is also null for different units. Numbers or negation changes in descriptions need manual review. Difference means B minus A, never assumed savings.
- `reviewCsv(rowsA,rowsB,matches) -> string`, where matches is array `{aIndex,bIndex}` of confirmed unique pairs; export all original rows, matched decisions, flags, original qty/unit/prices/currency and deterministic deltas. Unmatched rows retained. Exported text cells protected from spreadsheet formula interpretation.
- `reviewSummary(rowsA,rowsB,matches) -> {confirmed,unmatchedA,unmatchedB,flagged}`; uniqueness validated, invalid selections throw.

## embeddings.mjs API
- `loadEmbeddingModel(onProgress = () => {}) -> Promise<engine>`. Progress callback receives a user-facing string. Model readiness is genuine, never a mock success.
- engine has `encode(texts) -> Promise<number[][]>` using real onnxruntime-web CPU WASM + quantized MiniLM weights, masked mean pooling, normalized 384-dimensional vectors; `metadata` with model name, revision, runtime version and load time.
- `createTokenizer(tokenizerJson) -> {encode(text,maxLength=128)}` returns integer token IDs with CLS/SEP. Root supplies parity checks against upstream Tokenizers.

## Interface behavior
English UI with high-quality, responsive, calm working-tool design. Main headline: "Compare the scope before the price." Explicit synthetic sample load, CSV paste/upload, run AI suggestions with visible first-load progress, editable mapping per line, Confirm match button per row, reset confirmation if dropdown changes, conflict prevention when another row has already confirmed that target. No automatic acceptance of AI matches. Manual review remains available if model fails, without claiming AI ran. Quote totals separate by currency, no conversion. Summary of confirmed/unmatched/flagged and CSV export. Input changes clear previous results. Status announcements and visible errors; keyboard-accessible controls. Technical attribution in a collapsible details panel, no invented metrics or marketing claims. Mobile tables/cards must not overflow page width.

## Review target
Real browser inference, consistent tokenizer output, meaningful independent semantic cases, arithmetic/CSV edge cases, manual override + conflict prevention, preserved unmatched rows, one mobile-size render, visible failure states, no quote payload network requests.
