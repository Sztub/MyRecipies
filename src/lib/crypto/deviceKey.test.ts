import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearKey, createKeyCheck, storeKey } from './index';
import { clearDeviceKey, getDeviceKey, openWithDeviceKey, sealWithDeviceKey } from './deviceKey';
import { DecryptError } from './types';

const SECRET = 'test-token-device-key-1';
const AAD = 'recipes/test/v1';

beforeEach(async () => {
  await clearDeviceKey();
  await clearKey();
});

describe('device key', () => {
  it('is a non-extractable AES-GCM key, created once and reused', async () => {
    const a = await getDeviceKey();
    expect(a.extractable).toBe(false);
    expect(a.algorithm.name).toBe('AES-GCM');
    expect(await getDeviceKey()).toBe(a);
  });

  it('concurrent first calls agree on one key', async () => {
    const [a, b] = await Promise.all([getDeviceKey(), getDeviceKey()]);
    expect(a).toBe(b);
  });

  it('round-trips, with a fresh IV each time and no plaintext in the envelope', async () => {
    const e1 = await sealWithDeviceKey(SECRET, AAD);
    const e2 = await sealWithDeviceKey(SECRET, AAD);
    expect(e1.iv).not.toBe(e2.iv);
    expect(JSON.stringify(e1)).not.toContain(SECRET);
    expect(await openWithDeviceKey(e1, AAD)).toBe(SECRET);
  });

  it('is persisted: a freshly loaded module (simulated reload) still decrypts', async () => {
    const env = await sealWithDeviceKey(SECRET, AAD);
    vi.resetModules();
    const fresh = await import('./deviceKey');
    expect(await fresh.openWithDeviceKey(env, AAD)).toBe(SECRET);
  });

  it('rejects wrong AAD, tampering and a lost key with DecryptError', async () => {
    const env = await sealWithDeviceKey(SECRET, AAD);
    await expect(openWithDeviceKey(env, 'other/purpose')).rejects.toBeInstanceOf(DecryptError);
    const flipped = { ...env, ct: env.ct.slice(0, -4) + (env.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA') };
    await expect(openWithDeviceKey(flipped, AAD)).rejects.toBeInstanceOf(DecryptError);
    await clearDeviceKey();
    await expect(openWithDeviceKey(env, AAD)).rejects.toBeInstanceOf(DecryptError);
  });

  it('is independent of the passphrase key: clearKey() keeps it', async () => {
    const env = await sealWithDeviceKey(SECRET, AAD);
    const { key } = await createKeyCheck('correct horse battery', { iterations: 1000 });
    await storeKey(key);
    await clearKey();
    expect(await openWithDeviceKey(env, AAD)).toBe(SECRET);
  });
});
