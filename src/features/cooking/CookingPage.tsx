import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { recipes } from '../../db';
import { t } from '../../i18n';
import { formatIngredient } from '../recipes/formatIngredient';
import { ServingsStepper } from '../recipes/ServingsStepper';
import { PhotoView } from '../photos';
import { useLoad } from '../recipes/useLoad';
import { StepText, TimerBar } from '../timers';
import { markCookedToday } from '../recipes/recipeFlags';
import styles from './cooking.module.css';
import { useWakeLock } from './useWakeLock';

const SWIPE_PX = 50;

export function CookingPage() {
  const { id = '' } = useParams();
  const { data } = useLoad(() => recipes.get(id).then((r) => ({ recipe: r })));
  const [index, setIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [cooked, setCooked] = useState(false);
  const [wanted, setWanted] = useState<number | undefined>(undefined); // view-only, never saved
  const wake = useWakeLock();
  const start = useRef<{ x: number; y: number } | null>(null);

  if (!data) return <p className={styles.message}>{t('recipes.loading')}</p>;
  const recipe = data.recipe;
  if (!recipe) {
    return (
      <div className={styles.message}>
        <p>{t('recipes.notFound')}</p>
        <Link to="/" className={styles.btn}>
          {t('recipes.back')}
        </Link>
      </div>
    );
  }

  const total = recipe.steps.length;
  const last = Math.max(total - 1, 0);
  const current = Math.min(index, last);
  const step = recipe.steps[current];
  const go = (d: number) => setIndex(Math.min(Math.max(current + d, 0), last));

  const onPointerDown = (e: PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className={styles.root} data-ui="cooking">
      <header className={styles.bar}>
        <Link to={`/recipes/${recipe.id}`} className={styles.btn}>
          {t('cooking.exit')}
        </Link>
        <h1 className={styles.title}>{recipe.title}</h1>
        <button
          type="button"
          className={styles.btn}
          aria-expanded={showIngredients}
          onClick={() => setShowIngredients((v) => !v)}
        >
          {t('cooking.ingredients')}
        </button>
      </header>
      {wake !== 'active' && (
        <p role="status" className={styles.notice}>
          {t(wake === 'unsupported' ? 'cooking.wake.unsupported' : 'cooking.wake.failed')}
        </p>
      )}
      {showIngredients && (
        <section className={styles.panel} aria-label={t('cooking.ingredients')}>
          {recipe.servings !== undefined && (
            <ServingsStepper value={wanted ?? recipe.servings} onChange={setWanted} />
          )}
          <ul>
            {recipe.ingredients.map((i) => (
              <li key={i.id}>{formatIngredient(i, recipe.servings, wanted)}</li>
            ))}
          </ul>
        </section>
      )}
      <main
        className={styles.stepArea}
        data-ui="cooking-step"
        data-testid="cooking-step-area"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
        }}
      >
        {step ? (
          <>
            <p className={styles.counter} aria-live="polite" data-ui="cooking-counter">
              {t('cooking.stepOf', { n: current + 1, total })}
            </p>
            <p className={styles.stepText}>
              <StepText text={step.text} label={recipe.title} />
            </p>
            {current >= last && (
              cooked ? (
                <p role="status" className={styles.notice}>
                  {t('cooking.finished')}
                </p>
              ) : (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.primary}`}
                  onClick={() => void markCookedToday(recipe.id).then(() => setCooked(true))}
                >
                  {t('cooking.finish')}
                </button>
              )
            )}
            {step.photoHash && (
              <PhotoView
                key={step.photoHash}
                hash={step.photoHash}
                alt={step.text}
                className={styles.stepPhoto}
              />
            )}
          </>
        ) : (
          <p className={styles.stepText}>{t('cooking.noSteps')}</p>
        )}
      </main>
      <TimerBar cooking />
      <footer className={styles.nav}>
        <button type="button" className={styles.btn} disabled={current <= 0} onClick={() => go(-1)}>
          {t('cooking.prev')}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.primary}`}
          disabled={current >= last}
          onClick={() => go(1)}
        >
          {t('cooking.next')}
        </button>
      </footer>
    </div>
  );
}
