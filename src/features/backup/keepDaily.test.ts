import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDeviceId, resetDb, settings } from '../../db';
import { KEYCHECK_PATH, backupNow, devicePaths, getKeepDaily } from '../../lib/backup/github-backup';
import { createKeyCheck, type KeyCheck } from '../../lib/crypto';
import { createMockGitHub } from '../../../test/mocks/github';

const TOKEN = 'test-token-t41-daily';
const gh = createMockGitHub({ token: TOKEN, owner: 'octo', repo: 'data' });
const server = setupServer(...gh.handlers);
let key: CryptoKey;
let keyCheck: KeyCheck;
beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  ({ key, keyCheck } = await createKeyCheck('daily test passphrase', { iterations: 1000 }));
});
afterAll(() => server.close());
beforeEach(async () => {
  gh.reset();
  await resetDb();
});

describe('#43 backupKeepDaily', () => {
  it('defaults to 0 (off) and is read from the setting', async () => {
    expect(await getKeepDaily()).toBe(0);
    await settings.set('backupKeepDaily', 5);
    expect(await getKeepDaily()).toBe(5);
  });

  it('is applied when pruning after a backup', async () => {
    await gh.seed(KEYCHECK_PATH, JSON.stringify(keyCheck));
    const dir = devicePaths(await getDeviceId()).backupsDir;
    // Two backups on each of three old days.
    for (const d of ['01', '02', '03']) {
      await gh.seed(`${dir}/2025-01-${d}T08-00-00-000Z.enc`, '{}');
      await gh.seed(`${dir}/2025-01-${d}T20-00-00-000Z.enc`, '{}');
    }
    const cfg = { owner: 'octo', repo: 'data', branch: 'main', token: TOKEN };
    await settings.set('backupKeepLast', 1);
    await settings.set('backupKeepDaily', 3);
    await backupNow(cfg, key);
    const left = gh.paths().filter((p) => p.startsWith(`${dir}/`));
    // New backup (today) counts as day 1, so the two newest old days stay (newest file of each); the oldest day goes.
    expect(left.some((p) => p.includes('2025-01-03T20'))).toBe(true);
    expect(left.some((p) => p.includes('2025-01-01'))).toBe(false);
  });
});
