// @vitest-environment node
// Integration tests: several simulated devices sharing one mocked GitHub data repo (T43).
// Each "device" is a full copy of the IndexedDB tables, swapped in and out of the shared Dexie instance.
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, getDeviceId, photos, recipes, resetDb, settings } from '../../db';
import type { Photo, Recipe } from '../../domain/types';
import { createMockGitHub } from '../../../test/mocks/github';
import { sha256Hex } from '../backup/bytes';
import { BackupError, KEYCHECK_PATH, devicePaths, envelopeToBytes } from '../backup/github-backup';
import { buildBundle } from '../backup/build';
import { createKeyCheck, encryptJson, photoFileName, type KeyCheck } from '../crypto';
import type { GitHubConfig } from '../github';
import { syncWithGitHub, type SyncResult } from './github';
import { listConflicts, resolveConflict } from './store';

const TOKEN = 'test-token-t43-sync';
const gh = createMockGitHub({ token: TOKEN, owner: 'octo', repo: 'data' });
const server = setupServer(...gh.handlers);
const cfg: GitHubConfig = { owner: 'octo', repo: 'data', branch: 'main', token: TOKEN };

let key: CryptoKey;
let keyCheck: KeyCheck;
let otherKey: CryptoKey;

beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  ({ key, keyCheck } = await createKeyCheck('family passphrase', { iterations: 1000 }));
  ({ key: otherKey } = await createKeyCheck('another passphrase', { iterations: 1000 }));
});
afterAll(() => server.close());

// ---- device simulation ------------------------------------------------------------------------

const TABLES = ['recipes', 'categories', 'tags', 'photos', 'settings', 'kv', 'syncBase', 'syncConflicts'] as const;
type Dump = Record<(typeof TABLES)[number], unknown[]>;
const devices = new Map<string, Dump>();
let current: string | null = null;

async function dumpAll(): Promise<Dump> {
  const out = {} as Dump;
  for (const t of TABLES) out[t] = await db.table(t).toArray();
  return out;
}

/** Switch the shared DB to device `name` (created empty, with that device name, on first use). */
async function as(name: string): Promise<void> {
  if (current === name) return;
  if (current) devices.set(current, await dumpAll());
  await resetDb();
  const saved = devices.get(name);
  if (saved) {
    for (const t of TABLES) await db.table(t).bulkPut(saved[t]);
  } else {
    await settings.set('deviceName', name);
    await getDeviceId();
  }
  current = name;
}

async function sync(name: string): Promise<SyncResult> {
  await as(name);
  return syncWithGitHub(cfg, key);
}

const newRecipe = (title: string, extra: Partial<Recipe> = {}) =>
  recipes.save({ title, tagIds: [], ingredients: [], steps: [], photoHashes: [], ...extra });

