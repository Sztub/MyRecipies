// @vitest-environment node
// Node env: native Blob (arrayBuffer + structured-clone into fake-indexeddb) and Web Crypto.
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { categories, db, getDeviceId, photos, recipes, resetDb, settings, tags } from '../../db';
import type { Photo } from '../../domain/types';
import { createKeyCheck, decryptJson, type KeyCheck } from '../crypto';
import type { GitHubConfig } from '../github';
import { createMockGitHub, type MockErrorKind } from '../../../test/mocks/github';
import { blobToBytes, sha256Hex } from './bytes';
import {
  BackupError,
  backupFileName,
  backupNow,
  backupTimeFromName,
  bytesToEnvelope,
  devicePaths,
  downloadBackup,
  getLastBackup,
  KEYCHECK_PATH,
  listRemoteBackups,
  restoreBackup,
  selectBackupsToPrune,
  type RemoteBackup,
  fileAad,
} from './github-backup';
import { parseBundle } from './schema';

const TOKEN = 'test-token-t09-backup';
const PASS = 'correct horse battery staple';
const gh = createMockGitHub({ token: TOKEN, owner: 'octo', repo: 'data' });
const server = setupServer(...gh.handlers);
const cfg: GitHubConfig = { owner: 'octo', repo: 'data', branch: 'main', token: TOKEN };

let key: CryptoKey;
let keyCheck: KeyCheck;

beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  ({ key, keyCheck } = await createKeyCheck(PASS, { iterations: 1000 }));
});
afterAll(() => server.close());
beforeEach(async () => {
  gh.reset();
  gh.clearErrors();
  gh.setToken(TOKEN);
  gh.requests.length = 0;
  await resetDb();
  await gh.seed(KEYCHECK_PATH, JSON.stringify(keyCheck, null, 2));
});

const tick = () => new Promise((r) => setTimeout(r, 5));

async function makePhoto(seed: number): Promise<Photo> {
  const bytes = new Uint8Array(64).map((_, i) => (seed * 31 + i * 7) % 256);
  return {
    hash: await sha256Hex(bytes),
    mime: 'image/jpeg',
    width: 100 + seed,
    height: 80,
    size: bytes.length,
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    createdAt: '2026-01-02T03:04:05.000Z',
  };
}

const SECRET_WORDS = ['Żurek-secret', 'rye-flour-secret', 'grandma-tag-secret', 'Soups-secret', 'Kitchen tablet'];

async function seedData() {
  await settings.set('deviceName', 'Kitchen tablet');
  const p1 = await makePhoto(1);
  const p2 = await makePhoto(2);
  await photos.put(p1);
  await photos.put(p2);
  const cat = await categories.save({ name: 'Soups-secret', order: 1 });
  const tag = await tags.save({ name: 'grandma-tag-secret' });
  await recipes.save({
    title: 'Żurek-secret',
    categoryId: cat.id,
    tagIds: [tag.id],
    ingredients: [{ id: 'i1', name: 'rye-flour-secret', amount: 2, unit: 'tbsp' }],
    steps: [{ id: 's1', text: 'Boil', photoHash: p2.hash }],
    photoHashes: [p1.hash],
  });
  const gone = await recipes.save({ title: 'Gone', tagIds: [], ingredients: [], steps: [], photoHashes: [] });
  await recipes.softDelete(gone.id);
  return { p1, p2 };
}

/** Everything restorable, in a comparable form (photo blobs → bytes). */
async function snapshot() {
  const ph = await db.photos.toArray();
  return {
    recipes: await recipes.list({ includeDeleted: true }),
    categories: await categories.list({ includeDeleted: true }),
    tags: await tags.list({ includeDeleted: true }),
    photos: await Promise.all(
      ph
        .sort((a, b) => a.hash.localeCompare(b.hash))
        .map(async ({ blob, ...rest }) => ({ ...rest, bytes: [...(await blobToBytes(blob))] })),
    ),
  };
}

const photoPuts = () => gh.requests.filter((r) => r.method === 'PUT' && r.path.startsWith('photos/'));

