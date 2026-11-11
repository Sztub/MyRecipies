import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { categories, recipes, tags } from '../../db';
import { categoryName, t } from '../../i18n';
import { formatIngredient } from './formatIngredient';
import { ServingsStepper } from './ServingsStepper';
import { PhotoView } from './photos';
import styles from './recipes.module.css';
import { useLoad } from './useLoad';
import { StepText } from '../timers';
import { cookedAgoLabel } from './cookedLabel';
import { FavouriteButton, StarRating } from './FlagControls';
import { markCookedToday, updateFlags } from './recipeFlags';
import { ConfirmDialog } from './ConfirmDialog';
import { Crest, PageCorners, Sprig } from '../../theme';

export function RecipeDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [wanted, setWanted] = useState<number | undefined>(undefined); // view-only, never saved
  const { data, reload } = useLoad(async () => {
    const [recipe, cats, tg] = await Promise.all([recipes.get(id), categories.list(), tags.list()]);
    return { recipe, cats, tg };
  });

  if (!data) return <p className={styles.muted}>{t('recipes.loading')}</p>;
  const { recipe } = data;
  if (!recipe) {
    return (
      <section className={styles.page}>
        <p>{t('recipes.notFound')}</p>
        <Link to="/" className={styles.linkBtn}>
          {t('recipes.back')}
        </Link>
      </section>
    );
  }
  const servings = wanted;
  const category = data.cats.find((c) => c.id === recipe.categoryId);
  const recipeTags = data.tg.filter((x) => recipe.tagIds.includes(x.id));

  const doDelete = async () => {
    await recipes.softDelete(recipe.id);
    navigate('/');
  };

  return (
    <article className={styles.page} data-ui="sheet">
      <PageCorners />
      <Sprig />
      <Crest />
      <h2 className={styles.heading} data-ui="sheet-title">
        {recipe.title}
      </h2>
      <p className={styles.muted} data-ui="sheet-meta">
        {[category && categoryName(category), ...recipeTags.map((x) => x.name)]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <div className={styles.row}>
        <FavouriteButton
          value={recipe.favourite === true}
          onChange={(favourite) => void updateFlags(recipe.id, { favourite }).then(reload)}
        />
        <StarRating
          value={recipe.rating}
          onChange={(rating) => void updateFlags(recipe.id, { rating }).then(reload)}
        />
      </div>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.btn}
          onClick={() => void markCookedToday(recipe.id).then(reload)}
        >
          {t('recipes.cookedToday')}
        </button>
        {recipe.lastCookedAt && (
          <span className={styles.muted} data-testid="last-cooked">
            {t('recipes.lastCooked', { when: cookedAgoLabel(recipe.lastCookedAt) ?? '' })}
          </span>
        )}
      </div>
      {recipe.servings !== undefined && (
        <ServingsStepper value={servings ?? recipe.servings} onChange={setWanted} />
      )}
      {recipe.photoHashes.map((h) => (
        <div key={h} data-ui="photo">
          <PhotoView hash={h} alt={recipe.title} className={styles.photo} />
        </div>
      ))}

      {recipe.ingredients.length > 0 && (
        <section>
          <h3 className={styles.sectionHeading} data-ui="section-heading">
            {t('recipes.ingredients')}
          </h3>
          <ul className={styles.list}>
            {recipe.ingredients.map((i) => (
              <li key={i.id}>
                {formatIngredient(i, recipe.servings, servings)}
                {i.note && i.unit !== 'other' && <span className={styles.muted}> ({i.note})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {recipe.steps.length > 0 && (
        <section>
          <h3 className={styles.sectionHeading} data-ui="section-heading">
            {t('recipes.steps')}
          </h3>
          <ol className={styles.steps}>
            {recipe.steps.map((s) => (
              <li key={s.id}>
                <StepText text={s.text} label={recipe.title} />
                {s.photoHash && (
                  <PhotoView hash={s.photoHash} alt={s.text} className={styles.stepPhoto} />
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {recipe.notes && (
        <section>
          <h3 className={styles.sectionHeading} data-ui="section-heading">
            {t('recipes.notes')}
          </h3>
          <p style={{ whiteSpace: 'pre-wrap' }} data-ui="prose">
            {recipe.notes}
          </p>
        </section>
      )}

      <div className={styles.row} data-ui="sheet-actions">
        {recipe.steps.length > 0 && (
          <Link to={`/recipes/${recipe.id}/cook`} className={`${styles.linkBtn} ${styles.primary}`}>
            {t('cooking.start')}
          </Link>
        )}
        <Link to={`/recipes/${recipe.id}/edit`} className={`${styles.linkBtn} ${styles.primary}`}>
          {t('recipes.edit')}
        </Link>
        <button
          type="button"
          className={`${styles.btn} ${styles.danger}`}
          onClick={() => setConfirming(true)}
        >
          {t('recipes.delete')}
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          message={t('recipes.delete.confirm')}
          confirmLabel={t('recipes.delete.confirmYes')}
          cancelLabel={t('recipes.delete.cancel')}
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </article>
  );
}
