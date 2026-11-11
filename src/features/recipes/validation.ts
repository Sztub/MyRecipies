import { newId } from '../../domain/ids';
import { isUnit } from '../../domain/units';
import type { Ingredient, Recipe, Step, Unit, UUID } from '../../domain/types';
import type { StringKey } from '../../i18n';

export interface IngredientRow {
  id: UUID;
  name: string;
  amount: string;
  unit: Unit | '';
  unitText: string;
  note: string;
}

export interface StepRow {
  id: UUID;
  text: string;
  photoHash?: string;
}

export interface FormState {
  title: string;
  categoryId: UUID | '';
  tagIds: UUID[];
  servings: string;
  ingredients: IngredientRow[];
  steps: StepRow[];
  notes: string;
  photoHashes: string[];
}

export interface FormErrors {
  title?: StringKey;
  servings?: StringKey;
  /** keyed by ingredient row id */
  ingredients: Record<string, { name?: StringKey; amount?: StringKey }>;
}

export const emptyIngredientRow = (): IngredientRow => ({
  id: newId(),
  name: '',
  amount: '',
  unit: '',
  unitText: '',
  note: '',
});

export const emptyStepRow = (): StepRow => ({ id: newId(), text: '' });

export function emptyForm(): FormState {
  return {
    title: '',
    categoryId: '',
    tagIds: [],
    servings: '',
    ingredients: [emptyIngredientRow()],
    steps: [emptyStepRow()],
    notes: '',
    photoHashes: [],
  };
}

export function formFromRecipe(r: Recipe): FormState {
  return {
    title: r.title,
    categoryId: r.categoryId ?? '',
    tagIds: [...r.tagIds],
    servings: r.servings === undefined ? '' : String(r.servings),
    ingredients: r.ingredients.length
      ? r.ingredients.map((i) => ({
          id: i.id,
          name: i.name,
          amount: i.amount === undefined ? '' : String(i.amount),
          unit: i.unit ?? '',
          unitText: i.unitText ?? '',
          note: i.note ?? '',
        }))
      : [emptyIngredientRow()],
    steps: r.steps.length
      ? r.steps.map((s) => ({ id: s.id, text: s.text, photoHash: s.photoHash }))
      : [emptyStepRow()],
    notes: r.notes ?? '',
    photoHashes: [...r.photoHashes],
  };
}

/** Parses "1,5" or "1.5"; returns undefined for blank, NaN for garbage/negative. */
export function parseAmount(raw: string): number | undefined {
  const s = raw.trim().replace(',', '.');
  if (s === '') return undefined;
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  return Number(s);
}

const isBlankIngredient = (i: IngredientRow) =>
  !i.name.trim() && !i.amount.trim() && !i.unitText.trim() && !i.note.trim();

export function validate(form: FormState): FormErrors {
  const errors: FormErrors = { ingredients: {} };
  if (!form.title.trim()) errors.title = 'recipes.error.titleRequired';
  if (form.servings.trim()) {
    const n = Number(form.servings.trim());
    if (!Number.isInteger(n) || n < 1) errors.servings = 'recipes.error.servings';
  }
  for (const row of form.ingredients) {
    if (isBlankIngredient(row)) continue;
    const e: { name?: StringKey; amount?: StringKey } = {};
    if (!row.name.trim()) e.name = 'recipes.error.ingredientName';
    if (Number.isNaN(parseAmount(row.amount))) e.amount = 'recipes.error.amount';
    if (e.name || e.amount) errors.ingredients[row.id] = e;
  }
  return errors;
}

export function hasErrors(e: FormErrors): boolean {
  return !!e.title || !!e.servings || Object.keys(e.ingredients).length > 0;
}

export type RecipeFields = Omit<
  Recipe,
  'id' | 'createdAt' | 'updatedAt' | 'deviceId' | 'rev' | 'deleted'
>;

/** Converts a validated form into the recipe fields (blank rows dropped). */
export function toRecipeFields(form: FormState): RecipeFields {
  const ingredients: Ingredient[] = form.ingredients
    .filter((i) => !isBlankIngredient(i))
    .map((i) => {
      const amount = parseAmount(i.amount);
      const out: Ingredient = { id: i.id, name: i.name.trim() };
      if (amount !== undefined) out.amount = amount;
      if (i.unit && isUnit(i.unit)) out.unit = i.unit;
      if (i.unitText.trim()) out.unitText = i.unitText.trim();
      if (i.note.trim()) out.note = i.note.trim();
      return out;
    });
  const steps: Step[] = form.steps
    .filter((s) => s.text.trim())
    .map((s) => ({
      id: s.id,
      text: s.text.trim(),
      ...(s.photoHash ? { photoHash: s.photoHash } : {}),
    }));
  const fields: RecipeFields = {
    title: form.title.trim(),
    tagIds: form.tagIds,
    ingredients,
    steps,
    photoHashes: form.photoHashes,
  };
  if (form.categoryId) fields.categoryId = form.categoryId;
  if (form.servings.trim()) fields.servings = Number(form.servings.trim());
  if (form.notes.trim()) fields.notes = form.notes.trim();
  return fields;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
