// Persists the derived (non-extractable) keys in a tiny dedicated IndexedDB database,
// independent of the app's Dexie DB. Structured clone keeps CryptoKeys opaque.

import { getMacKey, linkMacKey } from './crypto';
import { CryptoError } from './types';

export const KEY_DB_NAME = 'recipes-crypto';
const STORE = 'keys';
const RECORD_ID = 'backup';

interface KeyRecord {
  enc: CryptoKey;
  mac: CryptoKey;
  storedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new CryptoError('Could not open key store'));
    req.onblocked = () => reject(new CryptoError('Key store is blocked by another tab'));
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new CryptoError('Key store transaction failed'));
      tx.onabort = () => reject(tx.error ?? new CryptoError('Key store transaction aborted'));
    });
  } finally {
    db.close();
  }
}

/** Saves the key (and its sibling HMAC key) so the app can back up without asking for the passphrase. */
export async function storeKey(key: CryptoKey): Promise<void> {
  const mac = getMacKey(key);
  if (!mac) throw new CryptoError('Key was not created by createKeyCheck/unlock/loadKey');
  if (key.extractable || mac.extractable) throw new CryptoError('Refusing to store an extractable key');
  const record: KeyRecord = { enc: key, mac, storedAt: new Date().toISOString() };
  await run('readwrite', (s) => s.put(record, RECORD_ID));
}

/** Returns the stored key, or `null` if none is stored (or the record is unusable). */
export async function loadKey(): Promise<CryptoKey | null> {
  const record = (await run('readonly', (s) => s.get(RECORD_ID))) as Partial<KeyRecord> | undefined;
  if (!record || !isCryptoKey(record.enc) || !isCryptoKey(record.mac)) return null;
  linkMacKey(record.enc, record.mac);
  return record.enc;
}

export async function clearKey(): Promise<void> {
  await run('readwrite', (s) => s.delete(RECORD_ID));
}

function isCryptoKey(v: unknown): v is CryptoKey {
  return typeof CryptoKey !== 'undefined' ? v instanceof CryptoKey : typeof v === 'object' && v !== null;
}
