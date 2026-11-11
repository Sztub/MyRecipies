// Per-device AES-256-GCM key for secrets kept at rest on this device (e.g. the GitHub token, T23).
// Generated once, non-extractable, stored in its own IndexedDB database so that forgetting the
// passphrase-derived backup key (keyStore.ts → clearKey) never touches it. Nothing here logs.

import { base64ToBytes, bytesToBase64 } from './base64';
import { CryptoError, DecryptError, type Envelope } from './types';

export const DEVICE_KEY_DB_NAME = 'recipes-device-key';
const STORE = 'keys';
const RECORD_ID = 'device';
const IV_BYTES = 12;

interface DeviceKeyRecord {
  key: CryptoKey;
  createdAt: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

let cached: Promise<CryptoKey> | null = null;

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new CryptoError('Web Crypto is not available (needs a secure context)');
  return s;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DEVICE_KEY_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new CryptoError('Could not open device key store'));
    req.onblocked = () => reject(new CryptoError('Device key store is blocked by another tab'));
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = (ev) => {
        ev.preventDefault();
        reject(tx.error ?? req.error ?? new CryptoError('Device key store transaction failed'));
      };
      tx.onabort = () => reject(tx.error ?? new CryptoError('Device key store transaction aborted'));
    });
  } finally {
    db.close();
  }
}

function isCryptoKey(v: unknown): v is CryptoKey {
  return typeof CryptoKey !== 'undefined' ? v instanceof CryptoKey : typeof v === 'object' && v !== null;
}

async function readKey(): Promise<CryptoKey | null> {
  const rec = (await run('readonly', (s) => s.get(RECORD_ID))) as Partial<DeviceKeyRecord> | undefined;
  return rec && isCryptoKey(rec.key) ? rec.key : null;
}

async function loadOrCreate(): Promise<CryptoKey> {
  const existing = await readKey();
  if (existing) return existing;
  const key = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  if (key.extractable) throw new CryptoError('Refusing to store an extractable key');
  const record: DeviceKeyRecord = { key, createdAt: new Date().toISOString() };
  try {
    // `add` (not `put`): if another tab created a key in the meantime, keep theirs.
    await run('readwrite', (s) => s.add(record, RECORD_ID));
    return key;
  } catch {
    const winner = await readKey();
    if (winner) return winner;
    throw new CryptoError('Could not store device key');
  }
}

/** This device's secret-at-rest key; created (non-extractable) on first use. */
export function getDeviceKey(): Promise<CryptoKey> {
  if (!cached) {
    cached = loadOrCreate().catch((e: unknown) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}

/** Encrypts a string with the device key (fresh 12-byte IV). `aad` binds the ciphertext to its purpose. */
export async function sealWithDeviceKey(plaintext: string, aad: string): Promise<Envelope> {
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(plaintext)),
  );
  return { v: 1, alg: 'AES-256-GCM', iv: bytesToBase64(iv), ct: bytesToBase64(ct) };
}

/** Decrypts a `sealWithDeviceKey` envelope. Throws `DecryptError` (no secret in the message) on any failure. */
export async function openWithDeviceKey(env: Envelope, aad: string): Promise<string> {
  if (env?.v !== 1 || env.alg !== 'AES-256-GCM' || typeof env.iv !== 'string' || typeof env.ct !== 'string') {
    throw new DecryptError('Unsupported envelope');
  }
  const key = await getDeviceKey();
  try {
    const iv = base64ToBytes(env.iv);
    if (iv.length !== IV_BYTES) throw new DecryptError('Bad IV');
    const pt = await subtle().decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv), additionalData: enc.encode(aad) },
      key,
      new Uint8Array(base64ToBytes(env.ct)),
    );
    return dec.decode(pt);
  } catch {
    throw new DecryptError();
  }
}

/** Deletes the device key (anything sealed with it becomes unreadable). Tests / full device reset only. */
export async function clearDeviceKey(): Promise<void> {
  cached = null;
  await run('readwrite', (s) => s.delete(RECORD_ID));
}
