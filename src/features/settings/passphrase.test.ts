import { describe, expect, it } from 'vitest';
import {
  BITS_PER_WORD,
  LIST_SIZE,
  WORDS_PER_PASSPHRASE,
  generatePassphrase,
  loadWordList,
  passphraseEntropyBits,
  passphraseLanguageForUi,
  unbiasedIndex,
} from './passphrase';

/** Lower-cases and strips Polish diacritics, so "łoś" and "los" compare equal. */
function foldDiacritics(word: string): string {
  return word
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/[źż]/g, 'z');
}

/** Sequence source for deterministic tests: returns the given values in order. */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i++];
    if (v === undefined) throw new Error('sequence exhausted');
    return v;
  };
}

describe.each(['pl', 'en'] as const)('word list "%s"', (lang) => {
  it('has exactly 2048 words, so each word is 11 bits', async () => {
    const words = await loadWordList(lang);
    expect(words).toHaveLength(LIST_SIZE);
    expect(BITS_PER_WORD).toBe(11);
  });

  it('has no duplicate words', async () => {
    const words = await loadWordList(lang);
    expect(new Set(words).size).toBe(words.length);
  });

  it('uses only lowercase letters and is 3–8 characters long', async () => {
    const words = await loadWordList(lang);
    const allowed = lang === 'pl' ? /^[a-ząćęłńóśźż]+$/ : /^[a-z]+$/;
    for (const w of words) {
      expect(w, w).toMatch(allowed);
      expect([...w].length, w).toBeGreaterThanOrEqual(3);
      expect([...w].length, w).toBeLessThanOrEqual(8);
    }
  });

  it('has no two words that collide once diacritics are removed', async () => {
    const words = await loadWordList(lang);
    const folded = new Set(words.map(foldDiacritics));
    expect(folded.size).toBe(words.length);
  });
});

describe('unbiasedIndex', () => {
  it('maps values below the limit to index = value % max', () => {
    expect(unbiasedIndex(10, sequence([0, 9, 10, 25]))).toBe(0);
    expect(unbiasedIndex(10, sequence([9]))).toBe(9);
    expect(unbiasedIndex(10, sequence([25]))).toBe(5);
  });

  it('rejects values in the biased tail and draws again', () => {
    // For max = 3 the limit is floor(2^32 / 3) * 3 = 4294967295, so 4294967295 must be rejected.
    const next = sequence([4294967295, 4294967295, 7]);
    expect(unbiasedIndex(3, next)).toBe(1);
  });

  it('stays in range for many random draws', () => {
    for (let max = 1; max <= 50; max++) {
      for (let k = 0; k < 20; k++) {
        const idx = unbiasedIndex(max);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(max);
      }
    }
  });

  it('rejects invalid max values', () => {
    expect(() => unbiasedIndex(0)).toThrow(RangeError);
    expect(() => unbiasedIndex(1.5)).toThrow(RangeError);
  });
});

describe('generatePassphrase', () => {
  it('returns the default number of words from the default (PL) list', async () => {
    const words = (await loadWordList('pl'));
    const phrase = await generatePassphrase();
    const parts = phrase.split(' ');
    expect(parts).toHaveLength(WORDS_PER_PASSPHRASE);
    for (const p of parts) expect(words).toContain(p);
  });

  it('returns the requested number of words from the English list when asked', async () => {
    const words = await loadWordList('en');
    const parts = (await generatePassphrase({ words: 6, lang: 'en' })).split(' ');
    expect(parts).toHaveLength(6);
    for (const p of parts) expect(words).toContain(p);
  });

  it('is deterministic for an injected random source', async () => {
    // Index 0 and index 1 in the PL list.
    const a = await generatePassphrase({ words: 2, lang: 'pl', nextUint32: sequence([0, 1]) });
    const words = await loadWordList('pl');
    expect(a).toBe(`${words[0]} ${words[1]}`);
  });

  it('reports 77 bits of entropy for the default 7 words', () => {
    expect(passphraseEntropyBits()).toBe(77);
  });
});

describe('passphraseLanguageForUi', () => {
  it('follows English and Polish UI tags', () => {
    expect(passphraseLanguageForUi('en')).toBe('en');
    expect(passphraseLanguageForUi('en-GB')).toBe('en');
    expect(passphraseLanguageForUi('pl')).toBe('pl');
  });

  it('defaults to Polish for anything else', () => {
    expect(passphraseLanguageForUi(undefined)).toBe('pl');
    expect(passphraseLanguageForUi('de')).toBe('pl');
  });
});
