import { useSyncExternalStore } from 'react';
import { en, type StringKey } from './en';
import { pl } from './pl';
import type { Dictionary, PluralForms, Translation } from './types';

export type { StringKey };
export type { Dictionary, PluralForms, Translation };

export const LANGUAGES = ['pl', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
/** Polish is the default; English is selectable in Settings. */
export const DEFAULT_LANGUAGE: Language = 'pl';
export const LANGUAGE_STORAGE_KEY = 'recipes.lang';

const DICTIONARIES: Record<Language, Dictionary> = { pl, en };

let current: Language = DEFAULT_LANGUAGE;
const listeners = new Set<() => void>();
const pluralRules = new Map<Language, Intl.PluralRules>();

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

function loadStored(): Language {
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(raw) ? raw : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function apply(lang: Language): void {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

/**
 * Loads the saved language (default PL) and sets <html lang>. Runs automatically when this module is
 * first imported (so the very first render is already in the right language); exported for tests.
 */
export function initI18n(): Language {
  apply(loadStored());
  return current;
}

initI18n();

export function getLanguage(): Language {
  return current;
}

/** Switches the UI language, persists it (localStorage, read synchronously on start) and notifies subscribers. */
export function setLanguage(lang: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // storage unavailable (private mode / quota): the choice just won't persist
  }
  apply(lang);
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current language; re-renders the caller when it changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

function rulesFor(lang: Language): Intl.PluralRules {
  let r = pluralRules.get(lang);
  if (!r) {
    r = new Intl.PluralRules(lang);
    pluralRules.set(lang, r);
  }
  return r;
}

/** Locale-aware number formatting (e.g. "1,5" in Polish). */
export function formatNumber(n: number, lang: Language = current): string {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: 3 }).format(n);
}

/** Picks the plural form for `count` using Intl.PluralRules (pl: one/few/many/other). Falls back to `other`. */
export function selectPlural(forms: PluralForms, count: number, lang: Language = current): string {
  const category = rulesFor(lang).select(count) as keyof PluralForms;
  return forms[category] ?? forms.other;
}

export type TParams = Record<string, string | number>;

function interpolate(text: string, params: TParams | undefined, lang: Language): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = params[name];
    if (v === undefined) return match;
    return typeof v === 'number' ? formatNumber(v, lang) : v;
  });
}

/**
 * Translate a UI string key into the current language.
 * Plural keys need `{ count }`; `{name}` placeholders are filled from `params`.
 */
export function t(key: StringKey, params?: TParams): string {
  const lang = current;
  const entry: Translation = DICTIONARIES[lang][key] ?? en[key];
  if (typeof entry === 'string') return interpolate(entry, params, lang);
  const count = typeof params?.count === 'number' ? params.count : Number.NaN;
  return interpolate(selectPlural(entry, count, lang), params, lang);
}

const CATEGORY_KEY = /^category\.[a-z_]+$/;

/** True if `value` is an i18n key of a default category (how seeded categories store their name). */
export function isCategoryNameKey(value: string): value is StringKey {
  return CATEGORY_KEY.test(value) && Object.prototype.hasOwnProperty.call(en, value);
}

/**
 * Display name of a category: default categories store an i18n key (e.g. "category.mains") and are shown
 * in the current language; user-created or renamed categories show their own name.
 */
export function categoryName(category: { name: string }): string {
  return isCategoryNameKey(category.name) ? t(category.name) : category.name;
}

/** Test helper: reset to the default language without touching storage. */
export function resetI18nForTests(lang: Language = DEFAULT_LANGUAGE): void {
  apply(lang);
}

/** Unit label that agrees with the amount (pl: 1 łyżka, 2 łyżki, 5 łyżek). Without an amount: the base label. */
export function unitLabel(unit: import('../domain/types').Unit, amount?: number): string {
  if (amount === undefined) return t(`unit.${unit}`);
  return t(`unit.${unit}.count`, { count: amount });
}
