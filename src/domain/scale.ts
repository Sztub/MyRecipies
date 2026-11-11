import type { Ingredient, Unit } from './types';

/** Units whose amount never changes with servings. */
const FIXED_UNITS: readonly Unit[] = ['pinch', 'to_taste', 'other'];
const KITCHEN_UNITS: readonly Unit[] = ['tbsp', 'tsp', 'glass', 'pcs'];

function roundTo(value: number, step: number): number {
  const r = Math.round(value / step) * step;
  return r === 0 ? step : r; // never scale a real amount down to nothing
}

/** Rounds a scaled amount sensibly for its unit: kitchen units to ¼/½, g/ml to whole numbers, kg/l to 2 decimals. */
export function roundAmount(amount: number, unit?: Unit): number {
  if (!(amount > 0)) return amount;
  if (unit && KITCHEN_UNITS.includes(unit)) {
    return roundTo(amount, unit !== 'pcs' && amount < 1 ? 0.25 : 0.5);
  }
  if (unit === 'g' || unit === 'ml') return roundTo(amount, 1);
  if (unit === 'kg' || unit === 'l') return roundTo(amount, 0.01);
  return Math.round(amount * 100) / 100 || 0.01;
}

/** Scales one amount by `servings / base`. Returns the amount unchanged for fixed units or invalid input. */
export function scaleAmount(
  amount: number | undefined,
  unit: Unit | undefined,
  base: number | undefined,
  servings: number | undefined,
): number | undefined {
  if (amount === undefined) return undefined;
  if (unit && FIXED_UNITS.includes(unit)) return amount;
  if (!base || !servings || base <= 0 || servings <= 0 || base === servings) return amount;
  return roundAmount((amount * servings) / base, unit);
}

export function scaleIngredient(i: Ingredient, base?: number, servings?: number): Ingredient {
  const amount = scaleAmount(i.amount, i.unit, base, servings);
  return amount === i.amount ? i : { ...i, amount };
}
