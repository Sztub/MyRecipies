import { test, expect } from '@playwright/test';
import { injectModule } from './bundle';

// T06 core assumption: a non-extractable CryptoKey can be stored in IndexedDB and loaded back
// after a reload, in Chromium and (critically) WebKit. Uses the real module, bundled into the page.

type CryptoModule = typeof import('../../src/lib/crypto');
const MODULE_ENTRY = 'src/lib/crypto/index.ts';

test('non-extractable key survives IndexedDB store + reload', async ({ page }) => {
  await page.goto('/');
  await injectModule(page, MODULE_ENTRY, 'AppCrypto');

  const before = await page.evaluate(async () => {
    const m = (window as unknown as { AppCrypto: CryptoModule }).AppCrypto;
    await m.clearKey();
    const { key, keyCheck } = await m.createKeyCheck('test-passphrase-e2e', { iterations: 1000 });
    const env = await m.encryptJson(key, { title: 'Pierogi' });
    const name = await m.photoFileName(key, 'abc');
    await m.storeKey(key);
    return { env, name, keyCheck, extractable: key.extractable };
  });
  expect(before.extractable).toBe(false);

  await page.reload();
  await injectModule(page, MODULE_ENTRY, 'AppCrypto');

  const after = await page.evaluate(
    async ({ env, name }) => {
      const m = (window as unknown as { AppCrypto: CryptoModule }).AppCrypto;
      const key = await m.loadKey();
      if (!key) return { loaded: false as const };
      let exportRejected = false;
      try {
        await crypto.subtle.exportKey('raw', key);
      } catch {
        exportRejected = true;
      }
      const result = {
        loaded: true as const,
        isCryptoKey: key instanceof CryptoKey,
        extractable: key.extractable,
        exportRejected,
        json: await m.decryptJson(key, env),
        sameName: (await m.photoFileName(key, 'abc')) === name,
      };
      await m.clearKey();
      return { ...result, cleared: (await m.loadKey()) === null };
    },
    { env: before.env, name: before.name },
  );

  expect(after).toEqual({
    loaded: true,
    isCryptoKey: true,
    extractable: false,
    exportRejected: true,
    json: { title: 'Pierogi' },
    sameName: true,
    cleared: true,
  });
});

test('default 600 000 iterations: unlock timing', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await injectModule(page, MODULE_ENTRY, 'AppCrypto');
  const ms = await page.evaluate(async () => {
    const m = (window as unknown as { AppCrypto: CryptoModule }).AppCrypto;
    const t0 = performance.now();
    const { keyCheck } = await m.createKeyCheck('test-passphrase-e2e');
    const t1 = performance.now();
    await m.unlock('test-passphrase-e2e', keyCheck);
    const t2 = performance.now();
    return {
      iterations: keyCheck.iterations,
      create: Math.round(t1 - t0),
      unlock: Math.round(t2 - t1),
    };
  });
  expect(ms.iterations).toBe(600_000);
  testInfo.annotations.push({ type: 'pbkdf2-ms', description: JSON.stringify(ms) });
  // Timing only for the T06 report; plain stdout, no secrets.
  process.stdout.write(`[${testInfo.project.name}] PBKDF2 600k timing ms: ${JSON.stringify(ms)}\n`);
});
