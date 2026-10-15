# Third-party assets in QuoteMap

Checked on 2026-10-15. QuoteMap's root `LICENSE` covers its application code. The assets below retain their upstream terms and attribution.

## MiniLM model and tokenizer

QuoteMap redistributes the ONNX quantized model and tokenizer from [Xenova/paraphrase-MiniLM-L3-v2](https://huggingface.co/Xenova/paraphrase-MiniLM-L3-v2/tree/4b544e74dfc3256b2b56849ea5d7064fee1ac846), pinned to revision `4b544e74dfc3256b2b56849ea5d7064fee1ac846`:

- `dist/assets/model_quantized.onnx`, from `onnx/model_quantized.onnx`.
- `dist/assets/tokenizer.json`, from `tokenizer.json`.

The conversion repository's [pinned model card](https://huggingface.co/Xenova/paraphrase-MiniLM-L3-v2/blob/4b544e74dfc3256b2b56849ea5d7064fee1ac846/README.md) credits `sentence-transformers/paraphrase-MiniLM-L3-v2` as its base model and identifies the weights as ONNX weights compatible with Transformers.js. Credit belongs to the Sentence Transformers model authors and the Xenova conversion repository contributors. These are upstream converted and quantized weights; QuoteMap has not retrained or modified the model or tokenizer files.

The base model's [official model card at revision 4ca70771034acceecb2e72475f72050fcdde4ddc](https://huggingface.co/sentence-transformers/paraphrase-MiniLM-L3-v2/blob/4ca70771034acceecb2e72475f72050fcdde4ddc/README.md) explicitly declares `license: apache-2.0`. A complete copy of the Apache License 2.0 is included in [dist/assets/LICENSE-MiniLM.txt](dist/assets/LICENSE-MiniLM.txt), obtained from [the Apache Software Foundation](https://www.apache.org/licenses/LICENSE-2.0.txt).

Provenance boundary: the pinned Xenova repository's model card and API metadata have no separate license declaration, `LICENSE`, or `NOTICE` file. The license attribution above is the base model's explicit Apache-2.0 declaration; it does not invent a separate conversion-repository declaration. The base model card revision records the license evidence retrieved for this release; it is not a claim that Xenova converted that exact base revision.

## ONNX Runtime Web 1.30.0

The following unmodified runtime files come from the official `onnxruntime-web@1.30.0` npm archive:

- `dist/vendor/ort.wasm.min.mjs`
- `dist/vendor/ort-wasm-simd-threaded.mjs`
- `dist/vendor/ort-wasm-simd-threaded.wasm`

Copyright (c) Microsoft Corporation. The npm package metadata declares MIT, and the JavaScript distribution retains the upstream MIT copyright banner. `dist/vendor/runtime-package.json` is a generated extract of the original package's name, version, license, and repository fields, with fixed CRLF line endings to reproduce its locked bytes.

The npm archive does not contain a full `LICENSE` or `NOTICE` file. [dist/vendor/LICENSE-onnxruntime.txt](dist/vendor/LICENSE-onnxruntime.txt) therefore contains the complete MIT license from the [official v1.30.0 tag](https://github.com/microsoft/onnxruntime/blob/v1.30.0/LICENSE), followed by the unmodified [official v1.30.0 ThirdPartyNotices.txt](https://github.com/microsoft/onnxruntime/blob/v1.30.0/ThirdPartyNotices.txt). This complete upstream notice set is retained conservatively; its inclusion does not assert that every optional platform component listed there is compiled into this WebAssembly distribution.

Archive source: [npm registry tarball](https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.30.0.tgz). Archive SHA-256: `d2228df7e4616bc3348bf504ee888f3bec43789a273f0a63f3e68d203ce3bf71`.

The official [version metadata](https://registry.npmjs.org/onnxruntime-web/1.30.0) provides this archive integrity value, also enforced by the download script:

```text
sha512-q0y+JrrtukXSzsBWEMccVfqX25LRmosXHF+CaRJmg8pZClzcV7svNc4rKY3jL02Vb7QmRMDs1SigqR4CXAfKYQ==
```

## Reproduce and verify the assets

Requires Node.js 18.17 or later. No npm installation is required for this script.

```sh
node scripts/download-assets.mjs --check
node scripts/download-assets.mjs
```

`--check` reads the six entries in `assets-lock.json` and verifies existing file sizes and SHA-256 hashes without network access or file changes. Without that option, the script first verifies every existing asset, downloads only missing assets from the pinned Hugging Face revision and npm version, checks the npm archive's SHA-256 and registry SHA-512 integrity, and checks each asset against the lock. It treats downloads as bytes and does not execute downloaded JavaScript, WebAssembly, npm lifecycle scripts, or model files.

An existing mismatched asset causes failure before downloads or writes. The script has no overwrite or force option. A deliberate asset upgrade requires reviewing and changing the version pins and asset lock together. All downloads are verified in memory before any asset is published; an interrupted final write may leave some verified new assets present, and a rerun safely verifies and resumes the remaining files. Existing files are never replaced. The two license files are source-controlled release documents, separate from the six binary/runtime entries in `assets-lock.json`.

Validation performed on 2026-10-15:

- All six existing assets passed the read-only size and SHA-256 check.
- The npm archive matched the registry SHA-512 integrity value and reproduced all four runtime asset entries, including the exact CRLF metadata bytes.
- A simulated missing asset followed by a corrupt existing asset failed preflight with zero network requests and zero writes; duplicate and unsupported lock paths were also rejected.
- The script's download stage fetched all six assets anew from the public pinned sources into memory. All 32,478,343 bytes matched the asset lock, with zero file writes and no execution of downloaded code.
- A fresh on-disk installation into an empty directory was not run in this review. The final hard-link publication step therefore remains a code-reviewed path rather than a completed empty-directory installation test.

The initial Windows sandbox run denied the directory `realpath` metadata query with `EPERM`, while regular file reads succeeded. The same read-only check passed with normal approved filesystem permissions. The script's path and integrity checks were retained unchanged.

## Retrieved license-text checksums

These hashes describe the exact upstream text responses before the runtime texts are combined into the local notice file:

| Source | SHA-256 |
| --- | --- |
| Apache License 2.0, official text | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| Base model card, fixed revision above | `367a3b024bae0609cd4c9c355d4ef968a974c03d9bde297550508472e5dc0db9` |
| ONNX Runtime v1.30.0 LICENSE | `2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c` |
| ONNX Runtime v1.30.0 ThirdPartyNotices.txt | `143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3` |
