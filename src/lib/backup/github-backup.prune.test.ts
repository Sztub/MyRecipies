// @vitest-environment node
// Keep-last-N pruning after a GitHub backup (T28), against the in-memory GitHub mock.
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getDeviceId, recipes, resetDb, settings } from '../../db';
import { createKeyCheck, type KeyCheck } from '../crypto';
import type { GitHubConfig } from '../github';
import { createMockGitHub } from '../../../test/mocks/github';
import {
  DEFAULT_KEEP_LAST,
  KEYCHECK_PATH,
  backupFileName,
  backupNow,
  clampKeepLast,
  devicePaths,
  fetchKeyCheck,
  getKeepLast,
  getLastBackup,
  pruneDeviceBackups,
} from './github-backup';

const TOKEN = 'test-token-t28-prune';
const gh = createMockGitHub({ token: TOKEN, owner: 'octo', repo: 'data' });
const server = setupServer(...gh.handlers);
const cfg: GitHubConfig = { owner: 'octo', repo: 'data', branch: 'main', token: TOKEN };
const OTHER = 'other-device-0000';

let key: CryptoKey;
let keyCheck: KeyCheck;

beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  ({ key, keyCheck } = await createKeyCheck('t28 prune passphrase', { iterations: 1000 }));
});
afterAll(() => server.close());
beforeEach(async () => {
  gh.reset();
  gh.clearErrors();
  gh.requests.length = 0;
  await resetDb();
  await gh.seed(KEYCHECK_PATH, JSON.stringify(keyCheck));
  await recipes.save({ title: 'Bigos', tagIds: [], ingredients: [], steps: [], photoHashes: [] });
});

/** ISO time `i` days after 2025-01-01 (all older than "now"). */
const oldTime = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString();

/** Seeds `count` old backups for `deviceId`, plus latest/device files and a photo. Returns their paths. */
async function seedDevice(deviceId: string, count: number): Promise<string[]> {
  const p = devicePaths(deviceId);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const path = `${p.backupsDir}/${backupFileName(oldTime(i))}`;
    await gh.seed(path, `{"old":${i}}`);
    out.push(path);
  }
  await gh.seed(p.latest, '{"latest":true}');
  await gh.seed(p.deviceInfo, '{"info":true}');
  return out;
}

const backupsOf = (deviceId: string) =>
  gh.paths().filter((x) => x.startsWith(`${devicePaths(deviceId).backupsDir}/`));

