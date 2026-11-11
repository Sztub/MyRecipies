import Dexie from 'dexie';
import {
  db,
  resetDb,
  RecipesDb,
  type KvRow,
  type SyncBaseRow,
  type SyncConflictRow,
} from '../../db/db';
import { getDeviceId } from '../../db/device';
import { categories, recipes, tags } from '../../db/repositories';
import type { Category, Draft, Recipe, Tag } from '../../domain/types';
import { mergeSnapshot, type Snapshot } from './merge';
import {
  applyMerge,
  ConflictNotFoundError,
  conflictId,
  listConflicts,
  loadBase,
  loadLocalSnapshot,
  resolveConflict,
  syncPeer,
} from './store';

function draft(over: Partial<Draft<Recipe>> = {}): Draft<Recipe> {
  return {
    title: 'Pierogi',
    tagIds: [],
    ingredients: [{ id: 'i1', name: 'flour', amount: 500, unit: 'g' }],
    steps: [{ id: 's1', text: 'Mix.' }],
    photoHashes: [],
    ...over,
  };
}

// ---- multi-device simulation on the one shared Dexie instance --------------------------------

interface DeviceState {
  recipes: Recipe[];
  categories: Category[];
  tags: Tag[];
  syncBase: SyncBaseRow[];
  syncConflicts: SyncConflictRow[];
  kv: KvRow[];
}

const devices = new Map<string, DeviceState>();
/** What each device last wrote to `devices/<id>/latest.enc`. */
const published = new Map<string, Snapshot>();
let current: string | undefined;

async function dump(): Promise<DeviceState> {
  return {
    recipes: await db.recipes.toArray(),
    categories: await db.categories.toArray(),
    tags: await db.tags.toArray(),
    syncBase: await db.syncBase.toArray(),
    syncConflicts: await db.syncConflicts.toArray(),
    kv: await db.kv.toArray(),
  };
}

/** Switch the shared DB to device `name` (fresh device on first use; its deviceId = name). */
async function as(name: string): Promise<void> {
  if (current) devices.set(current, await dump());
  await resetDb();
  const s = devices.get(name);
  if (s) {
    await db.recipes.bulkPut(s.recipes);
    await db.categories.bulkPut(s.categories);
    await db.tags.bulkPut(s.tags);
    await db.syncBase.bulkPut(s.syncBase);
    await db.syncConflicts.bulkPut(s.syncConflicts);
    await db.kv.bulkPut(s.kv);
  } else {
    await db.kv.put({ key: 'deviceId', value: name });
  }
  current = name;
}

/** The current device makes its normal backup. */
async function backup(): Promise<void> {
  published.set(await getDeviceId(), await loadLocalSnapshot());
}

/** The current device syncs with every other published device, then backs up the merged state. */
async function syncAll(): Promise<void> {
  const me = await getDeviceId();
  for (const [peer, snapshot] of published) {
    if (peer !== me) await syncPeer(peer, `Phone ${peer}`, snapshot);
  }
  await backup();
}

function content(s: Snapshot): unknown {
  const strip = (list: { id: string }[]) =>
    [...list]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { rev, deviceId, updatedAt, ...rest } = r as Recipe;
        return rest;
      });
  return { recipes: strip(s.recipes), categories: strip(s.categories), tags: strip(s.tags) };
}

beforeEach(async () => {
  devices.clear();
  published.clear();
  current = undefined;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));
  await resetDb();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Base rows come back in key (UUID) order – compare snapshots order-independently. */
function byId(s: Snapshot): Snapshot {
  const sort = <T extends { id: string }>(xs: T[]): T[] => [...xs].sort((a, b) => a.id.localeCompare(b.id));
  return { recipes: sort(s.recipes), categories: sort(s.categories), tags: sort(s.tags) };
}

// ---- tests ------------------------------------------------------------------------------------

