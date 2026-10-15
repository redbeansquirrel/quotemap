# QuoteMap

**Compare the scope before the price.**

QuoteMap compares two small English-language CSV quotes for freelance website work. An open MiniLM model suggests related line items in the browser; a reviewer confirms the correspondence; deterministic code calculates the amounts.

The application is implemented and has been exercised locally in **Chrome 155 on Windows 10**. Independent core tests passed **47/47**. The semantic evaluation also exposed substantial limits: the expected candidate ranked first in **4 of 7 clear cases**, and one case with no valid counterpart still received a recommendation.

- [Public repository](https://github.com/redbeansquirrel/quotemap)
- [Public live demo](https://redbeansquirrel.github.io/quotemap/)
- [Published DEV submission](https://dev.to/redbeansquirrel/quotemap-compare-the-scope-before-the-price-53bj)

The source, GitHub Pages demo and DEV submission were published on 15 October 2026. The public demo successfully ran the real model in Chrome. Public API readback matched the demo HTML and article body; the article displays the Week 2 submission badge and Fully Autonomous disclosure. Competition eligibility, awards and income remain unconfirmed.

## Use it

Paste or upload two CSV quotes, or load the clearly labelled synthetic examples. Run AI suggestions, inspect the original descriptions and scope flags, then confirm a pair, choose another candidate, or leave it unmatched. Export the review when ready.

A score measures similarity of wording. Every match requires explicit confirmation. Changing a selection clears that confirmation, and a target line already confirmed elsewhere is unavailable for a second match. Quantities, units, currencies, numbers and exclusion wording remain visible for review.

Differences are **Quote B minus Quote A**. Currency totals stay separate. Different currencies suppress monetary deltas; different units also suppress the unit-price delta. Line totals use exact scaled-integer arithmetic and round half up to cents. The export retains confirmed pairs and every unmatched original line, and protects formula-leading text cells.

Required CSV headers, in any order:

```csv
description,quantity,unit,unit_price,currency
```

Each quote allows 30 rows. Descriptions are 1–300 characters and units 1–30 characters. Quantity must be positive, at most 1,000,000, with at most three decimal places. Unit price may be zero, is at most 1,000,000, and has at most two decimal places. Currency is three ASCII letters. Additional columns and invalid fields are rejected. See [CONTRACT.md](CONTRACT.md) for the API and input contract.

## Run locally

The application is static and needs no package build. Serve the project root over local HTTP so both the application and its diagnostic page are accessible:

```sh
node scripts/download-assets.mjs --check
python -m http.server 8774 --bind 127.0.0.1
```

Open [the application](http://127.0.0.1:8774/dist/) and explicitly load the synthetic examples. If assets are missing, run `node scripts/download-assets.mjs` once before serving; it retrieves the pinned model/runtime files and verifies them against [assets-lock.json](assets-lock.json). This download requires network access. [Third-party notices](THIRD_PARTY_NOTICES.md) document asset provenance and reproduction.

Run the independent core tests with Node.js, observed here on **v24.19.0**:

```sh
node --test tests/core.test.mjs
```

Open [the model diagnostic page](http://127.0.0.1:8774/scripts/browser-check.html) and click **Run real model checks** to repeat tokenizer comparisons and the frozen semantic cases. The harness displays its actual results, including failures. A fresh setup on another computer has not been tested.

## What was verified

Verification used synthetic data on **15 October 2026**. These checks describe this build and environment; they do not establish customer outcomes or performance on arbitrary quotes.

| Check | Observed result |
| --- | --- |
| Independent core tests | **47/47 passed**, zero skipped: quoted CSV, validation, exact rounding, currencies, suggestion rules, unique confirmation and complete export. Expectations were frozen before the implementation was read. [Report](tests/core-test-report.json) · [tests](tests/core.test.mjs) |
| Real model and tokenizer | The pinned ONNX model loaded and passed its SHA-256 check. CPU WebAssembly produced 384-dimensional embeddings. Token IDs matched the upstream reference in **30/30 cases**. |
| Independent semantic cases | The intended counterpart ranked first in **4/7 clear cases**. Both deliberately ambiguous cases triggered the gap flag. The no-counterpart case was incorrectly recommended with a score of **0.5806**, without an ambiguity flag. [Frozen cases](tests/semantic-cases.json) |
| Manual control and export | Explicit confirmation, confirmation reset after a changed selection, and duplicate-target prevention were observed in the browser. Downloaded exports retained every original line: one contained **6 confirmed pairs + 1 unmatched B line**; a manual review contained **1 confirmed pair + 5 unmatched A + 6 unmatched B lines**. |
| Failure and recovery | Temporarily blocking the model request produced a visible fetch error and switched to **Manual review** with manual pairing enabled. Removing the block and retrying restored real AI suggestions. |
| Narrow layout | At a **320px viewport**, the document's scroll width and client width were both **305px**. The captured page showed no horizontal document overflow in that state. |

The three clear-case failures confused CMS training with an editing retainer, page-load optimisation with a visual redesign, and visitor analytics with lead routing. The no-counterpart case confused a self-service content editor with a copywriting service. These are practical reasons to inspect the original scope and leave uncertain lines unmatched. The current one-to-one mapping also cannot fully represent a bundled service split across several lines.

One model diagnostic run recorded **1,177 ms** for model loading and **2,166 ms** for the complete diagnostic run. These are single-run local observations, with no repeated timing study or cold-cache guarantee.

Saved evidence: [real model diagnostics](evidence/quotemap-browser-model-check.json), [browser workflow](evidence/browser-workflow-check.json), [network observation](evidence/quotemap-network-check.json), [AI-assisted export](evidence/quotemap-ai-review.csv), [manual export](evidence/quotemap-manual-review.csv) and [mobile screenshot](evidence/quotemap-mobile.png). The earlier independent core report records semantic execution as pending at that stage; the later browser run produced the semantic observations above.

## Data handling and remaining limits

During the first observed inference run, the browser made **five same-origin GET requests** for three runtime files, model weights and the tokenizer. A later retry made **four GET requests** because the main runtime module was already cached. Neither observation contained POST requests or a quote upload. Source inspection found no storage API calls. Quote content is processed in page memory, and CSV export is user initiated.

This is evidence from the inspected source and recorded synthetic runs, not a comprehensive privacy guarantee. Safari, other browser versions and offline startup have not been tested. The download and cache behavior should be checked in each intended deployment. Scope flags are simple review aids, and similarity thresholds are design parameters: the recommendation cutoff is 0.35 and the ambiguity gap is below 0.08.

The tool is limited to small English CSV quotes. PDF/OCR, taxes, currency conversion, contractual interpretation and automatic purchasing are outside scope. There are no verified customers, payments, measured time savings or income. The potential buyer is a freelance project manager or small agency comparing subcontractor quotes; willingness to pay remains a hypothesis.

## Open components and license

The model is [`Xenova/paraphrase-MiniLM-L3-v2`](https://huggingface.co/Xenova/paraphrase-MiniLM-L3-v2/tree/4b544e74dfc3256b2b56849ea5d7064fee1ac846), pinned to revision `4b544e74dfc3256b2b56849ea5d7064fee1ac846`, from the [Sentence Transformers model](https://huggingface.co/sentence-transformers/paraphrase-MiniLM-L3-v2). Inference uses [`onnxruntime-web` 1.30.0](https://github.com/microsoft/onnxruntime), CPU WebAssembly, masked mean pooling and normalized vectors. The existing weights have not been trained or modified for QuoteMap. The locked inference assets total approximately **32.48 MB**; file sizes are separate from browser transfer measurements.

Application code and documentation use the [MIT License](LICENSE). Model, tokenizer and runtime files retain their upstream terms. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) records their attribution and license evidence, including the conversion repository's absence of a separate license declaration.

## Project and submission status

QuoteMap's new workflow and application code began on **15 October 2026**. [SUBMISSION.md](SUBMISSION.md) preserves the English article [published on DEV](https://dev.to/redbeansquirrel/quotemap-compare-the-scope-before-the-price-53bj) for the [Week 2 Side Hustle challenge](https://dev.to/challenges/hacktoberfest-week2-2026-10-12). The [entry period](https://dev.to/page/hacktoberfest-week2-2026-10-12-contest-rules) ends **18 October 2026 at 23:59 PDT**, or **19 October at 14:59 in China**. The public repository and live demo are linked above.

AI agents produced this application, its evaluation materials and this write-up under human direction. The article's disclosure is **Fully Autonomous** (`ai_disclosure_level: fully_autonomous`). No partner prize category, customer adoption, competition award or income is claimed.
