const MODEL_NAME = 'Xenova/paraphrase-MiniLM-L3-v2';
const REVISION = '4b544e74dfc3256b2b56849ea5d7064fee1ac846';
const MODEL_HASH = 'b190f50dd46296b9895ae8f274c3455762d08610f8788f4a9bd15019f4f7160c';
const TOKENIZER_HASH = '2fc687b11de0bc1b3d8348f92e3b49ef1089a621506c7661fbf3248fcd54947e';

function chinese(cp) {
  return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x20000 && cp <= 0x2a6df) ||
    (cp >= 0x2a700 && cp <= 0x2b73f) || (cp >= 0x2b740 && cp <= 0x2b81f) || (cp >= 0x2b820 && cp <= 0x2ceaf) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0x2f800 && cp <= 0x2fa1f);
}

// Minimal implementation of the pinned tokenizer's BERT normalizer and WordPiece.
// A parity fixture compares its IDs with upstream Hugging Face Tokenizers.
export function createTokenizer(json) {
  const vocab = json.model.vocab, unknown = vocab['[UNK]'];
  const special = new Map(json.added_tokens.filter(x => x.special).map(x => [x.content, x.id]));
  const matcher = /(\[PAD\]|\[UNK\]|\[CLS\]|\[SEP\]|\[MASK\])/g;
  function wordPieces(text) {
    const ids = [];
    for (const segment of text.split(matcher)) {
      if (special.has(segment)) { ids.push(special.get(segment)); continue; }
      let cleaned = '';
      for (const ch of segment) {
        const cp = ch.codePointAt(0);
        if (cp === 0 || cp === 0xfffd || (/[\p{Cc}\p{Cf}]/u.test(ch) && !/[\t\n\r]/.test(ch))) continue;
        if (/\s/u.test(ch)) cleaned += ' ';
        else cleaned += chinese(cp) ? ` ${ch} ` : ch;
      }
      cleaned = cleaned.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '');
      cleaned = cleaned.replace(/[\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\p{P}]/gu, ' $& ');
      for (const word of cleaned.split(/\s+/).filter(Boolean)) {
        const chars = [...word];
        if (chars.length > json.model.max_input_chars_per_word) { ids.push(unknown); continue; }
        const pieces = []; let start = 0, failed = false;
        while (start < chars.length) {
          let end = chars.length, found;
          while (end > start) {
            const piece = (start ? '##' : '') + chars.slice(start, end).join('');
            if (Object.hasOwn(vocab, piece)) { found = vocab[piece]; break; }
            end--;
          }
          if (found === undefined) { failed = true; break; }
          pieces.push(found); start = end;
        }
        ids.push(...(failed ? [unknown] : pieces));
      }
    }
    return ids;
  }
  return {
    encode(text, maxLength = 128) {
      if (typeof text !== 'string' || !Number.isInteger(maxLength) || maxLength < 2) throw new Error('Invalid tokenizer input.');
      return [vocab['[CLS]'], ...wordPieces(text).slice(0, maxLength - 2), vocab['[SEP]']];
    }
  };
}

async function verifiedAsset(name, expectedHash) {
  const response = await fetch(new URL('./assets/' + name, import.meta.url));
  if (!response.ok) throw new Error(`Could not load ${name} (HTTP ${response.status}).`);
  const bytes = await response.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  if (hash !== expectedHash) throw new Error(`The downloaded ${name} did not match its pinned checksum.`);
  return bytes;
}

let cached;
export async function loadEmbeddingModel(onProgress = () => {}) {
  if (cached) return cached;
  cached = (async () => {
    const started = performance.now();
    onProgress('Loading the local AI model and runtime. First visit downloads about 33 MB.');
    const [ort, modelBytes, tokenizerBytes] = await Promise.all([
      import('./vendor/ort.wasm.min.mjs'),
      verifiedAsset('model_quantized.onnx', MODEL_HASH),
      verifiedAsset('tokenizer.json', TOKENIZER_HASH)
    ]);
    const tokenizer = createTokenizer(JSON.parse(new TextDecoder().decode(tokenizerBytes)));
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
    onProgress('Starting CPU inference in this browser…');
    const session = await ort.InferenceSession.create(modelBytes, {executionProviders: ['wasm'], graphOptimizationLevel: 'all'});
    const metadata = {model: MODEL_NAME, revision: REVISION, modelSha256: MODEL_HASH, runtimeVersion: '1.30.0',
      provider: 'WebAssembly CPU', dimensions: 384, loadMs: Math.round(performance.now() - started)};
    let queue = Promise.resolve();
    async function encodeBatch(texts) {
      if (!Array.isArray(texts) || texts.length === 0 || texts.length > 60 || texts.some(x => typeof x !== 'string' || !x.trim())) {
        throw new Error('Encode between 1 and 60 nonempty descriptions.');
      }
      const tokens = texts.map(x => tokenizer.encode(x, 129));
      if (tokens.some(x => x.length > 128)) throw new Error('A description is too long for the local model. Shorten it and try again.');
      const length = Math.max(...tokens.map(x => x.length)), count = texts.length * length;
      const ids = new BigInt64Array(count), mask = new BigInt64Array(count), types = new BigInt64Array(count);
      tokens.forEach((row, batch) => row.forEach((id, token) => { ids[batch * length + token] = BigInt(id); mask[batch * length + token] = 1n; }));
      const values = {input_ids: ids, attention_mask: mask, token_type_ids: types};
      const feeds = Object.fromEntries(session.inputNames.map(name => [name, new ort.Tensor('int64', values[name], [texts.length, length])]));
      const results = await session.run(feeds), output = results[session.outputNames[0]];
      const data = output.data, dimensions = output.dims.at(-1);
      if (dimensions !== 384 || output.dims.length !== 3) throw new Error('Unexpected model output shape.');
      const embeddings = tokens.map((row, batch) => {
        const vector = new Array(dimensions).fill(0);
        for (let token = 0; token < row.length; token++) {
          const offset = (batch * length + token) * dimensions;
          for (let d = 0; d < dimensions; d++) vector[d] += data[offset + d] / row.length;
        }
        const norm = Math.hypot(...vector);
        if (!Number.isFinite(norm) || norm <= 0) throw new Error('The model produced an invalid embedding.');
        return vector.map(x => x / norm);
      });
      Object.values(results).forEach(x => x.dispose?.()); Object.values(feeds).forEach(x => x.dispose?.());
      return embeddings;
    }
    onProgress('Local AI ready. Quote descriptions stay in this browser.');
    return {metadata, encode(texts) { const task = queue.then(() => encodeBatch(texts)); queue = task.catch(() => {}); return task; }};
  })().catch(error => { cached = null; throw error; });
  return cached;
}
