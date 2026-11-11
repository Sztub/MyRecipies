import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { categories, recipes, tags } from '../../db';
import { UNITS, unitLabelKey } from '../../domain/units';
import type { Category, Recipe, Tag } from '../../domain/types';
import { categoryName, t } from '../../i18n';
import { PhotoPicker } from './photos';
import { recipeFlags } from './recipeFlags';
import styles from './recipes.module.css';
import { useLoad } from './useLoad';
import {
  emptyForm,
  emptyIngredientRow,
  emptyStepRow,
  formFromRecipe,
  hasErrors,
  moveItem,
  toRecipeFields,
  validate,
  type FormErrors,
  type FormState,
  type IngredientRow,
  type StepRow,
} from './validation';

export interface RecipeFormProps {
  initial: FormState;
  existing?: Recipe;
  cats: Category[];
  tagList: Tag[];
  onSaved: (r: Recipe) => void;
  onCancel: () => void;
}

/** The create/edit form (presentational + save; routing is done by the page wrapper). */
export function RecipeForm({
  initial,
  existing,
  cats,
  tagList,
  onSaved,
  onCancel,
}: RecipeFormProps) {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FormErrors | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allTags, setAllTags] = useState<Tag[]>(tagList);
  const [newTag, setNewTag] = useState('');

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const patchIng = (id: string, p: Partial<IngredientRow>) =>
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((i) => (i.id === id ? { ...i, ...p } : i)),
    }));
  const patchStep = (id: string, p: Partial<StepRow>) =>
    setForm((f) => ({ ...f, steps: f.steps.map((s) => (s.id === id ? { ...s, ...p } : s)) }));

  const toggleTag = (id: string) =>
    patch({
      tagIds: form.tagIds.includes(id) ? form.tagIds.filter((x) => x !== id) : [...form.tagIds, id],
    });

  const addTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    const found = allTags.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (found) {
      if (!form.tagIds.includes(found.id)) patch({ tagIds: [...form.tagIds, found.id] });
    } else {
      const created = await tags.save({ name });
      setAllTags((cur) => [...cur, created]);
      patch({ tagIds: [...form.tagIds, created.id] });
    }
    setNewTag('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate(form);
    setErrors(errs);
    if (hasErrors(errs)) return;
    setSaving(true);
    setSaveError(false);
    try {
      const fields = toRecipeFields(form);
      // The form does not edit favourite/rating/lastCookedAt (T46): carry the *current* stored values
      // over, otherwise a plain edit would wipe them (and later sync as a change).
      const cur = existing ? await recipes.get(existing.id) : undefined;
      const saved = await recipes.save(
        existing ? { ...fields, ...recipeFlags(cur ?? existing), id: existing.id } : fields,
      );
      onSaved(saved);
    } catch {
      setSaveError(true);
      setSaving(false);
    }
  };

  const err = (k?: string) =>
    k ? (
      <p className={styles.error} role="alert">
        {t(k as never)}
      </p>
    ) : null;

  return (
    <form className={styles.page} onSubmit={submit} noValidate>
      <h2 className={styles.heading}>
        {existing ? t('recipes.form.editTitle') : t('recipes.form.newTitle')}
      </h2>
      {errors && hasErrors(errors) && (
        <p className={styles.error} role="alert">
          {t('recipes.error.summary')}
        </p>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="r-title">
          {t('recipes.form.title')}
        </label>
        <input
          id="r-title"
          className={styles.input}
          value={form.title}
          aria-invalid={!!errors?.title}
          onChange={(e) => patch({ title: e.target.value })}
        />
        {err(errors?.title)}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="r-cat">
          {t('recipes.form.category')}
        </label>
        <select
          id="r-cat"
          className={styles.input}
          value={form.categoryId}
          onChange={(e) => patch({ categoryId: e.target.value })}
        >
          <option value="">{t('recipes.form.noCategory')}</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {categoryName(c)}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="r-serv">
          {t('recipes.form.servings')}
        </label>
        <input
          id="r-serv"
          className={styles.input}
          inputMode="numeric"
          value={form.servings}
          aria-invalid={!!errors?.servings}
          onChange={(e) => patch({ servings: e.target.value })}
        />
        {err(errors?.servings)}
      </div>

      <fieldset className={styles.group} aria-labelledby="r-tags-label">
        <div id="r-tags-label" className={styles.label}>
          {t('recipes.form.tags')}
        </div>
        <div className={styles.row}>
          {allTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={`${styles.chip} ${form.tagIds.includes(tag.id) ? styles.chipOn : ''}`}
              aria-pressed={form.tagIds.includes(tag.id)}
              onClick={() => toggleTag(tag.id)}
            >
              {tag.name}
            </button>
          ))}
        </div>
        <div className={styles.row}>
          <input
            className={styles.input}
            style={{ flex: 1 }}
            aria-label={t('recipes.form.newTag')}
            placeholder={t('recipes.form.newTag')}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addTag();
              }
            }}
          />
          <button type="button" className={styles.btn} onClick={() => void addTag()}>
            {t('recipes.form.addTag')}
          </button>
        </div>
      </fieldset>

      <fieldset className={styles.group} aria-labelledby="r-ingredients-label">
        <div id="r-ingredients-label" className={styles.label}>
          {t('recipes.form.ingredients')}
        </div>
        {form.ingredients.map((ing, idx) => {
          const e = errors?.ingredients[ing.id];
          const isOther = ing.unit === 'other';
          return (
            <div key={ing.id} className={styles.group} data-testid="ingredient-row">
              <div className={styles.ingLine}>
                <input
                  className={`${styles.input} ${styles.ingName}`}
                  aria-label={`${t('recipes.form.ingredientName')} ${idx + 1}`}
                  placeholder={t('recipes.form.ingredientName')}
                  aria-invalid={!!e?.name}
                  value={ing.name}
                  onChange={(ev) => patchIng(ing.id, { name: ev.target.value })}
                />
                <input
                  className={`${styles.input} ${styles.ingAmount}`}
                  inputMode="decimal"
                  aria-label={`${t('recipes.form.amount')} ${idx + 1}`}
                  placeholder={t('recipes.form.amount')}
                  aria-invalid={!!e?.amount}
                  value={ing.amount}
                  onChange={(ev) => patchIng(ing.id, { amount: ev.target.value })}
                />
                <select
                  className={`${styles.input} ${styles.ingUnit}`}
                  aria-label={`${t('recipes.form.unit')} ${idx + 1}`}
                  value={ing.unit}
                  onChange={(ev) =>
                    patchIng(ing.id, { unit: ev.target.value as IngredientRow['unit'] })
                  }
                >
                  <option value="">{t('recipes.form.noUnit')}</option>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {t(unitLabelKey(u))}
                    </option>
                  ))}
                </select>
              </div>
              {err(e?.name)}
              {err(e?.amount)}
              <div className={styles.ingLine}>
                <input
                  className={`${styles.input} ${styles.ingNote} ${isOther ? styles.needsNote : ''}`}
                  aria-label={`${t('recipes.form.note')} ${idx + 1}`}
                  aria-required={isOther}
                  placeholder={isOther ? t('recipes.form.noteOtherHint') : t('recipes.form.note')}
                  value={ing.note}
                  onChange={(ev) => patchIng(ing.id, { note: ev.target.value })}
                />
                <button
                  type="button"
                  className={`${styles.btn} ${styles.danger}`}
                  aria-label={`${t('recipes.form.removeIngredient')} ${idx + 1}`}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      ingredients:
                        f.ingredients.length > 1
                          ? f.ingredients.filter((i) => i.id !== ing.id)
                          : [emptyIngredientRow()],
                    }))
                  }
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          className={styles.btn}
          onClick={() =>
            setForm((f) => ({ ...f, ingredients: [...f.ingredients, emptyIngredientRow()] }))
          }
        >
          {t('recipes.form.addIngredient')}
        </button>
      </fieldset>

      <fieldset className={styles.group} aria-labelledby="r-steps-label">
        <div id="r-steps-label" className={styles.label}>
          {t('recipes.form.steps')}
        </div>
        {form.steps.map((step, idx) => (
          <div key={step.id} className={styles.group}>
            <textarea
              className={styles.input}
              rows={3}
              aria-label={`${t('recipes.form.step')} ${idx + 1}`}
              value={step.text}
              onChange={(ev) => patchStep(step.id, { text: ev.target.value })}
            />
            <div className={styles.row}>
              <button
                type="button"
                className={styles.btn}
                disabled={idx === 0}
                aria-label={`${t('recipes.form.moveUp')} ${idx + 1}`}
                onClick={() => setForm((f) => ({ ...f, steps: moveItem(f.steps, idx, idx - 1) }))}
              >
                ↑ {t('recipes.form.moveUp')}
              </button>
              <button
                type="button"
                className={styles.btn}
                disabled={idx === form.steps.length - 1}
                aria-label={`${t('recipes.form.moveDown')} ${idx + 1}`}
                onClick={() => setForm((f) => ({ ...f, steps: moveItem(f.steps, idx, idx + 1) }))}
              >
                ↓ {t('recipes.form.moveDown')}
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.danger}`}
                aria-label={`${t('recipes.form.removeStep')} ${idx + 1}`}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    steps:
                      f.steps.length > 1
                        ? f.steps.filter((s) => s.id !== step.id)
                        : [emptyStepRow()],
                  }))
                }
              >
                {t('recipes.form.removeStep')}
              </button>
            </div>
            <PhotoPicker
              value={step.photoHash ? [step.photoHash] : []}
              max={1}
              onChange={(h) => patchStep(step.id, { photoHash: h[0] })}
            />
          </div>
        ))}
        <button
          type="button"
          className={styles.btn}
          onClick={() => setForm((f) => ({ ...f, steps: [...f.steps, emptyStepRow()] }))}
        >
          {t('recipes.form.addStep')}
        </button>
      </fieldset>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="r-notes">
          {t('recipes.form.notes')}
        </label>
        <textarea
          id="r-notes"
          className={styles.input}
          rows={4}
          value={form.notes}
          onChange={(e) => patch({ notes: e.target.value })}
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>{t('recipes.form.photos')}</span>
        <PhotoPicker value={form.photoHashes} onChange={(h) => patch({ photoHashes: h })} />
      </div>

      {saveError && (
        <p className={styles.error} role="alert">
          {t('recipes.form.saveError')}
        </p>
      )}
      <div className={`${styles.row} ${styles.stickyActions}`}>
        <button type="submit" className={`${styles.btn} ${styles.primary}`} disabled={saving}>
          {t('recipes.form.save')}
        </button>
        <button type="button" className={styles.btn} onClick={onCancel}>
          {t('recipes.form.cancel')}
        </button>
      </div>
    </form>
  );
}

export function RecipeFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data } = useLoad(async () => {
    const [recipe, cats, tagList] = await Promise.all([
      id ? recipes.get(id) : Promise.resolve(undefined),
      categories.list(),
      tags.list(),
    ]);
    return { recipe, cats, tagList };
  });

  if (!data) return <p className={styles.muted}>{t('recipes.loading')}</p>;
  if (id && !data.recipe) {
    return (
      <section className={styles.page}>
        <p>{t('recipes.notFound')}</p>
        <Link to="/" className={styles.linkBtn}>
          {t('recipes.back')}
        </Link>
      </section>
    );
  }
  return (
    <RecipeForm
      initial={data.recipe ? formFromRecipe(data.recipe) : emptyForm()}
      existing={data.recipe}
      cats={data.cats}
      tagList={data.tagList}
      onSaved={(r) => navigate(`/recipes/${r.id}`)}
      onCancel={() => navigate(data.recipe ? `/recipes/${data.recipe.id}` : '/')}
    />
  );
}