describe('applyMerge', () => {
  it('writes changes, stamps combined records, stores base and conflicts in one go', async () => {
    await as('A');
    const r1 = await recipes.save(draft({ title: 'One' }));
    const r2 = await recipes.save(draft({ title: 'Two' }));
    const base: Snapshot = { recipes: [r1, r2], categories: [], tags: [] };
    // Pretend we already synced with B once.
    await applyMerge('B', 'Phone B', base, mergeSnapshot(await loadLocalSnapshot(), base, base));

    const l1 = await recipes.save({ ...r1, title: 'One (A)' });
    const l2 = await recipes.save({ ...r2, title: 'Two (A)' });
    const remote: Snapshot = {
      recipes: [
        { ...r1, servings: 4, rev: 2, deviceId: 'B' },
        { ...r2, title: 'Two (B)', rev: 2, deviceId: 'B' },
      ],
      categories: [],
      tags: [],
    };
    vi.setSystemTime(new Date('2026-01-05T10:00:00.000Z'));
    const result = mergeSnapshot(await loadLocalSnapshot(), remote, await loadBase('B'));
    await applyMerge('B', 'Phone B', remote, result);

    expect(await recipes.get(r1.id)).toEqual({
      ...l1,
      servings: 4,
      rev: 3,
      deviceId: 'A',
      updatedAt: '2026-01-05T10:00:00.000Z',
    });
    expect(await recipes.get(r2.id)).toEqual(l2); // conflict → local stays active
    expect(byId(await loadBase('B'))).toEqual(byId(remote));
    const conflicts = await listConflicts();
    expect(conflicts).toEqual([
      {
        id: conflictId('B', 'recipes', r2.id),
        entity: 'recipes',
        recordId: r2.id,
        peerId: 'B',
        peerName: 'Phone B',
        local: l2,
        remote: remote.recipes[1],
        createdAt: '2026-01-05T10:00:00.000Z',
      },
    ]);
  });

  it('rolls back everything if a write fails', async () => {
    await as('A');
    const remote: Snapshot = {
      recipes: [{ ...(await recipes.save(draft())), id: 'new', title: 'x' }],
      categories: [],
      tags: [],
    };
    const result = mergeSnapshot(await loadLocalSnapshot(), remote, {
      recipes: [],
      categories: [],
      tags: [],
    });
    const spy = vi.spyOn(db.syncConflicts, 'bulkPut').mockRejectedValueOnce(new Error('boom'));
    await expect(applyMerge('B', 'B', remote, result)).rejects.toThrow('boom');
    spy.mockRestore();
    expect(await recipes.get('new')).toBeUndefined();
    expect(await db.syncBase.count()).toBe(0);
  });

  it('base is kept per peer', async () => {
    await as('A');
    const r = await recipes.save(draft());
    await syncPeer('B', 'B', { recipes: [{ ...r, title: 'B' }], categories: [], tags: [] });
    await syncPeer('C', 'C', { recipes: [], categories: [], tags: [] });
    expect((await loadBase('B')).recipes.map((x) => x.title)).toEqual(['B']);
    expect((await loadBase('C')).recipes).toEqual([]);
  });
});

