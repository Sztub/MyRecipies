/**
 * Plural forms as returned by Intl.PluralRules. `other` is required; Polish uses one/few/many/other
 * (1 jajko, 2 jajka, 5 jajek, 1,5 jajka), English one/other. `{count}` is replaced by the formatted number.
 */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Translation = string | PluralForms;

/** A full dictionary: every key of `en.ts` must be present (checked by the compiler and by i18n.test.ts). */
export type Dictionary = Record<import('./en').StringKey, Translation>;