describe('file names', () => {
  it('backupFileName round-trips and is Windows-safe', () => {
    const name = backupFileName('2026-11-09T12:34:56.789Z');
    expect(name).toBe('2026-11-09T12-34-56-789Z.enc');
    expect(name).not.toMatch(/[:<>"|?*\\]/);
    expect(backupTimeFromName(name)).toBe('2026-11-09T12:34:56.789Z');
    expect(backupTimeFromName('latest.enc')).toBeNull();
  });
});

describe('backupNow', () => {
  it('writes the documented layout, all encrypted', async () => {
    await seedData();
    const res = await backupNow(cfg, key);
    const deviceId = await getDeviceId();
    const p = devicePaths(deviceId);
    expect(res.deviceId).toBe(deviceId);
    expect(res.photosUploaded).toBe(2);
    expect(res.path).toMatch(new RegExp(`^devices/${deviceId}/backups/\\d{4}-\\d{2}-\\d{2}T[\\d-]+Z\\.enc$`));

    const all = gh.paths();
    expect(all).toContain(KEYCHECK_PATH);
    expect(all).toContain(res.path);
    expect(all).toContain(p.latest);
    expect(all).toContain(p.deviceInfo);
    expect(all.filter((x) => x.startsWith('photos/'))).toHaveLength(2);
    for (const x of all.filter((y) => y.startsWith('photos/'))) expect(x).toMatch(/^photos\/[0-9a-f]{64}\.enc$/);

    // latest.enc holds the same bundle as the new backup, but each file is bound to its own path (v2 AAD).
    const open = async (path: string) => decryptJson(key, bytesToEnvelope(gh.read(path)!), fileAad(path));
    const bundle = parseBundle(await open(res.path));
    expect(await open(p.latest)).toEqual(await open(res.path));
    expect(JSON.parse(gh.readText(p.latest)!)).toMatchObject({ v: 2 });
    await expect(decryptJson(key, bytesToEnvelope(gh.read(p.latest)!), fileAad(res.path))).rejects.toThrow();
    expect(bundle.recipes).toHaveLength(2);
    expect(bundle.photos.every((ph) => ph.data === undefined)).toBe(true);
    expect(await open(p.deviceInfo)).toEqual({
      name: 'Kitchen tablet',
      lastBackupAt: bundle.createdAt,
    });

    expect(await getLastBackup()).toEqual({
      at: bundle.createdAt,
      path: res.path,
      photosUploaded: 2,
      photosSkipped: 0,
      size: res.size,
    });
  });

  it('never puts plaintext titles, ingredients, names or photo hashes in the repo', async () => {
    const { p1, p2 } = await seedData();
    await backupNow(cfg, key);
    await tick();
    await backupNow(cfg, key);
    const deviceId = await getDeviceId();
    const needles = [...SECRET_WORDS, p1.hash, p2.hash, TOKEN, PASS];
    for (const path of gh.paths()) {
      const bytes = gh.read(path)!;
      const text = new TextDecoder().decode(bytes);
      const latin = String.fromCharCode(...bytes);
      for (const n of needles) {
        expect(text.includes(n) || latin.includes(n), `${n} found in ${path}`).toBe(false);
        expect(path.includes(n), `${n} in path ${path}`).toBe(false);
      }
      if (path !== KEYCHECK_PATH) expect(() => bytesToEnvelope(bytes)).not.toThrow();
      // Photo bytes themselves must not appear either.
      expect(latin.includes(String.fromCharCode(...(await blobToBytes(p1.blob))))).toBe(false);
    }
    // Only the device folder name (a random UUID) is visible.
    expect(gh.paths().filter((x) => x.startsWith('devices/')).every((x) => x.startsWith(`devices/${deviceId}/`))).toBe(true);
  });

  it('second backup uploads no duplicate photos but a new backup file', async () => {
    await seedData();
    const first = await backupNow(cfg, key);
    expect(photoPuts()).toHaveLength(2);
    gh.requests.length = 0;
    await tick();
    const second = await backupNow(cfg, key);
    expect(photoPuts()).toHaveLength(0);
    expect(second.photosUploaded).toBe(0);
    expect(second.photosSkipped).toBe(2);
    expect(second.path).not.toBe(first.path);
    const deviceId = await getDeviceId();
    expect(gh.paths().filter((x) => x.startsWith(`devices/${deviceId}/backups/`))).toHaveLength(2);
    const latestPath = devicePaths(deviceId).latest;
    expect(await decryptJson(key, bytesToEnvelope(gh.read(latestPath)!), fileAad(latestPath))).toEqual(
      await decryptJson(key, bytesToEnvelope(gh.read(second.path)!), fileAad(second.path)),
    );

    // A new photo is the only one uploaded next time.
    await photos.put(await makePhoto(3));
    gh.requests.length = 0;
    await tick();
    const third = await backupNow(cfg, key);
    expect(photoPuts()).toHaveLength(1);
    expect(third.photosUploaded).toBe(1);
  });

  it('treats an already-existing photo (listing capped) as skipped', async () => {
    await seedData();
    await backupNow(cfg, key);
    // Simulate a capped/incomplete listing: the photos dir listing fails to show existing files.
    gh.injectError({ kind: 'not-found', method: 'GET', pathIncludes: 'photos', times: 1 });
    await tick();
    const res = await backupNow(cfg, key);
    expect(res.photosUploaded).toBe(0);
    expect(res.photosSkipped).toBe(2);
  });

  it('reports progress', async () => {
    await seedData();
    const phases: string[] = [];
    await backupNow(cfg, key, {
      onProgress: (p) => phases.push(p.phase === 'photos' ? `photos ${p.done}/${p.total}` : p.phase),
    });
    expect(phases).toEqual(['prepare', 'photos 0/2', 'photos 1/2', 'photos 2/2', 'upload', 'finish', 'prune']);
  });

  it('rejects a key that does not match keycheck.json and uploads nothing', async () => {
    await seedData();
    const { key: other } = await createKeyCheck('another passphrase', { iterations: 1000 });
    await expect(backupNow(cfg, other)).rejects.toMatchObject({ kind: 'wrong-key' });
    expect(gh.paths()).toEqual([KEYCHECK_PATH]);
    expect(await getLastBackup()).toBeNull();
  });

  it('reports a missing keycheck.json', async () => {
    gh.remove(KEYCHECK_PATH);
    await expect(backupNow(cfg, key)).rejects.toMatchObject({ kind: 'no-keycheck' });
  });

  const kinds: Array<[MockErrorKind, string]> = [
    ['token-expired', 'token-expired'],
    ['unauthorized', 'unauthorized'],
    ['forbidden', 'forbidden'],
    ['rate-limited', 'rate-limited'],
    ['network', 'network'],
    ['server', 'unknown'],
  ];
  it.each(kinds)('%s during backup → BackupError(%s), local data untouched', async (inject, kind) => {
    await seedData();
    const before = await snapshot();
    gh.injectError({ kind: inject, method: 'PUT', pathIncludes: 'backups/', times: Infinity });
    const err = await backupNow(cfg, key).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackupError);
    expect((err as BackupError).kind).toBe(kind);
    expect(await snapshot()).toEqual(before);
    expect(await getLastBackup()).toBeNull();
  });

  it('error messages never contain the token', async () => {
    await seedData();
    gh.setToken('test-token-other');
    const err = (await backupNow(cfg, key).catch((e: unknown) => e)) as BackupError;
    expect(err.kind).toBe('unauthorized');
    expect(err.message).not.toContain(TOKEN);
  });
});

describe('restore', () => {
  it('backup → wipe local DB → restore (replace) → deep-equal', async () => {
    await seedData();
    const before = await snapshot();
    const { path } = await backupNow(cfg, key);

    await resetDb();
    expect((await snapshot()).recipes).toHaveLength(0);

    const phases: string[] = [];
    const report = await restoreBackup(cfg, key, path, 'replace', {
      onProgress: (p) => phases.push(p.phase === 'photos' ? `photos ${p.done}/${p.total}` : p.phase),
    });
    expect(report.photos.missing).toEqual([]);
    expect(report.photos.invalid).toEqual([]);
    expect(report.recipes.added).toBe(2);
    expect(await snapshot()).toEqual(before);
    expect(phases).toEqual(['download', 'photos 0/2', 'photos 1/2', 'photos 2/2', 'import']);
  });

  it('restores another device backup with merge-add-missing without overwriting', async () => {
    await seedData();
    const { path } = await backupNow(cfg, key);
    const fromBackup = await snapshot();

    // "New device": empty DB, a different device ID, one local recipe of its own.
    await resetDb();
    const local = await recipes.save({ title: 'Local only', tagIds: [], ingredients: [], steps: [], photoHashes: [] });
    const report = await restoreBackup(cfg, key, path, 'merge-add-missing');
    expect(report.recipes.added).toBe(2);
    const after = await snapshot();
    expect(after.recipes.map((r) => r.id).sort()).toEqual([...fromBackup.recipes.map((r) => r.id), local.id].sort());
    expect(after.photos).toEqual(fromBackup.photos);
  });

  it('does not re-download photos that are already stored', async () => {
    await seedData();
    const { path } = await backupNow(cfg, key);
    gh.requests.length = 0;
    await restoreBackup(cfg, key, path, 'merge-add-missing');
    expect(gh.requests.filter((r) => r.method === 'GET' && r.path.startsWith('photos/'))).toHaveLength(0);
  });

  it('reports photos missing from the repo but still restores the rest', async () => {
    await seedData();
    const { path } = await backupNow(cfg, key);
    const photoFile = gh.paths().find((x) => x.startsWith('photos/'))!;
    gh.remove(photoFile);
    await resetDb();
    const report = await restoreBackup(cfg, key, path, 'replace');
    expect(report.photos.missing).toHaveLength(1);
    expect(await recipes.list()).toHaveLength(1);
  });

  const restoreFailures: Array<[string, MockErrorKind, string, string]> = [
    ['bundle download', 'token-expired', 'backups/', 'token-expired'],
    ['bundle download', 'unauthorized', 'backups/', 'unauthorized'],
    ['bundle download', 'forbidden', 'backups/', 'forbidden'],
    ['bundle download', 'rate-limited', 'backups/', 'rate-limited'],
    ['bundle download', 'network', 'backups/', 'network'],
    ['bundle download', 'server', 'backups/', 'unknown'],
    ['photo fetch', 'token-expired', 'photos/', 'token-expired'],
    ['photo fetch', 'rate-limited', 'photos/', 'rate-limited'],
    ['photo fetch', 'network', 'photos/', 'network'],
    ['photo fetch', 'server', 'photos/', 'unknown'],
  ];
  it.each(restoreFailures)('%s fails with %s → BackupError, local data untouched', async (_s, inject, where, kind) => {
    await seedData();
    const { path } = await backupNow(cfg, key);
    // Local state differs from the backup so an accidental write would be visible.
    await resetDb();
    await recipes.save({ title: 'Keep me', tagIds: [], ingredients: [], steps: [], photoHashes: [] });
    const before = await snapshot();
    const kvBefore = await db.kv.toArray();

    gh.injectError({ kind: inject, method: 'GET', pathIncludes: where, times: Infinity });
    for (const mode of ['replace', 'merge-add-missing'] as const) {
      const err = await restoreBackup(cfg, key, path, mode).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BackupError);
      expect((err as BackupError).kind).toBe(kind);
      expect(await snapshot()).toEqual(before);
      expect(await db.kv.toArray()).toEqual(kvBefore); // no safety export written either
    }
  });

  it('wrong passphrase (different key) → wrong-key, local data untouched', async () => {
    await seedData();
    const { path } = await backupNow(cfg, key);
    await resetDb();
    await recipes.save({ title: 'Keep me', tagIds: [], ingredients: [], steps: [], photoHashes: [] });
    const before = await snapshot();
    const { key: other } = await createKeyCheck('not the passphrase', { iterations: 1000 });
    await expect(restoreBackup(cfg, other, path, 'replace')).rejects.toMatchObject({ kind: 'wrong-key' });
    expect(await snapshot()).toEqual(before);
  });

  it('corrupt or missing backup file → corrupt / missing, local data untouched', async () => {
    await seedData();
    const { path } = await backupNow(cfg, key);
    const before = await snapshot();
    await gh.seed(path, 'not an envelope');
    await expect(restoreBackup(cfg, key, path, 'replace')).rejects.toMatchObject({ kind: 'corrupt' });
    gh.remove(path);
    await expect(restoreBackup(cfg, key, path, 'replace')).rejects.toMatchObject({ kind: 'missing' });
    expect(await snapshot()).toEqual(before);
  });

  it('an encrypted non-bundle is reported as corrupt', async () => {
    await seedData();
    const { path } = await backupNow(cfg, key);
    const { encryptJson } = await import('../crypto');
    await gh.seed(path, JSON.stringify(await encryptJson(key, { format: 'something-else' })));
    await expect(downloadBackup(cfg, key, path)).rejects.toMatchObject({ kind: 'corrupt' });
  });
});

