import { settingsSchemas, type Settings, type SettingsKey } from '../domain/settings';
import { db } from './db';

/** Typed key-value settings store. Keys and value schemas live in `src/domain/settings.ts`. */
export const settings = {
  /** Returns the stored value, or undefined if unset or no longer valid for the key's schema. */
  async get<K extends SettingsKey>(key: K): Promise<Settings[K] | undefined> {
    const row = await db.settings.get(key);
    if (!row) return undefined;
    const parsed = settingsSchemas[key].safeParse(row.value);
    return parsed.success ? (parsed.data as Settings[K]) : undefined;
  },

  /** Validates and stores the value. Throws a ZodError if it doesn't match the key's schema. */
  async set<K extends SettingsKey>(key: K, value: Settings[K]): Promise<void> {
    const parsed = settingsSchemas[key].parse(value);
    await db.settings.put({ key, value: parsed });
  },

  async remove(key: SettingsKey): Promise<void> {
    await db.settings.delete(key);
  },
};