describe('two devices', () => {
  it('first sync: records only on one side are added; differing records conflict', async () => {
    await as('A');
    const shared = await recipes.save(draft({ title: 'Shared' }));
    await recipes.save(draft({ title: 'Only A' }));
    await backup();
    const aState = await dump();

    await as('B');
    // B was set up separately and happens to hold the same record id with other content.
    await recipes.putRaw([{ ...shared, title: 'Shared (B)', deviceId: 'B' }]);
    await recipes.save(draft({ title: 'Only B' }));
    await syncAll();

    expect((await recipes.list()).map((r) => r.title).sort()).toEqual([
      'Only A',
      'Only B',
      'Shared (B)',
    ]);
    expect((await listConflicts()).map((c) => [c.recordId, c.peerId])).toEqual([[shared.id, 'A']]);
    expect(aState.recipes).toHaveLength(2);
  });

  it('field-level combine, then repeated sync is a no-op on both sides', async () => {
    await as('A');
    const r = await recipes.save(draft());
    await backup();
    await as('B');
    await syncAll();
    await as('A');
    await syncAll();

    await recipes.save({ ...r, title: 'Pierogi ruskie' });
    await backup();
    await as('B');
    await recipes.save({ ...(await recipes.get(r.id))!, servings: 6 });
    await syncAll();
    await as('A');
    await syncAll();

    const merged = (await recipes.get(r.id))!;
    expect(merged).toMatchObject({ title: 'Pierogi ruskie', servings: 6 });
    expect(await listConflicts()).toEqual([]);

    // Further syncs change nothing.
    const before = await dump();
    await syncAll();
    await as('B');
    await syncAll();
    const bAfterFirst = await dump();
    await syncAll();
    expect(await dump()).toEqual(bAfterFirst);
    await as('A');
    await syncAll();
    expect((await dump()).recipes).toEqual(before.recipes);
    expect(content(published.get('A')!)).toEqual(content(published.get('B')!));
  });

  it('same-field conflict: local stays active, resolve "theirs" converges and clears the peer conflict', async () => {
    await as('A');
    const r = await recipes.save(draft());
    await backup();
    await as('B');
    await syncAll();
    await recipes.save({ ...(await recipes.get(r.id))!, title: 'B title' });
    await backup();

    await as('A');
    const mine = await recipes.save({ ...r, title: 'A title' });
    await syncAll();
    expect((await recipes.get(r.id))?.title).toBe('A title');
    const [conflict] = await listConflicts();
    expect(conflict).toMatchObject({ peerId: 'B', peerName: 'Phone B', local: mine });
    expect(conflict!.remote.deviceId).toBe('B');

    // Repeated sync while unresolved keeps exactly one conflict and does not touch local.
    await syncAll();
    expect(await listConflicts()).toHaveLength(1);
    expect((await recipes.get(r.id))?.title).toBe('A title');

    vi.setSystemTime(new Date('2026-01-09T10:00:00.000Z'));
    const resolved = await resolveConflict(conflict!.id, 'theirs');
    expect(resolved).toMatchObject({
      title: 'B title',
      rev: Math.max(mine.rev, conflict!.remote.rev) + 1,
      deviceId: 'A',
      updatedAt: '2026-01-09T10:00:00.000Z',
    });
    expect(await listConflicts()).toEqual([]);
    await syncAll();
    expect(await listConflicts()).toEqual([]);

    // B had its own copy of the conflict; once A agrees with B it disappears there too.
    await as('B');
    await syncAll();
    expect(await listConflicts()).toEqual([]);
    expect(content(published.get('A')!)).toEqual(content(published.get('B')!));
  });

  it('resolve "mine" keeps local and bumps rev; peer then gets it as a change', async () => {
    await as('A');
    const r = await recipes.save(draft());
    await backup();
    await as('B');
    await syncAll();
    await recipes.save({ ...(await recipes.get(r.id))!, title: 'B' });
    await backup();
    await as('A');
    await recipes.save({ ...r, title: 'A' });
    await syncAll();
    const [c] = await listConflicts();
    const kept = await resolveConflict(c!.id, 'mine');
    expect(kept).toMatchObject({ title: 'A', rev: 3 });
    await syncAll();
    expect(await listConflicts()).toEqual([]);

    await as('B');
    await syncAll();
    // B changed the title, A changed the title → B sees a conflict too (nothing silently lost) …
    const [cb] = await listConflicts();
    expect(cb).toMatchObject({ peerId: 'A', local: { title: 'B' }, remote: { title: 'A' } });
    // … and accepting A's version converges.
    await resolveConflict(cb!.id, 'theirs');
    await syncAll();
    await as('A');
    await syncAll();
    expect(await listConflicts()).toEqual([]);
    expect(content(published.get('A')!)).toEqual(content(published.get('B')!));
  });

  it('resolve with an edited record', async () => {
    await as('A');
    const r = await recipes.save(draft());
    await backup();
    await as('B');
    await syncAll();
    await recipes.save({ ...(await recipes.get(r.id))!, notes: 'from B' });
    await backup();
    await as('A');
    await recipes.save({ ...r, notes: 'from A' });
    await syncAll();
    const [c] = await listConflicts();
    const edited = { ...(c!.local as Recipe), notes: 'from A and B', rev: 999, deviceId: 'zzz' };
    const out = await resolveConflict(c!.id, edited);
    expect(out).toMatchObject({
      notes: 'from A and B',
      rev: 3,
      deviceId: 'A',
      id: r.id,
      createdAt: r.createdAt,
    });
    expect((await recipes.get(r.id))?.notes).toBe('from A and B');
  });

  it('resolveConflict throws for unknown ids', async () => {
    await expect(resolveConflict('nope', 'mine')).rejects.toBeInstanceOf(ConflictNotFoundError);
  });

  it('tombstones: delete propagates; delete vs edit conflicts; resolving "theirs" deletes', async () => {
    await as('A');
    const keep = await recipes.save(draft({ title: 'Keep' }));
    const gone = await recipes.save(draft({ title: 'Gone' }));
    const disputed = await recipes.save(draft({ title: 'Disputed' }));
    await backup();
    await as('B');
    await syncAll();
    await as('A');
    await syncAll();
    await as('B');
    await recipes.softDelete(gone.id);
    await recipes.softDelete(disputed.id);
    await backup();

    await as('A');
    await recipes.save({ ...disputed, title: 'Disputed (edited)' });
    await syncAll();
    expect((await recipes.list()).map((r) => r.title).sort()).toEqual([
      'Disputed (edited)',
      'Keep',
    ]);
    expect((await recipes.get(gone.id, { includeDeleted: true }))?.deleted).toBe(true);
    const [c] = await listConflicts();
    expect(c).toMatchObject({ recordId: disputed.id, remote: { deleted: true } });

    const out = await resolveConflict(c!.id, 'theirs');
    expect(out.deleted).toBe(true);
    expect((await recipes.list()).map((r) => r.id)).toEqual([keep.id]);
    await syncAll();
    await as('B');
    await syncAll();
    expect(await listConflicts()).toEqual([]);
    expect(content(published.get('A')!)).toEqual(content(published.get('B')!));
  });

  it('delete on both sides → deleted, no conflict', async () => {
    await as('A');
    const r = await recipes.save(draft());
    await backup();
    await as('B');
    await syncAll();
    await recipes.save({ ...(await recipes.get(r.id))!, title: 'edited then deleted' });
    await recipes.softDelete(r.id);
    await backup();
    await as('A');
    await recipes.softDelete(r.id);
    await syncAll();
    expect(await listConflicts()).toEqual([]);
    expect(await recipes.list()).toEqual([]);
  });

  it('categories and tags sync too', async () => {
    await as('A');
    const c = await categories.save({ name: 'Soups', order: 1 });
    const t = await tags.save({ name: 'vegan' });
    await backup();
    await as('B');
    await syncAll();
    expect(await categories.get(c.id)).toEqual(c);
    await as('A');
    await syncAll();
    await as('B');
    await categories.save({ ...c, order: 9 });
    await tags.softDelete(t.id);
    await backup();
    await as('A');
    await categories.save({ ...c, name: 'Zupy' });
    await syncAll();
    expect(await categories.get(c.id)).toMatchObject({ name: 'Zupy', order: 9 });
    expect(await tags.list()).toEqual([]);
  });
});