describe('listRemoteBackups', () => {
  it('lists devices with decrypted names, this device first, newest backup first', async () => {
    // Device A
    await seedData();
    await settings.set('deviceName', 'Phone A');
    const a1 = await backupNow(cfg, key);
    await tick();
    const a2 = await backupNow(cfg, key);
    const deviceA = await getDeviceId();
    // Device B (fresh DB = new device ID)
    await resetDb();
    await settings.set('deviceName', 'Laptop B');
    await tick();
    await backupNow(cfg, key);
    const deviceB = await getDeviceId();
    expect(deviceB).not.toBe(deviceA);

    const list = await listRemoteBackups(cfg, key);
    expect(list.map((d) => d.deviceId)).toEqual([deviceB, deviceA]);
    expect(list[0]).toMatchObject({ name: 'Laptop B', isThisDevice: true, unreadable: false });
    expect(list[1]).toMatchObject({ name: 'Phone A', isThisDevice: false, lastBackupAt: a2.at });
    expect(list[1]!.backups.map((b) => b.path)).toEqual([a2.path, a1.path]);
    expect(list[1]!.backups[0]!.createdAt).toBe(a2.at);
    expect(list[1]!.totalSize).toBe(a1.size + a2.size);
  });

  it('marks device info it cannot decrypt and ignores junk folders', async () => {
    await seedData();
    await backupNow(cfg, key);
    await gh.seed('devices/../evil/x.enc', 'x');
    await gh.seed('devices/not a device/backups/x.enc', 'x');
    const { key: other } = await createKeyCheck('other', { iterations: 1000 });
    const list = await listRemoteBackups(cfg, other);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ unreadable: true });
    expect(list[0]!.name).toBeUndefined();
  });

  it('returns [] for an empty repo and maps GitHub errors', async () => {
    expect(await listRemoteBackups(cfg, key)).toEqual([]);
    gh.injectError({ kind: 'rate-limited', times: 1 });
    await expect(listRemoteBackups(cfg, key)).rejects.toMatchObject({ kind: 'rate-limited' });
  });
});

