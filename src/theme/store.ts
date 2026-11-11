import { localStorageThemeStorage, type ThemeStorage } from './storage';
import { applyPreference, parsePreference, type ThemePreference } from './themes';

let storage: ThemeStorage = localStorageThemeStorage;
let current: ThemePreference = parsePreference(null);
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

/**
 * Loads the saved preference and applies it to <html>. Call once at startup, before render.
 * Pass a custom storage to replace localStorage (e.g. a settings-repo backed one).
 */
export function initTheme(custom?: ThemeStorage): ThemePreference {
  if (custom) storage = custom;
  current = storage.load();
  applyPreference(document.documentElement, current);
  notify();
  return current;
}

export function getPreference(): ThemePreference {
  return current;
}

export function setPreference(next: Partial<ThemePreference>): void {
  current = parsePreference({ ...current, ...next });
  applyPreference(document.documentElement, current);
  storage.save(current);
  notify();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test helper: restore module defaults. */
export function resetThemeStoreForTests(): void {
  storage = localStorageThemeStorage;
  current = parsePreference(null);
  listeners.clear();
}
