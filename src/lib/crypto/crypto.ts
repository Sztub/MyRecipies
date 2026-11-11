// Passphrase → PBKDF2-SHA256 → HKDF-SHA256 → { AES-256-GCM key, HMAC-SHA256 key }.
// Web Crypto only. Keys are non-extractable. Nothing here logs.

import { base64ToBytes, bytesToBase64, bytesToHex } from './base64';
import { CryptoError, DecryptError, WrongPassphraseError, type Envelope, type KeyCheck } from './types';

export const DEFAULT_ITERATIONS = 600_000;
/** Upper bound accepted from a (possibly hostile) remote keycheck.json, to avoid hanging the UI. */
export const MAX_ITERATIONS = 10_000_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const CHECK_PLAINTEXT = 'recipes-keycheck-v1';
const INFO_ENC = 'recipes/aes-256-gcm/v1';
const INFO_MAC = 'recipes/hmac-sha256/photo-names/v1';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

/**
 * The HMAC key that belongs to each AES key. The public contract passes one `CryptoKey` around,
 * so the sibling HMAC key travels alongside it here (and in IndexedDB, see keyStore.ts).
 */
const macKeys = new WeakMap<CryptoKey, CryptoKey>();

/** @internal used by keyStore.ts */
export function getMacKey(key: CryptoKey): CryptoKey | undefined {
  return macKeys.get(key);
}

/** @internal used by keyStore.ts */
export function linkMacKey(key: CryptoKey, mac: CryptoKey): void {
  macKeys.set(key, mac);
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new CryptoError('Web Crypto is not available (needs a secure context)');
  return s;
}

/** Copy into a fresh ArrayBuffer-backed view (Web Crypto typings reject SharedArrayBuffer views). */
function buf(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(u);
}

async function deriveKeys(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const s = subtle();
  const pwKey = await s.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const master = new Uint8Array(
    await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations }, pwKey, 256),
  );
  try {
    const hkdf = await s.importKey('raw', master, 'HKDF', false, ['deriveKey']);
    const hkdfParams = (info: string): HkdfParams => ({
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: enc.encode(info),
    });
    const aes = await s.deriveKey(hkdfParams(INFO_ENC), hkdf, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const mac = await s.deriveKey(
      hkdfParams(INFO_MAC),
      hkdf,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign'],
    );
    macKeys.set(aes, mac);
    return aes;
  } finally {
    master.fill(0);
  }
}

function checkIterations(iterations: number): void {
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new CryptoError('Invalid iteration count');
  }
}

export interface CreateKeyCheckOptions {
  /** Defaults to 600 000. Tests pass a low value. */
  iterations?: number;
}

/** New random salt, derives the key and a KeyCheck that `unlock` can verify later. */
export async function createKeyCheck(
  passphrase: string,
  options: CreateKeyCheckOptions = {},
): Promise<{ keyCheck: KeyCheck; key: CryptoKey }> {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  checkIterations(iterations);
  if (passphrase.length === 0) throw new CryptoError('Passphrase must not be empty');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKeys(passphrase, salt, iterations);
  const check = await encrypt(key, enc.encode(CHECK_PLAINTEXT));
  return {
    key,
    keyCheck: { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: bytesToBase64(salt), check },
  };
}

/** Re-derives the key from the passphrase. Throws `WrongPassphraseError` if it doesn't match. */
export async function unlock(passphrase: string, keyCheck: KeyCheck): Promise<CryptoKey> {
  if (keyCheck?.v !== 1 || keyCheck.kdf !== 'PBKDF2-SHA256') throw new CryptoError('Unsupported key check');
  checkIterations(keyCheck.iterations);
  let salt: Uint8Array;
  try {
    salt = base64ToBytes(keyCheck.salt);
  } catch {
    throw new CryptoError('Malformed key check');
  }
  const key = await deriveKeys(passphrase, salt, keyCheck.iterations);
  let plain: Uint8Array;
  try {
    plain = await decrypt(key, keyCheck.check);
  } catch (e) {
    if (e instanceof DecryptError) throw new WrongPassphraseError();
    throw e;
  }
  if (bytesToBase64(plain) !== bytesToBase64(enc.encode(CHECK_PLAINTEXT))) throw new WrongPassphraseError();
  return key;
}

/**
 * AES-256-GCM with a fresh random 12-byte IV per call. With `aad` the result is a `v: 2` envelope that
 * only decrypts when the same `aad` is passed to `decrypt` (binds the ciphertext to e.g. its file path).
 */
export async function encrypt(key: CryptoKey, data: Uint8Array, aad?: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const params: AesGcmParams =
    aad === undefined ? { name: 'AES-GCM', iv } : { name: 'AES-GCM', iv, additionalData: enc.encode(aad) };
  const ct = new Uint8Array(await subtle().encrypt(params, key, buf(data)));
  return { v: aad === undefined ? 1 : 2, alg: 'AES-256-GCM', iv: bytesToBase64(iv), ct: bytesToBase64(ct) };
}

/**
 * Throws `DecryptError` for wrong key, tampering, a malformed envelope, or a `v: 2` envelope whose AAD
 * doesn't match `aad`. A `v: 1` envelope (written before AAD existed) ignores `aad`.
 */
export async function decrypt(key: CryptoKey, env: Envelope, aad?: string): Promise<Uint8Array> {
  const v: unknown = env?.v;
  if ((v !== 1 && v !== 2) || env.alg !== 'AES-256-GCM' || typeof env.iv !== 'string' || typeof env.ct !== 'string') {
    throw new DecryptError('Malformed envelope');
  }
  if (v === 2 && aad === undefined) throw new DecryptError('Envelope needs its context');
  let iv: Uint8Array<ArrayBuffer>;
  let ct: Uint8Array<ArrayBuffer>;
  try {
    iv = base64ToBytes(env.iv);
    ct = base64ToBytes(env.ct);
  } catch {
    throw new DecryptError('Malformed envelope');
  }
  if (iv.length !== IV_BYTES || ct.length < 16) throw new DecryptError('Malformed envelope');
  const params: AesGcmParams =
    v === 2 ? { name: 'AES-GCM', iv, additionalData: enc.encode(aad) } : { name: 'AES-GCM', iv };
  try {
    return new Uint8Array(await subtle().decrypt(params, key, ct));
  } catch {
    throw new DecryptError();
  }
}

export async function encryptJson(key: CryptoKey, value: unknown, aad?: string): Promise<Envelope> {
  return encrypt(key, enc.encode(JSON.stringify(value)), aad);
}

/** Returns parsed JSON as `unknown`; validate it (zod) at the call site. */
export async function decryptJson(key: CryptoKey, env: Envelope, aad?: string): Promise<unknown> {
  const bytes = await decrypt(key, env, aad);
  try {
    return JSON.parse(dec.decode(bytes)) as unknown;
  } catch {
    throw new DecryptError('Decrypted data is not valid JSON');
  }
}

/**
 * Remote file name for a photo: HMAC-SHA256(macKey, hash) as 64 hex chars + ".enc",
 * so the photo's sha256 never appears in the data repo. Deterministic per passphrase+salt.
 */
export async function photoFileName(key: CryptoKey, hash: string): Promise<string> {
  const mac = macKeys.get(key);
  if (!mac) throw new CryptoError('Key was not created by createKeyCheck/unlock/loadKey');
  const sig = new Uint8Array(await subtle().sign('HMAC', mac, enc.encode(hash)));
  return `${bytesToHex(sig)}.enc`;
}
