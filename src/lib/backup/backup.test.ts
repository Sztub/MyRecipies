// @vitest-environment node
// Node env: native Blob (arrayBuffer + structured-clone into fake-indexeddb); jsdom's Blob supports neither.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { categories, db, photos, recipes, resetDb, tags } from '../../db';
import type { Photo, Recipe } from '../../domain/types';
import { bytesToBase64 } from '../crypto/base64';
import {
  APP_VERSION,
  BundleError,
  buildBundle,
  bundleFileName,
  bundleToJson,
  getSafetyExport,
  importBundle,
  parseBundle,
  summarizeBundle,
  type Bundle,
} from '.';
import { blobToBytes, sha256Hex } from './bytes';

async function makePhoto(seed: number, createdAt = '2026-01-01T10:00:00.000Z'): Promise<Photo> {
  const bytes = new Uint8Array([seed, seed + 1, seed + 2, 255, 0, seed]);
  return {
    hash: await sha256Hex(bytes),
    mime: 'image/jpeg',
    width: 10 + seed,
    height: 20,
    size: bytes.length,
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    createdAt,
  };
}

async function seed() {
  const p1 = await makePhoto(1);
  const p2 = await makePhoto(2);
  await photos.put(p1);
  await photos.put(p2);
  const cat = await categories.save({ name: 'Soups', order: 1 });
  const goneCat = await categories.save({ name: 'Old', order: 2 });
  await categories.softDelete(goneCat.id);
  const tag = await tags.save({ name: 'quick' });
  const r = await recipes.save({
    title: 'Żurek',
    categoryId: cat.id,
    tagIds: [tag.id],
    ingredients: [{ id: 'i1', name: 'flour', amount: 2, unit: 'tbsp', note: 'rye' }],
    steps: [{ id: 's1', text: 'Boil', photoHash: p2.hash }],
    servings: 4,
    notes: 'Easter',
    photoHashes: [p1.hash],
  });
  const gone = await recipes.save({
    title: 'Deleted',
    tagIds: [],
    ingredients: [],
    steps: [],
    photoHashes: [],
  });
  await recipes.softDelete(gone.id);
  return { p1, p2, cat, tag, r, gone };
}

async function snapshot() {
  const ps = await db.photos.toArray();
  return {
    recipes: await recipes.list({ includeDeleted: true }),
    categories: await categories.list({ includeDeleted: true }),
    tags: await tags.list({ includeDeleted: true }),
    photos: await Promise.all(
      ps
        .sort((a, b) => a.hash.localeCompare(b.hash))
        .map(async ({ blob, ...rest }) => ({
          ...rest,
          type: blob.type,
          bytes: Array.from(await blobToBytes(blob)),
        })),
    ),
  };
}

beforeEach(async () => {
  await resetDb();
});

