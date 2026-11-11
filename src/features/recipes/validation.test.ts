import {
  emptyForm,
  emptyIngredientRow,
  hasErrors,
  moveItem,
  parseAmount,
  toRecipeFields,
  validate,
} from './validation';

describe('parseAmount', () => {
  it('handles blanks, commas and garbage', () => {
    expect(parseAmount('')).toBeUndefined();
    expect(parseAmount('1,5')).toBe(1.5);
    expect(parseAmount('.5')).toBe(0.5);
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmount('-2')).toBeNaN();
  });
});

describe('validate', () => {
  it('requires a title', () => {
    expect(validate(emptyForm()).title).toBe('recipes.error.titleRequired');
  });

  it('ignores blank ingredient rows but flags half-filled ones', () => {
    const form = { ...emptyForm(), title: 'Soup' };
    expect(hasErrors(validate(form))).toBe(false);
    const row = { ...emptyIngredientRow(), amount: 'x' };
    const errs = validate({ ...form, ingredients: [row] });
    expect(errs.ingredients[row.id]).toEqual({
      name: 'recipes.error.ingredientName',
      amount: 'recipes.error.amount',
    });
  });

  it('checks servings', () => {
    const form = { ...emptyForm(), title: 'x' };
    expect(validate({ ...form, servings: '0' }).servings).toBeDefined();
    expect(validate({ ...form, servings: '2.5' }).servings).toBeDefined();
    expect(validate({ ...form, servings: '4' }).servings).toBeUndefined();
  });
});

describe('toRecipeFields', () => {
  it('drops blanks and trims', () => {
    const form = {
      ...emptyForm(),
      title: '  Pierogi ',
      servings: '4',
      ingredients: [
        { ...emptyIngredientRow(), name: ' flour ', amount: '2,5', unit: 'glass' as const },
        emptyIngredientRow(),
      ],
    };
    const f = toRecipeFields(form);
    expect(f.title).toBe('Pierogi');
    expect(f.servings).toBe(4);
    expect(f.ingredients).toHaveLength(1);
    expect(f.ingredients[0]).toMatchObject({ name: 'flour', amount: 2.5, unit: 'glass' });
    expect(f.steps).toEqual([]);
    expect(f.categoryId).toBeUndefined();
  });
});

describe('moveItem', () => {
  it('reorders and ignores out-of-range moves', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