async function liveRecipes() {
  return (await recipes.list()).map((r) => ({ id: r.id, title: r.title, notes: r.notes, photoHashes: r.photoHashes }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

async function makePhoto(seed: number): Promise<Photo> {
  const bytes = new Uint8Array(64).map((_, i) => (seed * 31 + i * 7) % 256);
  return {
    hash: await sha256Hex(bytes),
    mime: 'image/jpeg',
    width: 10,
    height: 10,
    size: bytes.length,
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    createdAt: '2026-01-02T03:04:05.000Z',
  };
}

beforeEach(async () => {
  gh.reset();
  gh.setToken(TOKEN);
  devices.clear();
  current = null;
  await resetDb();
  await gh.seed(KEYCHECK_PATH, JSON.stringify(keyCheck));
});

// ---- tests ------------------------------------------------------------------------------------

describe('syncWithGitHub', () => {
  it('first device: no peers, still backs up', async () => {
    await as('A');
    await newRecipe('Bigos');
    const res = await syncWithGitHub(cfg, key);
    expect(res.peers).toEqual([]);
    expect(res.backup).toBeDefined();
    expect(gh.paths()).toContain(devicePaths(await getDeviceId()).latest);
  });

  it('two devices: create on A → sync B → edit on B → sync A', async () => {
    await as('A');
    const r = await newRecipe('Bigos');
    await sync('A');

    const b1 = await sync('B');
    expect(b1.peers).toHaveLength(1);
    expect(b1.peers[0]).toMatchObject({ name: 'A', status: 'synced', added: 1, conflicts: 0 });
    expect((await liveRecipes()).map((x) => x.title)).toEqual(['Bigos']);
    expect((await sync('A')).peers[0]).toMatchObject({ name: 'B', added: 0, updated: 0, conflicts: 0 });

    await as('B');
    const got = await recipes.get(r.id);
    await recipes.save({ ...got!, notes: 'more cabbage' });
    await sync('B');

    const a2 = await sync('A');
    expect(a2.peers[0]).toMatchObject({ name: 'B', updated: 1, added: 0, conflicts: 0 });
    expect((await recipes.get(r.id))?.notes).toBe('more cabbage');

    // Repeated sync is a no-op for the data.
    const a3 = await sync('A');
    expect(a3.peers[0]).toMatchObject({ added: 0, updated: 0, conflicts: 0 });
  });

  it.each(['theirs', 'mine'] as const)('same field edited on both → conflict → resolve %s → converge', async (choice) => {
    await as('A');
    const r = await newRecipe('Pierogi');
    await sync('A');
    await sync('B');
    await sync('A'); // A now has a base for B

    await as('B');
    await recipes.save({ ...(await recipes.get(r.id))!, title: 'Pierogi B' });
    await as('A');
    await recipes.save({ ...(await recipes.get(r.id))!, title: 'Pierogi A' });
    const a = await sync('A'); // B's latest is still the original → only local changed
    expect(a.peers[0]?.conflicts).toBe(0);

    const b = await sync('B');
    expect(b.peers[0]?.conflicts).toBe(1);
    expect((await recipes.get(r.id))?.title).toBe('Pierogi B'); // local stays active
    const [c] = await listConflicts();
    expect(c).toMatchObject({ entity: 'recipes', recordId: r.id, peerName: 'A' });

    await resolveConflict(c!.id, choice);
    await sync('B');
    const a2 = await sync('A');
    if (choice === 'theirs') {
      // B took A's version: same content on both → no new conflict.
      expect(a2.peers[0]).toMatchObject({ conflicts: 0 });
    } else {
      // B kept its own: A still has its edit since the base → A's human is asked too (T40 rule).
      expect(a2.peers[0]).toMatchObject({ conflicts: 1 });
      const [ca] = await listConflicts();
      await resolveConflict(ca!.id, 'theirs');
      await sync('A');
    }
    const want = choice === 'theirs' ? 'Pierogi A' : 'Pierogi B';
    expect((await recipes.get(r.id))?.title).toBe(want);
    expect(await listConflicts()).toEqual([]);
    await sync('B');
    expect(await listConflicts()).toEqual([]);
    expect((await recipes.get(r.id))?.title).toBe(want);
    expect((await sync('A')).peers[0]).toMatchObject({ added: 0, updated: 0, conflicts: 0 });
  });

  it('first sync between two devices that already differ raises a conflict (contract rule)', async () => {
    await as('A');
    const r = await newRecipe('Zupa');
    await sync('A');
    await sync('B');
    await recipes.save({ ...(await recipes.get(r.id))!, notes: 'B note' });
    await sync('B');
    const a = await sync('A'); // A never saw B before → no base → conflict, A's version stays
    expect(a.peers[0]?.conflicts).toBe(1);
    expect((await recipes.get(r.id))?.notes).toBeUndefined();
    const [c] = await listConflicts();
    await resolveConflict(c!.id, 'theirs');
    expect((await recipes.get(r.id))?.notes).toBe('B note');
  });

  it('three devices converge without conflicts', async () => {
    for (const name of ['A', 'B', 'C']) {
      await as(name);
      await newRecipe(`Recipe of ${name}`);
      await sync(name);
    }
    for (const name of ['A', 'B', 'C', 'A']) await sync(name);
    expect(gh.deviceIds()).toHaveLength(3);
    const states = [];
    for (const name of ['A', 'B', 'C']) {
      await as(name);
      states.push(await liveRecipes());
      expect(await listConflicts()).toEqual([]);
    }
    expect(states[0]?.map((s) => s.title)).toEqual(['Recipe of A', 'Recipe of B', 'Recipe of C']);
    expect(states[1]).toEqual(states[0]);
    expect(states[2]).toEqual(states[0]);
  });

  it('downloads missing photos once and stores them verified', async () => {
    await as('A');
    const p = await makePhoto(1);
    await photos.put(p);
    await newRecipe('With photo', { photoHashes: [p.hash] });
    await sync('A');

    const b = await sync('B');
    expect(b.photosDownloaded).toBe(1);
    expect(b.photosMissing).toBe(0);
    const stored = await photos.get(p.hash);
    expect(stored?.size).toBe(64);
    expect(await sha256Hex(new Uint8Array(await stored!.blob.arrayBuffer()))).toBe(p.hash);

    const again = await sync('B');
    expect(again.photosDownloaded).toBe(0);
  });

  it('a photo missing in the repo is reported, the recipe still syncs', async () => {
    await as('A');
    const p = await makePhoto(2);
    await photos.put(p);
    await newRecipe('Lost photo', { photoHashes: [p.hash] });
    await sync('A');
    gh.remove(`photos/${await photoFileName(key, p.hash)}`);

    const b = await sync('B');
    expect(b.photosMissing).toBe(1);
    expect((await liveRecipes()).map((x) => x.title)).toEqual(['Lost photo']);
  });

  it('skips a peer encrypted with another key and a peer without latest.enc', async () => {
    await as('A');
    await newRecipe('Real');
    await sync('A');

    // A foreign device folder whose data was written with a different passphrase.
    await as('Foreign');
    await newRecipe('Unreadable');
    const bundle = await buildBundle({ includePhotoData: false });
    const foreign = await getDeviceId();
    await gh.seed(devicePaths(foreign).latest, envelopeToBytes(await encryptJson(otherKey, bundle)));
    // A device that only ever wrote device.json.enc.
    await gh.seed(devicePaths('empty-device').deviceInfo, envelopeToBytes(await encryptJson(key, { name: 'Empty' })));

    const b = await sync('B');
    const byName = new Map(b.peers.map((p) => [p.peerId, p]));
    expect(byName.get(foreign)?.status).toBe('unreadable');
    expect(byName.get('empty-device')).toMatchObject({ status: 'no-latest', name: 'Empty' });
    expect(b.peers.find((p) => p.name === 'A')?.status).toBe('synced');
    expect((await liveRecipes()).map((x) => x.title)).toEqual(['Real']);
  });

  it('a damaged latest.enc is reported as corrupt', async () => {
    await gh.seed(devicePaths('broken').latest, 'not json');
    const b = await sync('B');
    expect(b.peers[0]).toMatchObject({ peerId: 'broken', status: 'corrupt' });
  });

  it('writes v2 envelopes bound to their path: a backup copied over latest.enc no longer opens', async () => {
    await as('A');
    await newRecipe('Old');
    await sync('A');
    const aId = await getDeviceId();
    const oldBackup = gh.paths().find((p) => p.startsWith(`${devicePaths(aId).backupsDir}/`))!;
    expect(JSON.parse(gh.readText(devicePaths(aId).latest)!)).toMatchObject({ v: 2 });

    await gh.seed(devicePaths(aId).latest, gh.read(oldBackup)!);
    const b = await sync('B');
    expect(b.peers.find((p) => p.peerId === aId)?.status).toBe('unreadable');
    expect(await liveRecipes()).toEqual([]);
  });

  it("skips a latest.enc that carries another device's bundle", async () => {
    await as('A');
    await newRecipe('From A');
    await sync('A');
    const aId = await getDeviceId();
    // Legacy v1 file (no path binding) of A's data, planted in another device's folder.
    const bundle = await buildBundle({ includePhotoData: false });
    await gh.seed(devicePaths('planted').latest, envelopeToBytes(await encryptJson(key, bundle)));

    const b = await sync('B');
    expect(b.peers.find((p) => p.peerId === 'planted')?.status).toBe('corrupt');
    expect(b.peers.find((p) => p.peerId === aId)?.status).toBe('synced');
  });

  it('refuses a peer bundle older than one already merged (rollback), accepts newer ones', async () => {
    await as('A');
    const r = await newRecipe('Soup', { notes: 'v1' });
    const aId = await getDeviceId();
    // An old-format (v1) snapshot an attacker could have kept.
    const oldBundle = await buildBundle({ includePhotoData: false });
    await sync('A');
    await sync('B');

    await as('A');
    await recipes.save({ ...(await recipes.get(r.id))!, notes: 'v2' });
    await sync('A');
    await sync('B');
    expect((await liveRecipes())[0]?.notes).toBe('v2');

    await gh.seed(devicePaths(aId).latest, envelopeToBytes(await encryptJson(key, oldBundle)));
    const b = await sync('B');
    expect(b.peers.find((p) => p.peerId === aId)?.status).toBe('stale');
    expect((await liveRecipes())[0]?.notes).toBe('v2');

    await sync('A'); // A's real, newer backup replaces the old copy
    expect((await sync('B')).peers.find((p) => p.peerId === aId)?.status).toBe('synced');
  });

  it('network failure while reading → throws, nothing changed locally, no backup', async () => {
    await as('A');
    await newRecipe('From A');
    await sync('A');
    await as('B');
    await newRecipe('Only B');
    const before = await dumpAll();
    const pathsBefore = gh.paths();
    gh.injectError({ kind: 'network', method: 'GET', pathIncludes: 'latest.enc', times: 10 });

    await expect(syncWithGitHub(cfg, key)).rejects.toMatchObject({ kind: 'network' });
    expect(await dumpAll()).toEqual(before);
    expect(gh.paths()).toEqual(pathsBefore);
  });

  it('wrong key for the repo → wrong-key, nothing changed', async () => {
    await as('B');
    const before = await dumpAll();
    const err = await syncWithGitHub(cfg, otherKey).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackupError);
    expect((err as BackupError).kind).toBe('wrong-key');
    expect(await dumpAll()).toEqual(before);
  });

  it('backup failure after the merge keeps the merge and reports backupError', async () => {
    await as('A');
    await newRecipe('From A');
    await sync('A');
    await as('B');
    gh.injectError({ kind: 'forbidden', method: 'PUT', times: 10 });
    const b = await syncWithGitHub(cfg, key);
    expect(b.backupError).toBe('forbidden');
    expect(b.backup).toBeUndefined();
    expect((await liveRecipes()).map((x) => x.title)).toEqual(['From A']);
  });

  it('never puts the token or plaintext into the repo', async () => {
    await as('A');
    await newRecipe('Secret-żurek');
    await sync('A');
    await sync('B');
    for (const p of gh.paths()) {
      const text = gh.readText(p) ?? '';
      expect(text).not.toContain('Secret-żurek');
      expect(text).not.toContain(TOKEN);
    }
  });
});