describe('three devices A ↔ B ↔ C', () => {
  it('converge after independent edits, with no conflicts', async () => {
    await as('A');
    const r = await recipes.save(draft());
    const cat = await categories.save({ name: 'Soups', order: 1 });
    await backup();
    for (const d of ['B', 'C', 'A', 'B', 'C']) {
      await as(d);
      await syncAll();
    }

    // Independent edits on all three devices.
    await as('A');
    await recipes.save({ ...(await recipes.get(r.id))!, title: 'Pierogi A' });
    await recipes.save(draft({ title: 'New on A' }));
    await backup();
    await as('B');
    await recipes.save({ ...(await recipes.get(r.id))!, servings: 3 });
    await categories.softDelete(cat.id);
    await backup();
    await as('C');
    await recipes.save({
      ...(await recipes.get(r.id))!,
      tagIds: [(await tags.save({ name: 'x' })).id],
    });
    await backup();

    // Gossip in a ring a few times.
    for (let round = 0; round < 3; round++) {
      for (const d of ['A', 'B', 'C']) {
        await as(d);
        await syncAll();
      }
    }

    const a = content(published.get('A')!);
    expect(content(published.get('B')!)).toEqual(a);
    expect(content(published.get('C')!)).toEqual(a);
    for (const d of ['A', 'B', 'C']) {
      await as(d);
      expect(await listConflicts()).toEqual([]);
    }
    const final = (await recipes.get(r.id))!;
    expect(final).toMatchObject({ title: 'Pierogi A', servings: 3 });
    expect(final.tagIds).toHaveLength(1);
    expect(await categories.list()).toEqual([]);
    expect((await recipes.list()).map((x) => x.title).sort()).toEqual(['New on A', 'Pierogi A']);

    // Stable: another full round writes nothing anywhere.
    const before = new Map<string, unknown>();
    for (const d of ['A', 'B', 'C']) {
      await as(d);
      before.set(d, (await dump()).recipes);
    }
    for (const d of ['A', 'B', 'C']) {
      await as(d);
      await syncAll();
      expect((await dump()).recipes).toEqual(before.get(d));
    }
  });

  it('a conflict between two devices reaches the third without being lost', async () => {
    await as('A');
    const r = await recipes.save(draft());
    await backup();
    for (const d of ['B', 'C', 'A']) {
      await as(d);
      await syncAll();
    }
    await recipes.save({ ...(await recipes.get(r.id))!, title: 'A' });
    await backup();
    await as('B');
    await recipes.save({ ...(await recipes.get(r.id))!, title: 'B' });
    await backup();
    await as('C');
    await syncAll();
    const titles = (await listConflicts()).map((c) => (c.remote as Recipe).title);
    // C takes one of the versions and flags the other as a conflict.
    expect(titles).toHaveLength(1);
    const kept = (await recipes.get(r.id))!.title;
    expect(new Set([kept, ...titles])).toEqual(new Set(['A', 'B']));
  });
});

