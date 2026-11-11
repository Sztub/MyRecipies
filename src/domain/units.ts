import type { StringKey } from '../i18n';
import type { Unit } from './types';

/** All units in display order. */
export const UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'pcs',
  'tbsp',
  'tsp',
  'glass',
  'pinch',
  'to_taste',
  'other',
] as const satisfies readonly Unit[];

// Compile-time check that UNITS lists every Unit.
type Missing = Exclude<Unit, (typeof UNITS)[number]>;
const allUnitsListed: Missing extends never ? true : false = true;
void allUnitsListed;

/** i18n key of the unit's short label (e.g. "tbsp"). */
export function unitLabelKey(unit: Unit): StringKey {
  return `unit.${unit}`;
}

/** i18n key of the unit's long name (e.g. "tablespoon"). */
export function unitNameKey(unit: Unit): StringKey {
  return `unit.${unit}.name`;
}

/** Approximate volume in ml for volume units (Polish kitchen conventions), else undefined. */
export const UNIT_ML: Partial<Record<Unit, number>> = {
  ml: 1,
  l: 1000,
  glass: 250,
  tbsp: 15,
  tsp: 5,
};

/** Units that normally have no amount (e.g. "salt to taste"). */
export function unitTakesAmount(unit: Unit): boolean {
  return unit !== 'to_taste';
}

export function isUnit(value: unknown): value is Unit {
  return typeof value === 'string' && (UNITS as readonly string[]).includes(value);
}
