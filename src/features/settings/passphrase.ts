/**
 * Suggested passphrases: random words from a built-in list.
 *
 * Each word is one of 2048 entries, i.e. exactly 11 bits (log2 2048). The default of 7 words gives 77 bits
 * before the KDF; PBKDF2 with 600 000 iterations adds work on top of that.
 *
 * The word lists live in `./wordlists/` and are loaded with dynamic import, so they stay out of the main bundle.
 */

export type PassphraseLanguage = 'pl' | 'en';

export const DEFAULT_PASSPHRASE_LANGUAGE: PassphraseLanguage = 'pl';
export const WORDS_PER_PASSPHRASE = 7;
export const LIST_SIZE = 2048;
export const BITS_PER_WORD = 11; // log2(LIST_SIZE)

const UINT32_RANGE = 0x100000000;

interface WordListModule {
  WORDS: readonly string[];
}

const loaders: Record<PassphraseLanguage, () => Promise<WordListModule>> = {
  pl: () => import('./wordlists/pl'),
  en: () => import('./wordlists/en'),
};

const cache = new Map<PassphraseLanguage, readonly string[]>();

/** Loads (once) the word list for a language. */
export async function loadWordList(lang: PassphraseLanguage): Promise<readonly string[]> {
  const cached = cache.get(lang);
  if (cached) return cached;
  const { WORDS } = await loaders[lang]();
  if (WORDS.length !== LIST_SIZE) {
    throw new Error(`Word list "${lang}" has ${WORDS.length} words, expected ${LIST_SIZE}`);
  }
  cache.set(lang, WORDS);
  return WORDS;
}

/** Maps a UI language tag to a passphrase list; anything other than English falls back to the default (PL). */
export function passphraseLanguageForUi(uiLang: string | undefined | null): PassphraseLanguage {
  if (uiLang && uiLang.toLowerCase().startsWith('en')) return 'en';
  if (uiLang && uiLang.toLowerCase().startsWith('pl')) return 'pl';
  return DEFAULT_PASSPHRASE_LANGUAGE;
}

function secureUint32(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]!;
}

/**
 * Uniform random index in [0, max) using rejection sampling, so there is no modulo bias.
 * `nextUint32` must return integers in [0, 2^32).
 */
export function unbiasedIndex(max: number, nextUint32: () => number = secureUint32): number {
  if (!Number.isInteger(max) || max < 1 || max > UINT32_RANGE) {
    throw new RangeError(`max must be an integer in [1, 2^32], got ${max}`);
  }
  const limit = Math.floor(UINT32_RANGE / max) * max;
  for (;;) {
    const value = nextUint32();
    if (value < limit) return value % max;
  }
}

export interface PassphraseOptions {
  words?: number;
  lang?: PassphraseLanguage;
  /** Test seam: supplies raw uint32 values. Defaults to `crypto.getRandomValues`. */
  nextUint32?: () => number;
}

/** Returns `words` random words from the chosen list, separated by single spaces. */
export async function generatePassphrase(options: PassphraseOptions = {}): Promise<string> {
  const { words = WORDS_PER_PASSPHRASE, lang = DEFAULT_PASSPHRASE_LANGUAGE, nextUint32 = secureUint32 } = options;
  const list = await loadWordList(lang);
  const picked: string[] = [];
  for (let i = 0; i < words; i++) {
    picked.push(list[unbiasedIndex(list.length, nextUint32)]!);
  }
  return picked.join(' ');
}

/** Entropy of a generated passphrase in bits (before the KDF). */
export function passphraseEntropyBits(words: number = WORDS_PER_PASSPHRASE): number {
  return words * BITS_PER_WORD;
}
