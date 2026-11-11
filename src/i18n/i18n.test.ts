import { en } from './en';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  categoryName,
  formatNumber,
  getLanguage,
  initI18n,
  isCategoryNameKey,
  resetI18nForTests,
  selectPlural,
  setLanguage,
  subscribeLanguage,
  t,
  unitLabel,
} from './index';
import { pl } from './pl';

afterEach(() => localStorage.removeItem(LANGUAGE_STORAGE_KEY));

describe('dictionaries', () => {
  it('pl.ts and en.ts have exactly the same keys', () => {
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
  });

  it('plural entries have an "other" form and the same placeholders in both languages', () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const a = en[key];
      const b = pl[key];
      expect(typeof a, key).toBe(typeof b);
      const placeholders = (v: unknown) =>
        [...JSON.stringify(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(new Set(placeholders(b)), key).toEqual(new Set(placeholders(a)));
      if (typeof a === 'object') expect(a.other, key).toBeTruthy();
      if (typeof b === 'object') expect(b.other, key).toBeTruthy();
    }
  });

  it('no Polish string is empty', () => {
    for (const [key, v] of Object.entries(pl)) {
      if (typeof v === 'string') expect(v.trim(), key).not.toBe('');
    }
  });
});

describe('t()', () => {
  it('returns the English string', () => {
    resetI18nForTests('en');
    expect(t('nav.recipes')).toBe('Recipes');
  });

  it('returns the Polish string', () => {
    resetI18nForTests('pl');
    expect(t('nav.settings')).toBe('Ustawienia');
  });

  it('defaults to Polish', () => {
    expect(DEFAULT_LANGUAGE).toBe('pl');
    localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    expect(initI18n()).toBe('pl');
    expect(document.documentElement.lang).toBe('pl');
  });
});

describe('plurals (Intl.PluralRules)', () => {
  const egg = { one: '{count} jajko', few: '{count} jajka', many: '{count} jajek', other: '{count} jajka' };

  it.each([
    [1, 'one'],
    [2, 'few'],
    [4, 'few'],
    [5, 'many'],
    [11, 'many'],
    [12, 'many'],
    [22, 'few'],
    [25, 'many'],
    [1.5, 'other'],
  ])('Polish %d → %s', (n, form) => {
    expect(selectPlural(egg, n, 'pl')).toBe(egg[form as keyof typeof egg]);
  });

  it('1 jajko, 2 jajka, 5 jajek', () => {
    resetI18nForTests('pl');
    expect(t('recipes.servingsCount', { count: 1 })).toBe('1 porcja');
    expect(t('recipes.servingsCount', { count: 2 })).toBe('2 porcje');
    expect(t('recipes.servingsCount', { count: 5 })).toBe('5 porcji');
    expect(t('recipes.servingsCount', { count: 22 })).toBe('22 porcje');
    expect(t('recipes.recipeCount', { count: 12 })).toBe('12 przepisów');
  });

  it('English uses one/other', () => {
    resetI18nForTests('en');
    expect(t('recipes.servingsCount', { count: 1 })).toBe('1 serving');
    expect(t('recipes.servingsCount', { count: 5 })).toBe('5 servings');
  });

  it('falls back to "other" when a form is missing', () => {
    expect(selectPlural({ other: 'x' }, 1, 'pl')).toBe('x');
  });

  it('unit labels agree with the amount', () => {
    resetI18nForTests('pl');
    expect(unitLabel('tbsp', 1)).toBe('łyżka');
    expect(unitLabel('tbsp', 2)).toBe('łyżki');
    expect(unitLabel('tbsp', 5)).toBe('łyżek');
    expect(unitLabel('glass', 0.5)).toBe('szklanki');
    expect(unitLabel('g', 250)).toBe('g');
    expect(unitLabel('glass')).toBe('szklanka');
    resetI18nForTests('en');
    expect(unitLabel('glass', 2)).toBe('glasses');
  });

  it('formats numbers per locale', () => {
    expect(formatNumber(1.5, 'pl')).toBe('1,5');
    expect(formatNumber(1.5, 'en')).toBe('1.5');
    resetI18nForTests('pl');
    expect(t('recipes.servingsCount', { count: 1.5 })).toBe('1,5 porcji');
  });
});

describe('language switch', () => {
  it('persists the choice and applies it on the next start', () => {
    resetI18nForTests('pl');
    const seen: string[] = [];
    const off = subscribeLanguage(() => seen.push(getLanguage()));
    setLanguage('en');
    off();
    expect(seen).toEqual(['en']);
    expect(t('nav.settings')).toBe('Settings');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    resetI18nForTests('pl'); // simulate a fresh module state
    expect(initI18n()).toBe('en'); // "reload"
    expect(t('nav.settings')).toBe('Settings');
  });

  it('ignores an invalid stored value', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'xx');
    expect(initI18n()).toBe('pl');
  });
});

describe('category names', () => {
  it('shows default categories in the current language', () => {
    resetI18nForTests('pl');
    expect(categoryName({ name: 'category.soups' })).toBe('Zupy');
    resetI18nForTests('en');
    expect(categoryName({ name: 'category.soups' })).toBe('Soups');
  });

  it('shows user names as they are', () => {
    resetI18nForTests('pl');
    expect(categoryName({ name: 'Zupy babci' })).toBe('Zupy babci');
    expect(categoryName({ name: 'category.nope' })).toBe('category.nope');
    expect(isCategoryNameKey('nav.recipes')).toBe(false);
  });
});
