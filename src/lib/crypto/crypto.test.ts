// @vitest-environment node
// Node env: real Web Crypto; fake-indexeddb comes from test/setup.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  clearKey,
  createKeyCheck,
  decrypt,
  decryptJson,
  DecryptError,
  DEFAULT_ITERATIONS,
  encrypt,
  encryptJson,
  loadKey,
  photoFileName,
  storeKey,
  unlock,
  WrongPassphraseError,
  type Envelope,
} from './index';

const IT = 1_000; // low for speed; production default is 600 000
const PASS = 'correct horse battery staple';

function flipFirstByte(b64: string): string {
  const bytes = base64ToBytes(b64);
  bytes[0] = (bytes[0] ?? 0) ^ 0x01;
  return bytesToBase64(bytes);
}

describe('base64', () => {
  it('round-trips arbitrary bytes, including large buffers', () => {
    const data = new Uint8Array(100_000).map((_, i) => (i * 31 + 7) & 0xff);
    expect(base64ToBytes(bytesToBase64(data))).toEqual(data);
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
    expect(bytesToBase64(new TextEncoder().encode('Man'))).toBe('TWFu');
  });
  it('rejects malformed input', () => {
    expect(() => base64ToBytes('abc')).toThrow(TypeError);
    expect(() => base64ToBytes('ab$=')).toThrow(TypeError);
  });
});

