---
title: "QuoteMap: compare the scope before the price"
published: false
tags: devchallenge, hf26challenge
ai_disclosure_level: fully_autonomous
---

*Draft submission for the [Hacktoberfest Open-Source AI Challenge Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12). Public code and demo links are pending.*

**AI disclosure:** This project, its evaluation materials and this article were produced primarily by AI agents under human direction. The article uses DEV's **Fully Autonomous** disclosure. All example quotes and evaluation cases are synthetic.

## What I Built

QuoteMap helps a reviewer answer one question before comparing prices: **which lines in these two quotes describe corresponding work?**

In its synthetic website example, one quote includes a five-page website and the other includes eight pages. Another pair changes from a contact form with spam protection to one without it. A price difference becomes useful when those scope changes stay visible beside it.

The working application accepts two small English-language CSV quotes. MiniLM runs in the browser and ranks possible counterparts. The reviewer inspects the descriptions, confirms or overrides a match, or leaves it unmatched. Deterministic code then compares quantities and prices and exports the review with all original rows preserved.

The potential buyer is a freelance project manager or small agency comparing subcontractor quotes. Repeatedly reconciling changed wording is the problem this tool targets. Willingness to pay remains a hypothesis: there are no verified customers, payments, measured time savings or income. This version has no payment integration.

## Demo

**[PUBLIC_DEMO_OR_VIDEO_URL]**

The app was exercised locally in Chrome 155 on Windows 10. Real model loading, suggestions, explicit confirmation, changed-selection reset and duplicate-target prevention were observed. Two actual browser downloads retained every source line: an AI-assisted review had six confirmed pairs and one unmatched B line; a manual review had one confirmed pair, five unmatched A lines and six unmatched B lines.

A model request was deliberately blocked to test failure. The app displayed the fetch error, enabled manual pairing and labelled the mode **Manual review**. After removing the block, retrying restored real AI suggestions. At a 320px viewport, the document's scroll width and client width were both 305px in the captured state, with no horizontal document overflow.

The public demo or video link is still pending. All observations above used synthetic data; no real-user feedback is available.

## Code

**[PUBLIC_REPOSITORY_URL]**

QuoteMap's new application code and workflow began on **15 October 2026**. The application and documentation use the MIT License. Existing model weights, tokenizer files and ONNX Runtime are credited separately in the repository's third-party notices, with pinned versions and asset hashes.

The static app needs no build step. From the project root, serve it with `python -m http.server 8774 --bind 127.0.0.1` and open `/dist/`. The repository includes an asset downloader/verifier, independent tests and a browser diagnostic page. A fresh setup on another computer remains untested.

## How I Built It

Three parts have different jobs. MiniLM ranks related wording. The reviewer decides which lines to pair. Scaled-integer arithmetic calculates amounts, rounds line totals half up to cents and reports each difference as **B minus A**. Currency totals remain separate, and incompatible currencies or units suppress the corresponding monetary comparison.

The pinned open model is [`Xenova/paraphrase-MiniLM-L3-v2`](https://huggingface.co/Xenova/paraphrase-MiniLM-L3-v2/tree/4b544e74dfc3256b2b56849ea5d7064fee1ac846), revision `4b544e74dfc3256b2b56849ea5d7064fee1ac846`, converted from the [Sentence Transformers model](https://huggingface.co/sentence-transformers/paraphrase-MiniLM-L3-v2). It runs through `onnxruntime-web` 1.30.0 using CPU WebAssembly, masked mean pooling and normalized 384-dimensional embeddings. The browser loaded the actual model and verified its pinned SHA-256 digest.

The independent test expectations were written before reading the implementation. Running `node --test tests/core.test.mjs` on Node v24.19.0 passed **47/47 tests**, with none skipped. Those checks cover quoted CSV, numeric limits, exact rounding, multiple currencies, unique matching and complete exports. Separately, the browser tokenizer matched the upstream reference in **30/30 cases**.

The semantic results were weaker. Across seven clear correspondence cases, the expected item ranked first in **4/7**. The failures confused staff training with an editing retainer, loading-speed work with visual redesign, and analytics with lead routing. A source asking for a self-service content editor had no valid counterpart, yet copywriting received a **0.5806 similarity score** and a recommendation without an ambiguity flag. Both deliberately ambiguous cases did trigger the gap flag.

That failure is consequential: a high-looking score can still point at the wrong service. The interface therefore requires confirmation for every pair, preserves the original scope and lets the reviewer leave items unmatched. Its one-to-one mapping has another limit: a bundled design-and-build line cannot be fully represented by separate design and implementation lines.

One local diagnostic run recorded 1,177 ms for loading the model and 2,166 ms for the full diagnostic run. These are single-run observations, with no repeated benchmark or cold-cache guarantee. The frozen synthetic cases provide narrow diagnostic evidence; they do not establish general quote-matching accuracy.

## Why Does Open Innovation Matter?

Open weights make the inference path inspectable and let the application process quote text in the browser without calling a hosted inference API. A reviewer can check the tokenizer, model identity, scores and arithmetic separately, or evaluate a replacement model against the same frozen cases.

In the first observed inference run, five same-origin GET requests loaded three runtime files, the model and the tokenizer. No POST or quote upload was observed. A later retry used four GET requests because the main runtime module was cached. Source inspection found no storage API calls. These observations support a bounded local-processing claim for the inspected build and runs; they are not a comprehensive privacy guarantee.

There is a cost to this approach: approximately 32.48 MB of locked inference assets, limited semantic matching quality and continued human review. Safari, other browser versions and offline startup remain untested. The current project demonstrates a working, inspectable comparison workflow with an openly recorded failure case. Customer usefulness and willingness to pay still need real-world evidence.
