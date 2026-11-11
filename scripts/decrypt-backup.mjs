#!/usr/bin/env node
// Independent decryptor for the encrypted GitHub backup (no app runtime: no Dexie, no browser).
//
//   node scripts/decrypt-backup.mjs <file|dir> --passphrase-file <path> [--keycheck <keycheck.json>] [--out <dir>] [--json]
//
// <file> is a backup envelope (devices/<id>/backups/*.enc or latest.enc). <dir> is scanned recursively:
// every devices/*/backups/*.enc and latest.enc is decrypted. keycheck.json is looked up next to the
// file / in the dir (or its parents) unless --keycheck is given. Bundles are validated with the SAME zod
// schema as the app (src/lib/backup/schema.ts, loaded through Node's native TypeScript stripping).
// Files written by newer app versions (envelope v: 2) are bound to their path in the data repo, so keep the
// checkout's layout: paths are taken relative to the folder containing keycheck.json (the repo / basePath root).
// With --out, bundle JSON and decrypted photos (sha256-verified) are written there.
// Exit code: 0 all good, 1 any failure. The passphrase is never printed.

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { subtle } = webcrypto;
const here = path.dirname(fileURLToPath(import.meta.url));
const schemaUrl = pathToFileURL(path.join(here, '..', 'src', 'lib', 'backup', 'schema.ts')).href;

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const o = { target: null, pass: null, keycheck: null, out: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--passphrase-file') o.pass = argv[++i];
    else if (a === '--keycheck') o.keycheck = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a.startsWith('--')) fail(`unknown option ${a}`);
    else if (!o.target) o.target = a;
    else fail('only one file or directory may be given');
  }
  if (!o.target || !o.pass) {
    fail('usage: decrypt-backup.mjs <file|dir> --passphrase-file <path> [--keycheck <file>] [--out <dir>] [--json]');
  }
  return o;
}

const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const enc = new TextEncoder();

/** PBKDF2-SHA256(NFC passphrase) -> HKDF-SHA256(empty salt, info) -> AES-256-GCM, as in src/lib/crypto. */
async function deriveKey(passphrase, keyCheck) {
  if (keyCheck?.v !== 1 || keyCheck.kdf !== 'PBKDF2-SHA256') fail('unsupported keycheck.json');
  const base = await subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(keyCheck.salt), iterations: keyCheck.iterations },
    base,
    256,
  );
  const master = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('recipes/aes-256-gcm/v1') },
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

/**
 * `v: 1` = plain AES-GCM. `v: 2` = AAD `recipes/file/v2:<path relative to keycheck.json's folder>`
 * (same as fileAad() in src/lib/backup/github-backup.ts), so files must keep their place in the repo.
 */
async function decryptEnvelope(key, envJson, repoPath) {
  const env = typeof envJson === 'string' ? JSON.parse(envJson) : envJson;
  if ((env?.v !== 1 && env?.v !== 2) || env.alg !== 'AES-256-GCM' || typeof env.iv !== 'string' || typeof env.ct !== 'string') {
    throw new Error('not an encrypted envelope');
  }
  const params = { name: 'AES-GCM', iv: b64(env.iv) };
  if (env.v === 2) {
    if (!repoPath) throw new Error('v2 file needs its repo path');
    params.additionalData = new TextEncoder().encode(`recipes/file/v2:${repoPath}`);
  }
  try {
    return new Uint8Array(await subtle.decrypt(params, key, b64(env.ct)));
  } catch {
    throw new Error('decryption failed (wrong passphrase, damaged file, or file moved from its repo path)');
  }
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function findUp(start, name) {
  let dir = statSync(start).isDirectory() ? start : path.dirname(start);
  for (;;) {
    const p = path.join(dir, name);
    if (existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const opts = parseArgs(process.argv.slice(2));
if (!existsSync(opts.target)) fail(`not found: ${opts.target}`);
const passphrase = readFileSync(opts.pass, 'utf8').replace(/\r?\n$/, '');
if (!passphrase) fail('passphrase file is empty');

const kcPath = opts.keycheck ?? findUp(opts.target, 'keycheck.json');
if (!kcPath) fail('keycheck.json not found (pass --keycheck)');
const keyCheck = JSON.parse(readFileSync(kcPath, 'utf8'));
const key = await deriveKey(passphrase, keyCheck);
try {
  await decryptEnvelope(key, keyCheck.check);
} catch {
  fail('wrong passphrase');
}

const { parseBundle } = await import(schemaUrl);

/** Path relative to the repo folder that holds keycheck.json, with '/' separators (the AAD path). */
const repoRoot = path.dirname(path.resolve(kcPath));
const repoPathOf = (file) => path.relative(repoRoot, path.resolve(file)).split(path.sep).join('/');

const isDir = statSync(opts.target).isDirectory();
const root = isDir ? opts.target : path.dirname(opts.target);
const files = isDir
  ? walk(opts.target).filter((f) => /[\\/]devices[\\/][^\\/]+[\\/](backups[\\/][^\\/]+\.enc|latest\.enc)$/.test(f))
  : [opts.target];
if (files.length === 0) fail('no backup files found');

const photosPath = isDir ? path.join(opts.target, 'photos') : path.join(path.dirname(kcPath), 'photos');
const photoFiles = new Map(); // sha256 -> decrypted bytes
let failures = 0;
const results = [];

if (existsSync(photosPath) && statSync(photosPath).isDirectory()) {
  for (const name of readdirSync(photosPath)) {
    try {
      const file = path.join(photosPath, name);
      const bytes = await decryptEnvelope(key, readFileSync(file, 'utf8'), repoPathOf(file));
      photoFiles.set(createHash('sha256').update(bytes).digest('hex'), bytes);
    } catch (e) {
      console.error(`FAIL photos/${name}: ${e.message}`);
      failures++;
    }
  }
}

const live = (xs) => xs.filter((x) => !x.deleted).length;
for (const file of files) {
  const rel = path.relative(root, file) || path.basename(file);
  try {
    const bundle = parseBundle(Buffer.from(await decryptEnvelope(key, readFileSync(file, 'utf8'), repoPathOf(file))).toString('utf8'));
    const missing = bundle.photos.map((p) => p.hash).filter((h) => !photoFiles.has(h));
    results.push({ file: rel, bundle });
    if (opts.out) {
      const dest = path.join(opts.out, rel.replace(/\.enc$/, '.json'));
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, JSON.stringify(bundle, null, 2));
    }
    if (missing.length) failures++;
    if (!opts.json) {
      console.log(
        `${missing.length ? 'FAIL' : 'OK  '} ${rel}: recipes=${live(bundle.recipes)} categories=${live(bundle.categories)} tags=${live(bundle.tags)} photos=${bundle.photos.length}` +
          (missing.length ? ` missing-photo-files=${missing.length}` : ''),
      );
    }
  } catch (e) {
    failures++;
    console.error(`FAIL ${rel}: ${e.message}`);
  }
}

if (opts.out && photoFiles.size) {
  mkdirSync(path.join(opts.out, 'photos'), { recursive: true });
  for (const [hash, bytes] of photoFiles) writeFileSync(path.join(opts.out, 'photos', `${hash}.bin`), bytes);
}
if (opts.json) console.log(JSON.stringify(results, null, 2));
process.exit(failures ? 1 : 0);
