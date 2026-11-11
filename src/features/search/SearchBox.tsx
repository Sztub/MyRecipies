import { t } from '../../i18n';
import styles from './search.module.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBox({ value, onChange }: Props) {
  return (
    <div className={styles.box}>
      <input
        type="search"
        className={styles.input}
        value={value}
        placeholder={t('search.placeholder')}
        aria-label={t('search.label')}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className={styles.clear}
          aria-label={t('search.clear')}
          onClick={() => onChange('')}
        >
          ×
        </button>
      )}
    </div>
  );
}
