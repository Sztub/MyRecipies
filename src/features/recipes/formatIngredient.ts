import { scaleIngredient } from '../../domain/scale';
import type { Ingredient } from '../../domain/types';
import { formatNumber, unitLabel } from '../../i18n';

/**
 * One-line text of an ingredient ("2 łyżki cukru"). Shared by the detail page and cooking mode.
 * Pass `base` (recipe servings) and `servings` (wanted) to scale the amount; omit for the stored amount.
 */
export function formatIngredient(i: Ingredient, base?: number, servings?: number): string {
  const s = scaleIngredient(i, base, servings);
  const parts: string[] = [];
  if (s.amount !== undefined) parts.push(formatNumber(s.amount));
  if (s.unit === 'other' && s.note) parts.push(s.note);
  else if (s.unit && s.unit !== 'other') parts.push(unitLabel(s.unit, s.amount));
  if (s.unitText) parts.push(s.unitText);
  parts.push(s.name);
  return parts.join(' ');
}
