#!/usr/bin/env node
// Fetch data only. No package installation, lifecycle scripts, or downloaded code execution.
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '1.30.0';
const MODEL = 'Xenova/paraphrase-MiniLM-L3-v2';
const REVISION = '4b544e74dfc3256b2b56849ea5d7064fee1ac846';
const HF = `https://huggingface.co/${MODEL}/resolve/${REVISION}`;
const ARCHIVE_URL = `https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-${VERSION}.tgz`;
const ARCHIVE_SHA256 = 'd2228df7e4616bc3348bf504ee888f3bec43789a273f0a63f3e68d203ce3bf71';
const ARCHIVE_SHA512 = 'q0y+JrrtukXSzsBWEMccVfqX25LRmosXHF+CaRJmg8pZClzcV7svNc4rKY3jL02Vb7QmRMDs1SigqR4CXAfKYQ==';
const MODEL_URLS = new Map([
  ['dist/assets/model_quantized.onnx', `${HF}/onnx/model_quantized.onnx`],
  ['dist/assets/tokenizer.json', `${HF}/tokenizer.json`],
]);
const RUNTIME_MEMBERS = new Map([
  ['dist/vendor/ort-wasm-simd-threaded.mjs', 'package/dist/ort-wasm-simd-threaded.mjs'],
  ['dist/vendor/ort-wasm-simd-threaded.wasm', 'package/dist/ort-wasm-simd-threaded.wasm'],
  ['dist/vendor/ort.wasm.min.mjs', 'package/dist/ort.wasm.min.mjs'],
]);
const METADATA_PATH = 'dist/vendor/runtime-package.json';
const ALLOWED_PATHS = new Set([...MODEL_URLS.keys(), ...RUNTIME_MEMBERS.keys(), METADATA_PATH]);

export function validateLock(lock) {
  if (lock.runtime !== `onnxruntime-web@${VERSION}` || lock.model !== MODEL || lock.revision !== REVISION) {
    throw new Error('assets-lock.json must match the versions pinned in this script.');
  }
  if (!Array.isArray(lock.files) || lock.files.length !== ALLOWED_PATHS.size) {
    throw new Error('The asset lock must contain exactly the six supported asset paths.');
  }
  const seen = new Set();
  for (const entry of lock.files) {
    if (!entry || !ALLOWED_PATHS.has(entry.path) || seen.has(entry.path)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0
      || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid or duplicate asset lock entry: ${entry?.path}`);
    }
    seen.add(entry.path);
  }
  return lock.files;
}

export function verifyBytes(entry, bytes) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== entry.bytes || digest !== entry.sha256) {
    throw new Error(`Integrity mismatch for ${entry.path}: expected ${entry.bytes} bytes / ${entry.sha256}; got ${bytes.length} / ${digest}. Existing files are never overwritten.`);
  }
}

async function statOrMissing(target) {
  try { return await fs.lstat(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function safeDestination(root, relativePath) {
  if (!ALLOWED_PATHS.has(relativePath)) throw new Error('Unsupported destination path.');
  let cursor = root;
  const parts = relativePath.split('/');
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    const stat = await statOrMissing(cursor);
    if (!stat) continue;
    if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${cursor}`);
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`Not a directory: ${cursor}`);
    if (i === parts.length - 1 && !stat.isFile()) throw new Error(`Not a regular file: ${cursor}`);
  }
  return cursor;
}

export async function preflight(root, entries) {
  const missing = [];
  // Complete this pass before any fetch, directory creation, or file write.
  for (const entry of entries) {
    const target = await safeDestination(root, entry.path);
    if (await statOrMissing(target)) verifyBytes(entry, await fs.readFile(target));
    else missing.push(entry);
  }
  return missing;
}