describe('selectBackupsToPrune', () => {
  const mk = (iso: string): RemoteBackup => ({
    path: `devices/d/backups/${backupFileName(iso)}`,
    name: backupFileName(iso),
    createdAt: iso,
    size: 1,
  });
  const list = [
    mk('2026-01-01T10:00:00.000Z'),
    mk('2026-01-01T12:00:00.000Z'),
    mk('2026-01-02T10:00:00.000Z'),
    mk('2026-01-03T10:00:00.000Z'),
    mk('2026-01-03T11:00:00.000Z'),
  ];

  it('keeps the newest N, oldest-first result', () => {
    expect(selectBackupsToPrune(list, { keepLast: 2 })).toEqual([list[0]!.path, list[1]!.path, list[2]!.path]);
  });
  it('never deletes the newest backup even with keepLast 0', () => {
    expect(selectBackupsToPrune(list, { keepLast: 0 })).not.toContain(list[4]!.path);
  });
  it('keeps one per day for keepDaily days', () => {
    expect(selectBackupsToPrune(list, { keepLast: 1, keepDaily: 3 })).toEqual([list[0]!.path, list[3]!.path]);
  });
  it('ignores files with unknown names', () => {
    const odd: RemoteBackup = { path: 'devices/d/backups/odd.enc', name: 'odd.enc', createdAt: null, size: 1 };
    expect(selectBackupsToPrune([...list, odd], { keepLast: 1 })).not.toContain(odd.path);
  });
});
