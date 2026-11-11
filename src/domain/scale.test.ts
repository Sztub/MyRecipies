import { scaleAmount, roundAmount, scaleIngredient } from './scale';

describe('scaling', () => {
  it('scales grams to whole numbers', () => {
    expect(scaleAmount(250, 'g', 4, 6)).toBe(375);
    expect(scaleAmount(100, 'g', 3, 4)).toBe(133);
  });
  it('rounds kitchen units to quarters below 1 and halves above', () => {
    expect(scaleAmount(1, 'tsp', 4, 3)).toBe(0.75);
    expect(scaleAmount(1, 'tbsp', 4, 6)).toBe(1.5);
    expect(scaleAmount(1, 'glass', 3, 4)).toBe(1.5);
    expect(scaleAmount(1, 'pcs', 4, 1)).toBe(0.5);
  });
  it('never rounds a real amount down to zero', () => {
    expect(roundAmount(0.01, 'g')).toBe(1);
    expect(roundAmount(0.05, 'tsp')).toBe(0.25);
  });
  it('keeps pinch / to_taste / other unchanged', () => {
    expect(scaleAmount(1, 'pinch', 2, 8)).toBe(1);
    expect(scaleAmount(2, 'to_taste', 2, 8)).toBe(2);
    expect(scaleAmount(3, 'other', 2, 8)).toBe(3);
  });
  it('is a no-op for missing amount, equal or invalid servings', () => {
    expect(scaleAmount(undefined, 'g', 2, 4)).toBeUndefined();
    expect(scaleAmount(5, 'g', 2, 2)).toBe(5);
    expect(scaleAmount(5, 'g', undefined, 4)).toBe(5);
    expect(scaleAmount(5, 'g', 0, 4)).toBe(5);
  });
  it('scales unitless amounts to 2 decimals and keeps the ingredient object when unchanged', () => {
    expect(scaleAmount(1, undefined, 3, 1)).toBe(0.33);
    const i = { id: 'a', name: 'x', amount: 1, unit: 'pinch' as const };
    expect(scaleIngredient(i, 2, 4)).toBe(i);
  });
});