describe('buildBundle / parseBundle', () => {
  it('builds a v1 bundle incl. tombstones and photo data', async () => {
    await seed();
    const b = await buildBundle({ includePhotoData: true });
    expect(b.format).toBe('recipes-backup');
    expect(b.version).toBe(1);
    expect(b.appVersion).toBe(APP_VERSION);
    expect(b.recipes).toHaveLength(2);
    expect(b.recipes.some((r) => r.deleted)).toBe(true);
    expect(b.categories.some((c) => c.deleted)).toBe(true);
    expect(b.photos).toHaveLength(2);
    expect(b.photos.every((p) => typeof p.data === 'string')).toBe(true);
    expect(summarizeBundle(b)).toMatchObject({
      recipes: 1,
      categories: 1,
      tags: 1,
      photos: 2,
      deleted: 2,
      hasPhotoData: true,
    });
  });

  it('omits photo data when asked', async () => {
    await seed();
    const b = await buildBundle({ includePhotoData: false });
    expect(b.photos.every((p) => p.data === undefined)).toBe(true);
    expect(summarizeBundle(b).hasPhotoData).toBe(false);
  });

  it('round-trips through JSON', async () => {
    await seed();
    const b = await buildBundle({ includePhotoData: true });
    expect(parseBundle(bundleToJson(b))).toEqual(b);
  });

  it('APP_VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });

  it('file name follows recipes-backup-YYYYMMDD-HHmm.json', () => {
    expect(bundleFileName(new Date(2026, 0, 5, 7, 3))).toBe('recipes-backup-20260105-0703.json');
  });
});

describe('parseBundle rejects invalid files', () => {
  const valid = (): Record<string, unknown> => ({
    format: 'recipes-backup',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    deviceId: 'd',
    appVersion: '0.1.0',
    recipes: [],
    categories: [],
    tags: [],
    photos: [],
  });
  const code = (input: unknown) => {
    try {
      parseBundle(input);
    } catch (e) {
      return e instanceof BundleError ? e.code : 'other';
    }
    return 'ok';
  };

  it('accepts a minimal valid bundle', () => {
    expect(code(valid())).toBe('ok');
  });
  it('invalid JSON', () => {
    expect(code('{not json')).toBe('invalid-json');
  });
  it('wrong format', () => {
    expect(code({ ...valid(), format: 'something-else' })).toBe('wrong-format');
    expect(code([])).toBe('wrong-format');
    expect(code('null')).toBe('wrong-format');
  });
  it('unknown version', () => {
    expect(code({ ...valid(), version: 2 })).toBe('unsupported-version');
    expect(code({ ...valid(), version: '1' })).toBe('unsupported-version');
  });
  it('invalid shape', () => {
    expect(code({ ...valid(), recipes: [{ id: 'x' }] })).toBe('invalid-shape');
    expect(
      code({ ...valid(), photos: [{ hash: 'nothex', mime: 'a', width: 1, height: 1, size: 1 }] }),
    ).toBe('invalid-shape');
    const { tags: _omit, ...noTags } = valid();
    void _omit;
    expect(code(noTags)).toBe('invalid-shape');
    try {
      parseBundle({ ...valid(), recipes: [{ id: 'x' }] });
    } catch (e) {
      expect((e as BundleError).details.length).toBeGreaterThan(0);
    }
  });
});

describe('importBundle', () => {
  it('build → parse → import into empty DB gives deep-equal data incl. photos and tombstones', async () => {
    await seed();
    const before = await snapshot();
    const json = bundleToJson(await buildBundle({ includePhotoData: true }));
    await resetDb();
    expect(await recipes.list({ includeDeleted: true })).toEqual([]);

    const report = await importBundle(parseBundle(json), 'replace');
    expect(await snapshot()).toEqual(before);
    expect(report.recipes.added).toBe(2);
    expect(report.photos).toMatchObject({ added: 2, missing: [], invalid: [] });
  });

  it('merge-add-missing on empty DB also gives deep-equal data', async () => {
    await seed();
    const before = await snapshot();
    const b = parseBundle(bundleToJson(await buildBundle({ includePhotoData: true })));
    await resetDb();
    await importBundle(b, 'merge-add-missing');
    expect(await snapshot()).toEqual(before);
  });

  it('merge never overwrites existing items (incl. local tombstones)', async () => {
    const { r, cat, tag } = await seed();
    const b = parseBundle(bundleToJson(await buildBundle({ includePhotoData: true })));
    // Diverge locally after export.
    const edited = await recipes.save({ ...r, title: 'Local edit' });
    await categories.softDelete(cat.id);
    await tags.save({ ...tag, name: 'local tag' });
    // Bundle also has a brand-new recipe.
    const extra: Recipe = {
      ...b.recipes[0]!,
      id: 'new-id',
      title: 'From bundle',
      deleted: undefined,
    };
    delete extra.deleted;
    const bundle: Bundle = { ...b, recipes: [...b.recipes, extra] };
    const localBefore = await snapshot();

    const report = await importBundle(bundle, 'merge-add-missing');

    expect(report.recipes).toEqual({ added: 1, skipped: 2 });
    expect(report.categories).toEqual({ added: 0, skipped: 2 });
    expect(report.tags).toEqual({ added: 0, skipped: 1 });
    expect(report.photos).toMatchObject({ added: 0, skipped: 2 });
    expect(report.safetyExport).toBeUndefined();
    expect(await recipes.get(r.id)).toEqual(edited);
    expect((await categories.get(cat.id, { includeDeleted: true }))?.deleted).toBe(true);
    expect((await tags.get(tag.id))?.name).toBe('local tag');
    expect(await recipes.get('new-id')).toEqual(extra);
    const after = await snapshot();
    expect(after.recipes.filter((x) => x.id !== 'new-id')).toEqual(localBefore.recipes);
    expect(after.photos).toEqual(localBefore.photos);
  });

  it('replace creates a safety export of the previous data before wiping', async () => {
    await seed();
    const before = await snapshot();
    const other: Bundle = {
      format: 'recipes-backup',
      version: 1,
      createdAt: '2026-02-02T00:00:00.000Z',
      deviceId: 'other',
      appVersion: '0.1.0',
      recipes: [],
      categories: [],
      tags: [],
      photos: [],
    };
    const report = await importBundle(other, 'replace');
    expect(await recipes.list({ includeDeleted: true })).toEqual([]);
    expect(await db.photos.count()).toBe(0);

    expect(report.safetyExport).toBeDefined();
    expect(report.safetyExport?.fileName).toMatch(/^recipes-backup-safety-\d{8}-\d{4}\.json$/);
    const stored = await getSafetyExport();
    expect(stored).toEqual(report.safetyExport);

    // Safety export restores the previous state exactly.
    await importBundle(parseBundle(stored!.json), 'replace');
    expect(await snapshot()).toEqual(before);
  });

  it('replace keeps already stored photos referenced by a data-less bundle', async () => {
    await seed();
    const before = await snapshot();
    const b = await buildBundle({ includePhotoData: false });
    const report = await importBundle(b, 'replace');
    expect(report.photos).toMatchObject({ added: 2, missing: [] });
    expect(await snapshot()).toEqual(before);
  });

  it('uses resolvePhoto for photos without data (T09 path) and reports missing ones', async () => {
    const { p1, p2 } = await seed();
    const b = await buildBundle({ includePhotoData: false });
    await resetDb();
    const asked: string[] = [];
    const report = await importBundle(b, 'merge-add-missing', {
      resolvePhoto: async (meta) => {
        asked.push(meta.hash);
        return meta.hash === p1.hash ? p1.blob : undefined;
      },
    });
    expect(asked.sort()).toEqual([p1.hash, p2.hash].sort());
    expect(report.photos.added).toBe(1);
    expect(report.photos.missing).toEqual([p2.hash]);
    expect(await photos.has(p1.hash)).toBe(true);
    expect(await photos.has(p2.hash)).toBe(false);
  });

  it('rejects photos whose bytes do not match the hash', async () => {
    const p = await makePhoto(7);
    const b: Bundle = {
      format: 'recipes-backup',
      version: 1,
      createdAt: '2026-02-02T00:00:00.000Z',
      deviceId: 'x',
      appVersion: '0.1.0',
      recipes: [],
      categories: [],
      tags: [],
      photos: [
        {
          hash: p.hash,
          mime: 'image/jpeg',
          width: 1,
          height: 1,
          size: 6,
          data: bytesToBase64(new Uint8Array(6)),
        },
        { hash: 'a'.repeat(64), mime: 'image/jpeg', width: 1, height: 1, size: 1, data: '!!bad' },
      ],
    };
    const report = await importBundle(b, 'merge-add-missing');
    expect(report.photos.invalid).toEqual([p.hash, 'a'.repeat(64)]);
    expect(await db.photos.count()).toBe(0);
  });
});
