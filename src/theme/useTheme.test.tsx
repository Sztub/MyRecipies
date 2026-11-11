import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { initTheme, useTheme } from '.';
import { resetThemeStoreForTests } from './store';
import { THEME_STORAGE_KEY } from './storage';
import { parsePreference } from './themes';

const html = document.documentElement;

function clearDom(): void {
  html.removeAttribute('data-theme');
  html.removeAttribute('data-mode');
}

beforeEach(() => {
  localStorage.clear();
  clearDom();
  resetThemeStoreForTests();
});

describe('useTheme', () => {
  it('lists themes and applies the default on init', () => {
    initTheme();
    const { result } = renderHook(() => useTheme());
    expect(result.current.themes.map((t) => t.id)).toEqual(['ksiazka', 'notes', 'zielnik', 'default', 'warm']);
    expect(html.getAttribute('data-theme')).toBe('ksiazka');
    expect(html.hasAttribute('data-mode')).toBe(false);
  });

  it('switching theme changes data-theme (and state)', () => {
    initTheme();
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('warm'));
    expect(result.current.theme).toBe('warm');
    expect(html.getAttribute('data-theme')).toBe('warm');
  });

  it('mode override sets and clears data-mode', () => {
    initTheme();
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setMode('dark'));
    expect(html.getAttribute('data-mode')).toBe('dark');
    act(() => result.current.setMode('system'));
    expect(html.hasAttribute('data-mode')).toBe(false);
  });

  it('choice survives a reload', () => {
    initTheme();
    const first = renderHook(() => useTheme());
    act(() => first.result.current.setTheme('warm'));
    act(() => first.result.current.setMode('dark'));
    first.unmount();

    // simulate reload: fresh module state + fresh DOM, same localStorage
    clearDom();
    resetThemeStoreForTests();
    initTheme();
    expect(html.getAttribute('data-theme')).toBe('warm');
    expect(html.getAttribute('data-mode')).toBe('dark');
    expect(renderHook(() => useTheme()).result.current.theme).toBe('warm');
  });

  it('ignores corrupt or unknown stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, '{not json');
    initTheme();
    expect(html.getAttribute('data-theme')).toBe('ksiazka');
    expect(parsePreference({ theme: 'nope', mode: 'purple' })).toEqual({ theme: 'ksiazka', mode: 'system' });
  });

  it('supports a custom storage', () => {
    let saved: unknown = null;
    initTheme({
      load: () => ({ theme: 'warm', mode: 'light' }),
      save: (p) => {
        saved = p;
      },
    });
    expect(html.getAttribute('data-theme')).toBe('warm');
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('default'));
    expect(saved).toEqual({ theme: 'default', mode: 'light' });
  });
});