describe('DB upgrade v1 → v2', () => {
  it('keeps existing data and adds empty sync tables', async () => {
    const name = 'upgrade-test';
    await Dexie.delete(name);
    const v1 = new Dexie(name);
    v1.version(1).stores({
      recipes: 'id, updatedAt, categoryId, *tagIds',
      categories: 'id, order',
      tags: 'id, name',
      photos: 'hash',
      settings: 'key',
      kv: 'key',
    });
    const rec: Recipe = {
      ...draft(),
      id: 'r1',
      createdAt: 'c',
      updatedAt: 'u',
      deviceId: 'd',
      rev: 3,
    } as Recipe;
    await v1.table('recipes').put(rec);
    await v1.table('kv').put({ key: 'deviceId', value: 'dev-1' });
    await v1.table('settings').put({ key: 'theme', value: 'warm' });
    v1.close();

    const v2 = new RecipesDb(name);
    await v2.open();
    expect(v2.verno).toBe(2);
    expect(await v2.recipes.get('r1')).toEqual(rec);
    expect(await v2.kv.get('deviceId')).toEqual({ key: 'deviceId', value: 'dev-1' });
    expect(await v2.settings.get('theme')).toEqual({ key: 'theme', value: 'warm' });
    expect(await v2.syncBase.count()).toBe(0);
    expect(await v2.syncConflicts.count()).toBe(0);
    v2.close();
    await Dexie.delete(name);
  });
});
