import { useState } from 'react';
import { t } from '../i18n';
import styles from '../features/settings/settings.module.css';
import { loadSampleRecipes } from './samples';

/** Dev-only Settings section (rendered only when `import.meta.env.DEV`). */
export default function SampleRecipesSection() {
  const [message, setMessage] = useState('');
  return (
    <section className={styles.section} aria-labelledby="settings-dev-samples">
      <h2 id="settings-dev-samples">{t('dev.samples.title')}</h2>
      <button
        type="button"
        className={styles.secondary}
        onClick={() =>
          void loadSampleRecipes().then((n) => setMessage(t('dev.samples.done', { count: n })))
        }
      >
        {t('dev.samples.load')}
      </button>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