async function fetchBytes(url, maximumBytes) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maximumBytes) throw new Error(`Download exceeded its size limit: ${url}`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

// Read only named regular-file members; never unpack arbitrary tar paths onto disk.
export function readTarFiles(archive, wanted) {
  const tar = gunzipSync(archive, { maxOutputLength: 200 * 1024 * 1024 });
  const found = new Map();
  const field = (block, start, length) => block.subarray(start, start + length).toString('utf8').split('\0', 1)[0];
  const octal = (value, label) => {
    const normalized = value.trim();
    if (!/^[0-7]+$/.test(normalized)) throw new Error(`Invalid tar ${label}.`);
    const number = Number.parseInt(normalized, 8);
    if (!Number.isSafeInteger(number)) throw new Error(`Unsafe tar ${label}.`);
    return number;
  };
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const expectedChecksum = octal(field(header, 148, 8), 'checksum');
    let actualChecksum = 0;
    for (let i = 0; i < 512; i++) actualChecksum += i >= 148 && i < 156 ? 32 : header[i];
    if (actualChecksum !== expectedChecksum) throw new Error('Invalid tar header checksum.');
    const prefix = field(header, 345, 155);
    const name = `${prefix ? `${prefix}/` : ''}${field(header, 0, 100)}`;
    const size = octal(field(header, 124, 12), 'size');
    const start = offset + 512;
    const end = start + size;
    if (end > tar.length) throw new Error('Truncated tar member.');
    if (wanted.has(name)) {
      const type = field(header, 156, 1);
      if (type !== '' && type !== '0') throw new Error(`Required tar member is not a regular file: ${name}`);
      if (found.has(name)) throw new Error(`Duplicate tar member: ${name}`);
      found.set(name, Buffer.from(tar.subarray(start, end)));
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  for (const name of wanted) if (!found.has(name)) throw new Error(`Missing npm archive member: ${name}`);
  return found;
}

export function runtimeMetadata(packageBytes) {
  const pkg = JSON.parse(packageBytes.toString('utf8'));
  if (pkg.name !== 'onnxruntime-web' || pkg.version !== VERSION || pkg.license !== 'MIT'
    || pkg.repository?.url !== 'https://github.com/Microsoft/onnxruntime.git' || pkg.repository?.type !== 'git') {
    throw new Error('Unexpected npm package identity or license metadata.');
  }
  const metadata = { name: pkg.name, version: pkg.version, license: pkg.license,
    repository: { url: pkg.repository.url, type: pkg.repository.type } };
  // The lock was produced on Windows. Preserve its CRLF bytes on every platform.
  return Buffer.from(`${JSON.stringify(metadata, null, 2).replace(/\n/g, '\r\n')}\r\n`, 'utf8');
}

export async function prepareDownloads(missing) {
  const prepared = new Map();
  for (const entry of missing.filter((item) => MODEL_URLS.has(item.path))) {
    console.log(`Fetching ${entry.path} from pinned Hugging Face revision.`);
    const bytes = await fetchBytes(MODEL_URLS.get(entry.path), entry.bytes);
    verifyBytes(entry, bytes);
    prepared.set(entry.path, bytes);
  }
  const runtimeMissing = missing.filter((entry) => !MODEL_URLS.has(entry.path));
  if (runtimeMissing.length) {
    console.log(`Fetching onnxruntime-web@${VERSION} from the npm registry.`);
    const archive = await fetchBytes(ARCHIVE_URL, 64 * 1024 * 1024);
    if (createHash('sha256').update(archive).digest('hex') !== ARCHIVE_SHA256
      || createHash('sha512').update(archive).digest('base64') !== ARCHIVE_SHA512) {
      throw new Error('npm archive integrity mismatch; no downloaded assets were written.');
    }
    const members = readTarFiles(archive, new Set([...RUNTIME_MEMBERS.values(), 'package/package.json']));
    const metadata = runtimeMetadata(members.get('package/package.json'));
    for (const entry of runtimeMissing) {
      const bytes = entry.path === METADATA_PATH ? metadata : members.get(RUNTIME_MEMBERS.get(entry.path));
      verifyBytes(entry, bytes);
      prepared.set(entry.path, bytes);
    }
  }
  return prepared;
}

async function publishMissing(root, entries, prepared) {
  // A concurrent edit is checked again after downloading and before publishing.
  const stillMissing = await preflight(root, entries);
  for (const entry of stillMissing) {
    const bytes = prepared.get(entry.path);
    if (!bytes) throw new Error(`Asset disappeared after preflight; rerun safely: ${entry.path}`);
    verifyBytes(entry, bytes);
  }
  for (const entry of stillMissing) {
    let target = await safeDestination(root, entry.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    target = await safeDestination(root, entry.path);
    const temporary = `${target}.download-${randomUUID()}.tmp`;
    let temporaryCreated = false;
    try {
      const handle = await fs.open(temporary, 'wx');
      temporaryCreated = true;
      try { await handle.writeFile(prepared.get(entry.path)); await handle.sync(); }
      finally { await handle.close(); }
      try {
        // A hard link publishes the completed file without replacing an existing path.
        await fs.link(temporary, target);
        console.log(`Verified and saved ${entry.path}.`);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await safeDestination(root, entry.path);
        verifyBytes(entry, await fs.readFile(target));
      }
    } finally {
      if (temporaryCreated) await fs.unlink(temporary);
    }
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: node scripts/download-assets.mjs [--check]');
  }
  const root = await fs.realpath(ROOT);
  const entries = validateLock(JSON.parse(await fs.readFile(path.join(root, 'assets-lock.json'), 'utf8')));
  const missing = await preflight(root, entries);
  if (args[0] === '--check') {
    if (missing.length) throw new Error(`Missing assets: ${missing.map((entry) => entry.path).join(', ')}`);
    console.log(`PASS: all ${entries.length} locked assets match size and SHA-256; no network or file writes.`);
    return;
  }
  if (!missing.length) {
    console.log(`PASS: all ${entries.length} assets already match; no downloads or file writes.`);
    return;
  }
  const prepared = await prepareDownloads(missing);
  await publishMissing(root, entries, prepared);
  if ((await preflight(root, entries)).length) throw new Error('An asset is missing after publication.');
  console.log(`PASS: all ${entries.length} assets match the lock.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(`Asset check failed: ${error.message}`); process.exitCode = 1; });
}
