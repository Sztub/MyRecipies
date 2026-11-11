import type { StringKey } from '../i18n';

export interface ThemeInfo {
  id: string;
  labelKey: StringKey;
}

/** Available themes. To add one: create themes/<id>.css (+ optional <id>.decor.css), @import in tokens.css, add here (see README.md). */
export const THEMES: readonly ThemeInfo[] = [
  { id: 'ksiazka', labelKey: 'theme.ksiazka' },
  { id: 'notes', labelKey: 'theme.notes' },
  { id: 'zielnik', labelKey: 'theme.zielnik' },
  { id: 'default', labelKey: 'theme.default' },
  { id: 'warm', labelKey: 'theme.warm' },
];

export const MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof MODES)[number];

export interface ThemePreference {
  theme: string;
  mode: ThemeMode;
}

export const DEFAULT_PREFERENCE: ThemePreference = { theme: 'ksiazka', mode: 'system' };

/** Coerces unknown stored data into a valid preference (unknown themes/modes fall back to defaults). */
export function parsePreference(raw: unknown): ThemePreference {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PREFERENCE };
  const r = raw as Record<string, unknown>;
  const theme = THEMES.find((x) => x.id === r.theme)?.id ?? DEFAULT_PREFERENCE.theme;
  const mode = MODES.find((m) => m === r.mode) ?? DEFAULT_PREFERENCE.mode;
  return { theme, mode };
}

/** Sets data-theme / data-mode on the element (normally <html>). "system" mode removes data-mode. */
export function applyPreference(el: HTMLElement, pref: ThemePreference): void {
  el.setAttribute('data-theme', pref.theme);
  if (pref.mode === 'system') el.removeAttribute('data-mode');
  else el.setAttribute('data-mode', pref.mode);
}
