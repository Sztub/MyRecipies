import { t } from '../../i18n';
import styles from './recipes.module.css';

const MAX = 99;

/** − / + control for the view-only servings count. */
export function ServingsStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className={styles.row} role="group" aria-label={t('recipes.servings')}>
      <button
        type="button"
        className={styles.btn}
        aria-label={t('recipes.servings.less')}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span aria-live="polite" data-testid="servings-value">
        {t('recipes.servingsCount', { count: value })}
      </span>
      <button
        type="button"
        className={styles.btn}
        aria-label={t('recipes.servings.more')}
        disabled={value >= MAX}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}
