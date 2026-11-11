import type { Recipe } from './types';

/** Lowercase, strip diacritics (incl. Polish ł/Ł, which has no decomposition), collapse spaces. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split a query into normalised words; empty array = no search. */
export function queryTokens(query: string): string[] {
  const n = normalizeText(query);
  return n ? n.split(' ') : [];
}

/**
 * True when every word of the query occurs in the recipe's title, an ingredient name,
 * a tag name or the category's displayed name.
 */
export function matchesRecipe(
  recipe: Pick<Recipe, 'title' | 'ingredients'>,
  extraTexts: string[],
  tokens: string[],
): boolean {
  if (tokens.length === 0) return true;
  const hay = normalizeText(
    [recipe.title, ...recipe.ingredients.map((i) => i.name), ...extraTexts].join('\n'),
  );
  return tokens.every((tok) => hay.includes(tok));
}
