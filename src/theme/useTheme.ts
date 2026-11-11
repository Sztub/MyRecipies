import { useSyncExternalStore } from 'react';
import { getPreference, setPreference, subscribe } from './store';
import { THEMES, MODES, type ThemeInfo, type ThemeMode } from './themes';

export interface UseTheme {
  themes: readonly ThemeInfo[];
  modes: readonly ThemeMode[];
  theme: string;
  mode: ThemeMode;
  setTheme: (id: string) => void;
  setMode: (mode: ThemeMode) => void;
}

/** Theme list, current choice and setters. Setting applies data-theme/data-mode on <html> and persists. */
export function useTheme(): UseTheme {
  const pref = useSyncExternalStore(subscribe, getPreference);
  return {
    themes: THEMES,
    modes: MODES,
    theme: pref.theme,
    mode: pref.mode,
    setTheme: (theme) => setPreference({ theme }),
    setMode: (mode) => setPreference({ mode }),
  };
}
