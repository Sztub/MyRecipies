import { DEFAULT_CATEGORIES } from '../domain/defaults';
import type { Draft, Photo, Recipe } from '../domain/types';
import {
  categories,
  db,
  getDeviceId,
  initDb,
  photos,
  recipes,
  resetDb,
  seedDefaults,
  settings,
  tags,
} from './index';

function recipeDraft(over: Partial<Draft<Recipe>> = {}): Draft<Recipe> {
  return {
    title: 'Pierogi',
    tagIds: [],
    ingredients: [{ id: crypto.randomUUID(), name: 'flour', amount: 500, unit: 'g' }],
    steps: [{ id: crypto.randomUUID(), text: 'Mix.' }],
    photoHashes: [],
    ...over,
  };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));
  await resetDb();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('device id', () => {
  it('is generated once and persisted', async () => {
    const a = await getDeviceId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getDeviceId()).toBe(a);
    expect((await db.kv.get('deviceId'))?.value).toBe(a);
  });

  it('is regenerated after reset', async () => {
    const a = await getDeviceId();
    await resetDb();
    expect(await getDeviceId()).not.toBe(a);
  });
});

describe('recipes CRUD', () => {
  it('creates with fresh meta', async () => {
    const r = await recipes.save(recipeDraft());
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.rev).toBe(1);
    expect(r.createdAt).toBe('2026-01-01T10:00:00.000Z');
    expect(r.updatedAt).toBe(r.createdAt);
    expect(r.deviceId).toBe(await getDeviceId());
    expect(r.deleted).toBeUndefined();
    expect(await recipes.get(r.id)).toEqual(r);
  });

  it('update bumps rev and updatedAt, keeps createdAt, ignores passed-in meta', async () => {
    const r1 = await recipes.save(recipeDraft());
    vi.setSystemTime(new Date('2026-01-02T10:00:00.000Z'));
    const r2 = await recipes.save({
      ...r1,
      title: 'Pierogi ruskie',
      rev: 99,
      createdAt: 'x',
      deviceId: 'other',
    });
    expect(r2.id).toBe(r1.id);
    expect(r2.rev).toBe(2);
    expect(r2.createdAt).toBe(r1.createdAt);
    expect(r2.updatedAt).toBe('2026-01-02T10:00:00.000Z');
    expect(r2.deviceId).toBe(r1.deviceId);
    expect((await recipes.get(r1.id))?.title).toBe('Pierogi ruskie');
    expect(await db.recipes.count()).toBe(1);
  });

  it('save with an unknown id creates that id', async () => {
    const id = crypto.randomUUID();
    const r = await recipes.save(recipeDraft({ id }));
    expect(r.id).toBe(id);
    expect(r.rev).toBe(1);
  });

  it('lists sorted by title', async () => {
    await recipes.save(recipeDraft({ title: 'żurek' }));
    await recipes.save(recipeDraft({ title: 'Bigos' }));
    await recipes.save(recipeDraft({ title: 'apple pie' }));
    expect((await recipes.list()).map((r) => r.title)).toEqual(['apple pie', 'Bigos', 'żurek']);
  });

  it('get returns undefined for unknown ids', async () => {
    expect(await recipes.get('nope')).toBeUndefined();
  });
});

describe('soft delete', () => {
  it('hides from list and get, keeps tombstone', async () => {
    const keep = await recipes.save(recipeDraft({ title: 'Keep' }));
    const gone = await recipes.save(recipeDraft({ title: 'Gone' }));
    vi.setSystemTime(new Date('2026-01-03T10:00:00.000Z'));
    const tomb = await recipes.softDelete(gone.id);
    expect(tomb).toMatchObject({ deleted: true, rev: 2, updatedAt: '2026-01-03T10:00:00.000Z' });
    expect((await recipes.list()).map((r) => r.id)).toEqual([keep.id]);
    expect(await recipes.get(gone.id)).toBeUndefined();
    expect(await recipes.get(gone.id, { includeDeleted: true })).toMatchObject({ deleted: true });
    expect((await recipes.list({ includeDeleted: true })).length).toBe(2);
  });

  it('is a no-op for unknown or already deleted ids', async () => {
    const r = await recipes.save(recipeDraft());
    await recipes.softDelete(r.id);
    expect(await recipes.softDelete(r.id)).toBeUndefined();
    expect(await recipes.softDelete('nope')).toBeUndefined();
    expect((await recipes.get(r.id, { includeDeleted: true }))?.rev).toBe(2);
  });

  it('saving a tombstone does not resurrect it', async () => {
    const r = await recipes.save(recipeDraft());
    await recipes.softDelete(r.id);
    const r3 = await recipes.save({ ...r, title: 'edited' });
    expect(r3).toMatchObject({ rev: 3, deleted: true });
    expect(await recipes.list()).toEqual([]);
  });
});

