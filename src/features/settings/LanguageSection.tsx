import { LANGUAGES, isLanguage, setLanguage, t, useLanguage, type StringKey } from '../../i18n';
import styles from './settings.module.css';

/** Language picker (T21). Polish is the default; the choice is persisted and applied on reload. */
export function LanguageSection() {
  const lang = useLanguage();
  return (
    <section className={styles.section} aria-labelledby="settings-language">
      <h2 id="settings-language">{t('settings.language.title')}</h2>
      <div className={styles.field}>
        <label htmlFor="settings-language-select">{t('settings.language.label')}</label>
        <select
          id="settings-language-select"
          className={styles.input}
          value={lang}
          onChange={(e) => {
            if (isLanguage(e.target.value)) setLanguage(e.target.value);
          }}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l} lang={l}>
              {t(`language.${l}` as StringKey)}
            </option>
          ))}
        </select>
        <p className={styles.hint}>{t('settings.language.hint')}</p>
      </div>
    </section>
  );
}
