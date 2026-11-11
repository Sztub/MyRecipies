import { DEFAULT_CATEGORIES } from '../domain/defaults';
import { categoryName, resetI18nForTests } from '../i18n';
import { categories, db, initDb, resetDb, seedDefaults } from './index';
import { migrateDefaultCategoryNames } from './seed';

const [mains, soups, desserts] = DEFAULT_CATEGORIES;

beforeEach(async () => {
  await resetDb();
});

/** Simulates a Run 1 database: default categories seeded with their English labels. */
async function seedRun1(names: Record<string, string>) {
  await seedDefaults();
  for (const [id, name] of Object.entries(names)) {
    const c = (await db.categories.get(id))!;
    await db.categories.put({ ...c, name });
  }
}

describe('default category names', () => {
  it('seeds i18n keys that are shown in the current language', async () => {
    await initDb();
    const list = await categories.list();
    expect(list[1]!.name).toBe('category.soups');
    resetI18nForTests('pl');
    expect(list.map(categoryName)).toEqual([
      'Dania główne',
      'Zupy',
      'Desery',
      'Wypieki',
      'Przetwory',
      'Sałatki',
      'Inne',
    ]);
    resetI18nForTests('en');
    expect(categoryName(list[0]!)).toBe('Mains');
  });

  it('migrates Run 1 English names to keys without changing IDs, keeps renamed ones', async () => {
    await seedRun1({ [mains!.id]: 'Mains', [soups!.id]: 'Grandma soups', [desserts!.id]: ' desery ' });
    const before = await db.categories.toArray();

    expect(await migrateDefaultCategoryNames()).toBe(2);

    const after = await db.categories.toArray();
    expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
    expect(after).toHaveLength(7);
    const m = await db.categories.get(mains!.id);
    expect(m?.name).toBe('category.mains');
    expect(m?.rev).toBe(2);
    expect((await db.categories.get(soups!.id))?.name).toBe('Grandma soups');
    expect((await db.categories.get(desserts!.id))?.name).toBe('category.desserts');
  });

  it('is idempotent and runs on every start', async () => {
    await seedRun1({ [mains!.id]: 'Mains' });
    await initDb();
    expect((await db.categories.get(mains!.id))?.name).toBe('category.mains');
    expect(await migrateDefaultCategoryNames()).toBe(0);
  });

  it('leaves soft-deleted defaults deleted', async () => {
    await seedRun1({ [mains!.id]: 'Mains' });
    await categories.softDelete(mains!.id);
    await migrateDefaultCategoryNames();
    const m = await db.categories.get(mains!.id);
    expect(m?.deleted).toBe(true);
    expect(await categories.get(mains!.id)).toBeUndefined();
  });
});