describe('putRaw', () => {
  it('stores records with meta untouched', async () => {
    const raw: Recipe = {
      ...recipeDraft(),
      id: crypto.randomUUID(),
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-02-01T00:00:00.000Z',
      deviceId: 'device-b',
      rev: 7,
      deleted: true,
    };
    await recipes.putRaw([raw]);
    expect(await recipes.get(raw.id, { includeDeleted: true })).toEqual(raw);
  });
});

describe('categories and tags', () => {
  it('CRUD categories sorted by order', async () => {
    const b = await categories.save({ name: 'B', order: 2 });
    const a = await categories.save({ name: 'A', order: 1 });
    expect((await categories.list()).map((c) => c.id)).toEqual([a.id, b.id]);
    await categories.save({ ...b, name: 'B2' });
    expect((await categories.get(b.id))?.rev).toBe(2);
    await categories.softDelete(a.id);
    expect((await categories.list()).map((c) => c.name)).toEqual(['B2']);
  });

  it('CRUD tags sorted by name', async () => {
    const v = await tags.save({ name: 'vegan' });
    await tags.save({ name: 'Quick' });
    expect((await tags.list()).map((t) => t.name)).toEqual(['Quick', 'vegan']);
    await tags.softDelete(v.id);
    expect((await tags.list()).map((t) => t.name)).toEqual(['Quick']);
    expect(await tags.get(v.id)).toBeUndefined();
  });
});

describe('seeding', () => {
  it('seeds the default categories with fixed ids', async () => {
    expect(await seedDefaults()).toBe(7);
    const list = await categories.list();
    // Stored as i18n keys (T21); shown in the current language via categoryName().
    expect(list.map((c) => c.name)).toEqual(DEFAULT_CATEGORIES.map((c) => c.nameKey));
    expect(list.map((c) => c.id)).toEqual(DEFAULT_CATEGORIES.map((c) => c.id));
    expect(list.every((c) => c.rev === 1)).toBe(true);
  });

  it('is idempotent and keeps user edits and deletes', async () => {
    await initDb();
    const first = await categories.list();
    await categories.save({ ...first[0]!, name: 'Main dishes' });
    await categories.softDelete(first[1]!.id);
    expect(await seedDefaults()).toBe(0);
    await initDb();
    expect(await db.categories.count()).toBe(7);
    expect((await categories.get(first[0]!.id))?.name).toBe('Main dishes');
    expect(await categories.get(first[1]!.id)).toBeUndefined();
  });

  it('runs safely when called concurrently', async () => {
    await Promise.all([seedDefaults(), seedDefaults(), initDb()]);
    expect(await db.categories.count()).toBe(7);
  });
});

describe('photos', () => {
  function photo(hash: string): Photo {
    return {
      hash,
      mime: 'image/jpeg',
      width: 10,
      height: 20,
      size: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      createdAt: '2026-01-01T10:00:00.000Z',
    };
  }

  it('put/get/has/listHashes', async () => {
    expect(await photos.has('bb')).toBe(false);
    await photos.put(photo('bb'));
    await photos.put(photo('aa'));
    expect(await photos.has('bb')).toBe(true);
    const got = await photos.get('bb');
    expect(got).toMatchObject({ hash: 'bb', mime: 'image/jpeg', width: 10, height: 20, size: 3 });
    expect(got?.blob).toBeDefined();
    expect(await photos.listHashes()).toEqual(['aa', 'bb']);
  });

  it('put is idempotent per hash', async () => {
    await photos.put(photo('aa'));
    await photos.put({ ...photo('aa'), width: 999 });
    expect(await photos.listHashes()).toEqual(['aa']);
    expect((await photos.get('aa'))?.width).toBe(10);
  });
});

describe('settings', () => {
  it('get/set typed values', async () => {
    expect(await settings.get('theme')).toBeUndefined();
    await settings.set('theme', 'warm');
    await settings.set('colorMode', 'dark');
    expect(await settings.get('theme')).toBe('warm');
    expect(await settings.get('colorMode')).toBe('dark');
    await settings.set('theme', 'fresh');
    expect(await settings.get('theme')).toBe('fresh');
    await settings.remove('theme');
    expect(await settings.get('theme')).toBeUndefined();
  });

  it('rejects invalid values and ignores invalid stored ones', async () => {
    // @ts-expect-error – invalid value on purpose
    await expect(settings.set('colorMode', 'purple')).rejects.toThrow();
    await db.settings.put({ key: 'colorMode', value: 'purple' });
    expect(await settings.get('colorMode')).toBeUndefined();
  });
});
