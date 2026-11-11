import { setLanguage } from '../../i18n';
import { formatIngredient } from './formatIngredient';

const spoon = { id: 'a', name: 'cukru', amount: 1, unit: 'tbsp' as const };

describe('formatIngredient (Polish plurals of scaled amounts)', () => {
  beforeEach(() => setLanguage('pl'));
  afterAll(() => setLanguage('pl'));
  it('uses the right plural form', () => {
    expect(formatIngredient(spoon)).toBe('1 łyżka cukru');
    expect(formatIngredient(spoon, 2, 4)).toBe('2 łyżki cukru');
    expect(formatIngredient(spoon, 1, 5)).toBe('5 łyżek cukru');
    expect(formatIngredient(spoon, 2, 3)).toBe('1,5 łyżki cukru');
  });
  it('leaves unscaled output alone without servings', () => {
    expect(formatIngredient({ id: 'b', name: 'sól', unit: 'to_taste' })).toBe('do smaku sól');
  });
});
