import { cookedAgo, isRating, recipeFlags, todayIso } from './cooked';

const NOW = new Date(2026, 10, 10, 15, 0); // 10 Nov 2026, local

describe('todayIso', () => {
  it('uses the local calendar day, zero-padded', () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('cookedAgo', () => {
  it.each([
    ['2026-11-10', { unit: 'today' }],
    ['2026-11-11', { unit: 'today' }], // clock skew: future = today
    ['2026-11-09', { unit: 'yesterday' }],
    ['2026-11-07', { unit: 'days', count: 3 }],
    ['2026-10-30', { unit: 'days', count: 11 }],
    ['2026-10-20', { unit: 'weeks', count: 3 }],
    ['2026-09-15', { unit: 'weeks', count: 8 }],
    ['2026-07-10', { unit: 'months', count: 4 }],
    ['2025-11-10', { unit: 'years', count: 1 }],
    ['2022-01-01', { unit: 'years', count: 4 }],
  ])('%s', (iso, expected) => {
    expect(cookedAgo(iso, NOW)).toEqual(expected);
  });

  it('accepts a full ISO timestamp and rejects junk / missing', () => {
    expect(cookedAgo('2026-11-09T08:00:00.000Z', NOW)).toEqual({ unit: 'yesterday' });
    expect(cookedAgo('soon', NOW)).toBeUndefined();
    expect(cookedAgo(undefined, NOW)).toBeUndefined();
  });
});

describe('rating / flags', () => {
  it('isRating accepts 1..5 only', () => {
    expect([0, 1, 5, 6, 2.5, '3', undefined].map(isRating)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('recipeFlags drops unset values', () => {
    expect(recipeFlags({ favourite: false })).toEqual({});
    expect(recipeFlags({ favourite: true, rating: 4, lastCookedAt: '2026-11-01' })).toEqual({
      favourite: true,
      rating: 4,
      lastCookedAt: '2026-11-01',
    });
  });
});
