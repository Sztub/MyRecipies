import { RATINGS } from '../../domain/cooked';
import type { Rating } from '../../domain/types';
import { t } from '../../i18n';
import styles from './recipes.module.css';

/** Heart toggle (favourite). */
export function FavouriteButton({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.btn} ${value ? styles.chipOn : ''}`}
      aria-pressed={value}
      onClick={() => onChange(!value)}
    >
      <span aria-hidden="true">{value ? '♥' : '♡'}</span>&nbsp;{t('recipes.favourite')}
    </button>
  );
}

/** 1–5 stars; tapping the current rating clears it. */
export function StarRating({
  value,
  onChange,
}: {
  value: Rating | undefined;
  onChange: (v: Rating | null) => void;
}) {
  return (
    <div className={styles.row} role="radiogroup" aria-label={t('recipes.rating')}>
      {RATINGS.map((n) => {
        const on = value !== undefined && n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={t('recipes.rating.set', { n })}
            className={`${styles.star} ${on ? styles.starOn : ''}`}
            onClick={() => onChange(value === n ? null : n)}
          >
            <span aria-hidden="true">{on ? '★' : '☆'}</span>
          </button>
        );
      })}
    </div>
  );
}
