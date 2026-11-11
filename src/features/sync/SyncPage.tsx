import { useId } from 'react';
import { t } from '../../i18n';
import { ConflictList } from './ConflictList';
import { SyncNow } from './SyncNow';
import styles from './sync.module.css';

export function SyncPage() {
  const uid = useId();
  return (
    <section className={styles.page} aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className={styles.title}>
        {t('sync.title')}
      </h2>
      <section className={styles.block} aria-label={t('sync.now.button')}>
        <SyncNow />
      </section>
      <section className={styles.block} aria-labelledby={`${uid}-conf`}>
        <h3 id={`${uid}-conf`} className={styles.subtitle}>
          {t('sync.conflicts.title')}
        </h3>
        <ConflictList />
      </section>
    </section>
  );
}
