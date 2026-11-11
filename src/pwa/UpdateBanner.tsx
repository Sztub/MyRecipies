import { t } from '../i18n';
import styles from './UpdateBanner.module.css';
import { dismissUpdate, useUpdateState } from './updateStore';

export function UpdateBanner() {
  const { needRefresh, apply } = useUpdateState();
  if (!needRefresh) return null;
  return (
    <div className={styles.banner} role="status">
      <span className={styles.text}>{t('pwa.updateAvailable')}</span>
      <button type="button" className={styles.button} onClick={() => void apply?.()}>
        {t('pwa.reload')}
      </button>
      <button type="button" className={styles.button} onClick={dismissUpdate}>
        {t('pwa.later')}
      </button>
    </div>
  );
}
