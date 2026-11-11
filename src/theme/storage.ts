import { parsePreference, type ThemePreference } from './themes';

/**
 * Where the theme choice is persisted. Synchronous so the theme can be applied before first paint.
 * T08 may later mirror it into the Dexie settings repo (see README.md).
 */
export interface ThemeStorage {
  load(): ThemePreference;
  save(pref: ThemePreference): void;
}

export const THEME_STORAGE_KEY = 'recipes.theme';

export const localStorageThemeStorage: ThemeStorage = {
  load() {
    try {
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      return parsePreference(raw ? JSON.parse(raw) : null);
    } catch {
      return parsePreference(null);
    }
  },
  save(pref) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(pref));
    } catch {
      // storage unavailable (private mode / quota): the choice just won't persist
    }
  },
};
