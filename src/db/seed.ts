import { DEFAULT_CATEGORIES } from '../domain/defaults';
import { nowIso } from '../domain/ids';
import type { Category } from '../domain/types';
import { en } from '../i18n/en';
import { pl } from '../i18n/pl';
import { db } from './db';
import { getDeviceId } from './device';

const SEEDED_KEY = 'seeded.categories.v1';

/**
 * Seeds the default categories once per database. Idempotent: guarded by a kv flag, and never
 * overwrites existing records (so user renames and soft deletes survive).
 * @returns number of categories inserted
 */
export async function seedDefaults(): Promise<number> {
  const deviceId = await getDeviceId();
  return db.transaction('rw', db.categories, db.kv, async () => {
    if (await db.kv.get(SEEDED_KEY)) return 0;
    const now = nowIso();
    const stored = await db.categories.bulkGet(DEFAULT_CATEGORIES.map((c) => c.id));
    const existing = new Set(stored.flatMap((c) => (c ? [c.id] : [])));
    const toAdd: Category[] = DEFAULT_CATEGORIES.filter((c) => !existing.has(c.id)).map((c) => ({
      id: c.id,
      // Stored as the i18n key so it is shown in the current language (see categoryName()).
      name: c.nameKey,
      order: c.order,
      createdAt: now,
      updatedAt: now,
      deviceId,
      rev: 1,
    }));
    await db.categories.bulkAdd(toAdd);
    await db.kv.put({ key: SEEDED_KEY, value: now });
    return toAdd.length;
  });
}

const norm = (s: string) => s.trim().toLocaleLowerCase();

/**
 * Converts seeded default categories that still carry a translated name (Run 1 stored the English label)
 * into their i18n key, keeping the same ID. Categories the user renamed keep their own name.
 * Idempotent; safe to run on every start (also fixes categories restored from an old backup).
 * @returns number of categories migrated
 */
export async function migrateDefaultCategoryNames(): Promise<number> {
  return db.transaction('rw', db.categories, async () => {
    const stored = await db.categories.bulkGet(DEFAULT_CATEGORIES.map((c) => c.id));
    const now = nowIso();
    const updates: Category[] = [];
    DEFAULT_CATEGORIES.forEach((def, i) => {
      const cat = stored[i];
      if (!cat || cat.name === def.nameKey) return;
      const labels = [en[def.nameKey], pl[def.nameKey]].map((l) => norm(String(l)));
      if (!labels.includes(norm(cat.name))) return;
      updates.push({ ...cat, name: def.nameKey, rev: cat.rev + 1, updatedAt: now });
    });
    if (updates.length) await db.categories.bulkPut(updates);
    return updates.length;
  });
}

/** App startup: open the DB, ensure a device ID and seed defaults. */
export async function initDb(): Promise<void> {
  await db.open();
  await getDeviceId();
  await seedDefaults();
  await migrateDefaultCategoryNames();
}
