import { db, photos, recipes, resetDb, tags } from '../db';
import { DEFAULT_CATEGORIES } from '../domain/defaults';
import { SAMPLE_TITLES, loadSampleRecipes } from './samples';

beforeEach(async () => {
  await resetDb();
});

describe('loadSampleRecipes', () => {
  it('loads into an empty DB twice without duplicates', async () => {
    expect(await loadSampleRecipes()).toBe(SAMPLE_TITLES.length);
    expect(await loadSampleRecipes()).toBe(0);
    const list = await recipes.list();
    expect(list.map((r) => r.title).sort()).toEqual([...SAMPLE_TITLES].sort());
    expect(await db.recipes.count()).toBe(SAMPLE_TITLES.length);
    expect(await tags.list()).toHaveLength(5);
    expect((await photos.listHashes()).length).toBe(SAMPLE_TITLES.length);
  });

  it('uses default categories, valid photos and the "other" unit with a note', async () => {
    await loadSampleRecipes();
    const list = await recipes.list();
    const catIds = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
    for (const r of list) {
      expect(catIds.has(r.categoryId!)).toBe(true);
      expect(await photos.has(r.photoHashes[0]!)).toBe(true);
    }
    const others = list.flatMap((r) => r.ingredients).filter((i) => i.unit === 'other');
    expect(others.length).toBeGreaterThan(0);
    expect(others.some((i) => i.unitText && i.note)).toBe(true);
  });

  it('does not overwrite user edits', async () => {
    await loadSampleRecipes();
    const r = (await recipes.list())[0]!;
    await recipes.save({ ...r, title: 'Moje' });
    await loadSampleRecipes();
    expect((await recipes.get(r.id))!.title).toBe('Moje');
  });
});
