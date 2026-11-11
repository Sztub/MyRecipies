import { afterEach, expect, it, vi } from 'vitest';
import { getPersistStatus, requestPersist } from './persist';

afterEach(() => vi.unstubAllGlobals());

it('reports unsupported without the Storage API', async () => {
  vi.stubGlobal('navigator', {});
  expect(await getPersistStatus()).toBe('unsupported');
  expect(await requestPersist()).toBe('unsupported');
});

it('requests persistence when not yet persisted', async () => {
  let persisted = false;
  const persist = vi.fn(async () => {
    persisted = true;
    return true;
  });
  vi.stubGlobal('navigator', { storage: { persisted: async () => persisted, persist } });
  expect(await getPersistStatus()).toBe('not-persisted');
  expect(await requestPersist()).toBe('persisted');
  expect(persist).toHaveBeenCalledOnce();
});