describe('keep-last-N pruning', () => {
  it('keeps exactly N newest backups of this device and touches nothing else', async () => {
    const me = await getDeviceId();
    const mine = await seedDevice(me, 12);
    const theirs = await seedDevice(OTHER, 9);
    await gh.seed('photos/abc.enc', '{"photo":true}');
    const others = gh.paths().filter((x) => !mine.includes(x));

    const res = await backupNow(cfg, key, { keepLast: 5 });

    const left = backupsOf(me);
    expect(left).toHaveLength(5);
    expect(left).toContain(res.path);
    // the 4 newest old ones survive, oldest first deleted
    expect(left.filter((x) => x !== res.path)).toEqual(mine.slice(-4));
    expect(res.pruned).toBe(8);
    expect(res.pruneError).toBeUndefined();
    // every other file is still there: latest.enc, device.json.enc, photos, keycheck, other device
    for (const x of others) expect(gh.paths()).toContain(x);
    expect(backupsOf(OTHER)).toEqual(theirs);
    // and the only DELETE requests were for this device's backups
    const deletes = gh.requests.filter((r) => r.method === 'DELETE');
    expect(deletes).toHaveLength(8);
    for (const d of deletes) {
      expect(d.path.startsWith(`${devicePaths(me).backupsDir}/`)).toBe(true);
      expect(d.path.endsWith('.enc')).toBe(true);
    }
  });

  it('uses the setting, default 20', async () => {
    const me = await getDeviceId();
    expect(await getKeepLast()).toBe(DEFAULT_KEEP_LAST);
    await seedDevice(me, 25);
    const res = await backupNow(cfg, key);
    expect(backupsOf(me)).toHaveLength(20);
    expect(res.pruned).toBe(6);

    await settings.set('backupKeepLast', 3);
    await backupNow(cfg, key);
    expect(backupsOf(me)).toHaveLength(3);
  });

  it('deletes nothing when there are N or fewer', async () => {
    const me = await getDeviceId();
    await seedDevice(me, 2);
    const res = await backupNow(cfg, key, { keepLast: 3 });
    expect(backupsOf(me)).toHaveLength(3);
    expect(res.pruned).toBe(0);
    expect(gh.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it('never deletes files that do not follow the backup naming scheme', async () => {
    const me = await getDeviceId();
    await seedDevice(me, 4);
    const dir = devicePaths(me).backupsDir;
    await gh.seed(`${dir}/notes.txt`, 'keep me');
    await gh.seed(`${dir}/manual-copy.enc`, 'keep me');
    await backupNow(cfg, key, { keepLast: 1 });
    expect(backupsOf(me).sort()).toEqual(
      [`${dir}/manual-copy.enc`, `${dir}/notes.txt`, (await getLastBackup())!.path].sort(),
    );
  });

  it('a failing delete does not fail the backup', async () => {
    const me = await getDeviceId();
    await seedDevice(me, 6);
    gh.injectError({ kind: 'server', method: 'DELETE', times: Infinity });
    const res = await backupNow(cfg, key, { keepLast: 2 });
    expect(res.pruneError).toBeDefined();
    expect(res.pruned).toBe(0);
    expect(gh.paths()).toContain(res.path);
    expect(gh.paths()).toContain(devicePaths(me).latest);
    expect((await getLastBackup())?.path).toBe(res.path);
    expect(backupsOf(me)).toHaveLength(7);
  });

  it('a failing listing or a failure half-way is reported, the backup stands', async () => {
    const me = await getDeviceId();
    await seedDevice(me, 6);
    gh.injectError({ kind: 'network', method: 'GET', pathIncludes: '/backups', times: 1 });
    const res = await backupNow(cfg, key, { keepLast: 2 });
    expect(res.pruneError).toBe('network');
    expect(backupsOf(me)).toHaveLength(7);

    // next backup cleans up; here the 3rd delete fails → 2 deleted, then stop
    gh.clearErrors();
    const deletesBefore = gh.requests.filter((r) => r.method === 'DELETE').length;
    let n = 0;
    server.events.on('request:start', ({ request }) => {
      if (request.method === 'DELETE' && ++n === 3) gh.injectError({ kind: 'rate-limited', method: 'DELETE' });
    });
    const res2 = await backupNow(cfg, key, { keepLast: 2 });
    server.events.removeAllListeners();
    expect(res2.pruned).toBe(2);
    expect(res2.pruneError).toBe('rate-limited');
    expect(gh.requests.filter((r) => r.method === 'DELETE').length - deletesBefore).toBe(3);
    expect(backupsOf(me)).toHaveLength(8 - 2);
  });

  it('pruneDeviceBackups keeps the given path even if it is not listed yet', async () => {
    const me = await getDeviceId();
    await seedDevice(me, 3);
    const fresh = `${devicePaths(me).backupsDir}/${backupFileName('2030-01-01T00:00:00.000Z')}`;
    const res = await pruneDeviceBackups(cfg, me, 2, fresh);
    // fresh (unlisted) counts as one of the 2 → only the newest seeded one stays
    expect(res).toEqual({ deleted: 2 });
    expect(backupsOf(me)).toEqual([`${devicePaths(me).backupsDir}/${backupFileName(oldTime(2))}`]);
  });

  it('pruneDeviceBackups refuses odd device ids', async () => {
    await seedDevice(OTHER, 3);
    expect((await pruneDeviceBackups(cfg, '../x', 1)).error).toBe('unknown');
    expect(backupsOf(OTHER)).toHaveLength(3);
  });

  it('clampKeepLast', () => {
    expect(clampKeepLast(0)).toBe(1);
    expect(clampKeepLast(7.9)).toBe(7);
    expect(clampKeepLast(10_000)).toBe(500);
    expect(clampKeepLast(Number.NaN)).toBe(DEFAULT_KEEP_LAST);
  });
});

describe('fetchKeyCheck', () => {
  it('returns the key check, null if missing, corrupt if malformed', async () => {
    expect(await fetchKeyCheck(cfg)).toEqual(keyCheck);
    gh.remove(KEYCHECK_PATH);
    expect(await fetchKeyCheck(cfg)).toBeNull();
    await gh.seed(KEYCHECK_PATH, '{"v":2}');
    await expect(fetchKeyCheck(cfg)).rejects.toMatchObject({ kind: 'corrupt' });
  });
});
