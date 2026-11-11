import { matchesRecipe, normalizeText, queryTokens } from './search';

const rec = {
  title: 'Żurek na zakwasie',
  ingredients: [{ id: '1', name: 'Kiełbasa' }],
};

describe('normalizeText', () => {
  it('lowercases and strips Polish diacritics', () => {
    expect(normalizeText('Żurek ŁĄKA ćma')).toBe('zurek laka cma');
  });
  it('collapses whitespace', () => {
    expect(normalizeText('  a   b ')).toBe('a b');
  });
});

describe('queryTokens', () => {
  it('is empty for blank input', () => {
    expect(queryTokens('   ')).toEqual([]);
  });
  it('splits into normalised words', () => {
    expect(queryTokens('Żur  KIEŁ')).toEqual(['zur', 'kiel']);
  });
});

describe('matchesRecipe', () => {
  it('matches everything for empty query', () => {
    expect(matchesRecipe(rec, [], [])).toBe(true);
  });
  it('finds żurek with "zur"', () => {
    expect(matchesRecipe(rec, [], queryTokens('zur'))).toBe(true);
  });
  it('finds by ingredient name, diacritic-insensitive', () => {
    expect(matchesRecipe(rec, [], queryTokens('kielbasa'))).toBe(true);
  });
  it('finds by tag / category text', () => {
    expect(matchesRecipe(rec, ['Świąteczne'], queryTokens('swiat'))).toBe(true);
  });
  it('requires all words', () => {
    expect(matchesRecipe(rec, [], queryTokens('zur jajko'))).toBe(false);
    expect(matchesRecipe(rec, [], queryTokens('zur kiel'))).toBe(true);
  });
  it('does not match unrelated text', () => {
    expect(matchesRecipe(rec, [], queryTokens('pierogi'))).toBe(false);
  });
});
