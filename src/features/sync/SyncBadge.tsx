import { t } from '../../i18n';
import { useConflictCount } from './syncState';
import styles from './sync.module.css';

/** Small count bubble next to the "Sync" menu entry while conflicts are open. */
export function SyncBadge() {
  const count = useConflictCount();
  if (count === 0) return null;
  return (
    <span className={styles.badge} data-testid="sync-badge">
      <span aria-hidden="true">{count}</span>
      <span className={styles.srOnly}>{t('sync.badge', { count })}</span>
    </span>
  );
}