describe('key check + unlock', () => {
  it('defaults to 600 000 iterations', () => {
    expect(DEFAULT_ITERATIONS).toBe(600_000);
  });

  it('creates a KeyCheck with the contract shape and a non-extractable key', async () => {
    const { keyCheck, key } = await createKeyCheck(PASS, { iterations: IT });
    expect(keyCheck).toMatchObject({ v: 1, kdf: 'PBKDF2-SHA256', iterations: IT });
    expect(base64ToBytes(keyCheck.salt)).toHaveLength(16);
    expect(keyCheck.check).toMatchObject({ v: 1, alg: 'AES-256-GCM' });
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    expect(JSON.stringify(keyCheck)).not.toContain(PASS);
  });

  it('uses a new salt each time', async () => {
    const a = await createKeyCheck(PASS, { iterations: IT });
    const b = await createKeyCheck(PASS, { iterations: IT });
    expect(a.keyCheck.salt).not.toBe(b.keyCheck.salt);
  });

  it('unlock with the right passphrase yields a key that decrypts data from the original key', async () => {
    const { keyCheck, key } = await createKeyCheck(PASS, { iterations: IT });
    const env = await encryptJson(key, { hello: 'świat' });
    const again = await unlock(PASS, keyCheck);
    expect(await decryptJson(again, env)).toEqual({ hello: 'świat' });
  });

  it('wrong passphrase → WrongPassphraseError', async () => {
    const { keyCheck } = await createKeyCheck(PASS, { iterations: IT });
    await expect(unlock('wrong passphrase', keyCheck)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('tampered key check → WrongPassphraseError', async () => {
    const { keyCheck } = await createKeyCheck(PASS, { iterations: IT });
    const tampered = { ...keyCheck, check: { ...keyCheck.check, ct: flipFirstByte(keyCheck.check.ct) } };
    await expect(unlock(PASS, tampered)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('rejects absurd iteration counts', async () => {
    const { keyCheck } = await createKeyCheck(PASS, { iterations: IT });
    await expect(unlock(PASS, { ...keyCheck, iterations: 0 })).rejects.toThrow('Invalid iteration count');
    await expect(unlock(PASS, { ...keyCheck, iterations: 1e12 })).rejects.toThrow('Invalid iteration count');
  });
});

describe('encrypt / decrypt', () => {
  it('round-trips bytes', async () => {
    const { key } = await createKeyCheck(PASS, { iterations: IT });
    const data = crypto.getRandomValues(new Uint8Array(5000));
    const env = await encrypt(key, data);
    expect(env.v).toBe(1);
    expect(env.alg).toBe('AES-256-GCM');
    expect(await decrypt(key, env)).toEqual(data);
  });

  it('with AAD: v2 envelope that opens only with the same AAD', async () => {
    const { key } = await createKeyCheck(PASS, { iterations: IT });
    const data = new TextEncoder().encode('bound');
    const env = await encrypt(key, data, 'recipes/file/v2:devices/a/latest.enc');
    expect(env.v).toBe(2);
    expect(await decrypt(key, env, 'recipes/file/v2:devices/a/latest.enc')).toEqual(data);
    await expect(decrypt(key, env, 'recipes/file/v2:devices/b/latest.enc')).rejects.toBeInstanceOf(DecryptError);
    await expect(decrypt(key, env)).rejects.toBeInstanceOf(DecryptError);
    // Relabelling it as v1 doesn't help: the tag still covers the AAD.
    await expect(decrypt(key, { ...env, v: 1 })).rejects.toBeInstanceOf(DecryptError);
  });

  it('v1 envelopes (written before AAD) still open when an AAD is passed', async () => {
    const { key } = await createKeyCheck(PASS, { iterations: IT });
    const env = await encryptJson(key, { a: 1 });
    expect(await decryptJson(key, env, 'recipes/file/v2:anything')).toEqual({ a: 1 });
  });

  it('uses a fresh 12-byte IV per call', async () => {
    const { key } = await createKeyCheck(PASS, { iterations: IT });
    const data = new TextEncoder().encode('same plaintext');
    const ivs = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const env = await encrypt(key, data);
      expect(base64ToBytes(env.iv)).toHaveLength(12);
      ivs.add(env.iv);
    }
    expect(ivs.size).toBe(50);
  });

  it('tampered ciphertext or IV fails with DecryptError', async () => {
    const { key } = await createKeyCheck(PASS, { iterations: IT });
    const env = await encrypt(key, new TextEncoder().encode('secret recipe'));
    await expect(decrypt(key, { ...env, ct: flipFirstByte(env.ct) })).rejects.toBeInstanceOf(DecryptError);
    await expect(decrypt(key, { ...env, iv: flipFirstByte(env.iv) })).rejects.toBeInstanceOf(DecryptError);
    const truncated = bytesToBase64(base64ToBytes(env.ct).slice(0, -1));
    await expect(decrypt(key, { ...env, ct: truncated })).rejects.toBeInstanceOf(DecryptError);
  });

  it('a different key cannot decrypt', async () => {
    const a = await createKeyCheck(PASS, { iterations: IT });
    const b = await createKeyCheck(PASS, { iterations: IT }); // same passphrase, other salt
    const env = await encrypt(a.key, new Uint8Array([1, 2, 3]));
    await expect(decrypt(b.key, env)).rejects.toBeInstanceOf(DecryptError);
  });

  it('malformed envelopes fail with DecryptError', async () => {
    const { key } = await createKeyCheck(PASS, { iterations: IT });
    const env = await encrypt(key, new Uint8Array([1]));
    const bad: unknown[] = [
      { ...env, v: 2 },
      { ...env, alg: 'AES-128-CBC' },
      { ...env, iv: 'not base64!' },
      { ...env, iv: bytesToBase64(new Uint8Array(8)) },
      null,
    ];
    for (const b of bad) {
      await expect(decrypt(key, b as Envelope)).rejects.toBeInstanceOf(DecryptError);
    }
  });
});

describe('photoFileName', () => {
  const hash = 'a'.repeat(64);

  it('is deterministic per key (also after unlock) and does not contain the hash', async () => {
    const { keyCheck, key } = await createKeyCheck(PASS, { iterations: IT });
    const name = await photoFileName(key, hash);
    expect(name).toMatch(/^[0-9a-f]{64}\.enc$/);
    expect(name).not.toContain(hash);
    expect(await photoFileName(key, hash)).toBe(name);
    expect(await photoFileName(await unlock(PASS, keyCheck), hash)).toBe(name);
    expect(await photoFileName(key, 'b'.repeat(64))).not.toBe(name);
  });

  it('differs across keys', async () => {
    const a = await createKeyCheck(PASS, { iterations: IT });
    const b = await createKeyCheck(PASS, { iterations: IT });
    expect(await photoFileName(a.key, hash)).not.toBe(await photoFileName(b.key, hash));
  });

  it('refuses a foreign key', async () => {
    const foreign = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    await expect(photoFileName(foreign, hash)).rejects.toThrow();
  });
});

describe('key store (IndexedDB)', () => {
  beforeEach(async () => {
    await clearKey();
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadKey()).toBeNull();
  });

  it('stores and loads a non-extractable key that still works', async () => {
    const { key } = await createKeyCheck(PASS, { iterations: IT });
    const env = await encrypt(key, new Uint8Array([9, 8, 7]));
    const name = await photoFileName(key, 'abc');
    await storeKey(key);
    const loaded = await loadKey();
    expect(loaded).not.toBeNull();
    if (!loaded) return;
    expect(loaded.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', loaded)).rejects.toThrow();
    expect(await decrypt(loaded, env)).toEqual(new Uint8Array([9, 8, 7]));
    expect(await photoFileName(loaded, 'abc')).toBe(name);
  });

  it('clearKey removes it', async () => {
    const { key } = await createKeyCheck(PASS, { iterations: IT });
    await storeKey(key);
    await clearKey();
    expect(await loadKey()).toBeNull();
  });

  it('refuses keys not derived by this module', async () => {
    const foreign = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    await expect(storeKey(foreign)).rejects.toThrow();
  });
});
