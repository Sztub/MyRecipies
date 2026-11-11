import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { settings } from '../../db';
import { t, type StringKey } from '../../i18n';
import {
  MAX_KEEP_DAILY,
  MAX_KEEP_LAST,
  MIN_KEEP_LAST,
  getKeepDaily,
  getKeepLast, type BackupErrorKind } from '../../lib/backup/github-backup';
import styles from './BackupPage.module.css';
import { unlockWithPassphrase } from './unlock';

/** Inline passphrase form shown when GitHub is set up but this device has no key (T28). */
export function UnlockForm({ errorKeys }: { errorKeys: Record<BackupErrorKind, StringKey> }) {
  const uid = useId();
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!pass) {
      setError(t('backup.unlock.empty'));
      return;
    }
    setBusy(true);
    const res = await unlockWithPassphrase(pass);
    if (res.ok) {
      // The key-state listeners switch the page to "unlocked" and this form unmounts.
      setPass('');
      return;
    }
    setBusy(false);
    if (res.reason === 'wrong-passphrase') setError(t('backup.unlock.wrong'));
    else if (res.reason === 'no-keycheck') setError(t('backup.unlock.noKeycheck'));
    else setError(`${t('backup.unlock.failed')} ${t(errorKeys[res.reason])}`);
  }

  return (
    <form
      className={styles.block}
      aria-labelledby={`${uid}-title`}
      onSubmit={(e) => void onSubmit(e)}
      data-testid="backup-unlock"
    >
      <h3 id={`${uid}-title`} className={styles.subtitle}>
        {t('backup.unlock.title')}
      </h3>
      <p className={styles.hint}>{t('backup.unlock.hint')}</p>
      <div className={styles.field}>
        <label htmlFor={`${uid}-pass`}>{t('backup.unlock.passphrase')}</label>
        <input
          id={`${uid}-pass`}
          className={styles.input}
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={busy}
        />
      </div>
      <div className={styles.row}>
        <button type="submit" className={styles.primary} disabled={busy}>
          {busy ? t('backup.unlock.working') : t('backup.unlock.submit')}
        </button>
        <Link to="/settings/encryption" className={styles.secondary}>
          {t('backup.toEncryption')}
        </Link>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/** "Keep last N backups" (setting `backupKeepLast`, default 20). Saved as soon as the value is valid. */
export function KeepLastField({ disabled }: { disabled: boolean }) {
  const uid = useId();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void getKeepLast().then((n) => {
      if (!alive) return;
      setSaved(n);
      setValue(String(n));
    });
    return () => {
      alive = false;
    };
  }, []);

  function onChange(raw: string) {
    setValue(raw);
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isInteger(n) && n >= MIN_KEEP_LAST && n <= MAX_KEEP_LAST) {
      setSaved(n);
      void settings.set('backupKeepLast', n);
    }
  }

  return (
    <div className={styles.field}>
      <label htmlFor={`${uid}-keep`}>{t('backup.keep.label')}</label>
      <input
        id={`${uid}-keep`}
        className={styles.number}
        type="number"
        inputMode="numeric"
        min={MIN_KEEP_LAST}
        max={MAX_KEEP_LAST}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (saved !== null) setValue(String(saved));
        }}
        disabled={disabled || saved === null}
        aria-describedby={`${uid}-keep-hint`}
      />
      <p id={`${uid}-keep-hint`} className={styles.meta}>
        {t('backup.keep.hint')}
      </p>
    </div>
  );
}

/** "Also keep one backup per day for the last N days" (setting `backupKeepDaily`, 0 = off). */
export function KeepDailyField({ disabled }: { disabled: boolean }) {
  const uid = useId();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void getKeepDaily().then((n) => {
      if (!alive) return;
      setSaved(n);
      setValue(String(n));
    });
    return () => {
      alive = false;
    };
  }, []);

  function onChange(raw: string) {
    setValue(raw);
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= MAX_KEEP_DAILY) {
      setSaved(n);
      void settings.set('backupKeepDaily', n);
    }
  }

  return (
    <div className={styles.field}>
      <label htmlFor={`${uid}-daily`}>{t('backup.keepDaily.label')}</label>
      <input
        id={`${uid}-daily`}
        className={styles.number}
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_KEEP_DAILY}
        step={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (saved !== null) setValue(String(saved));
        }}
        disabled={disabled || saved === null}
        aria-describedby={`${uid}-daily-hint`}
      />
      <p id={`${uid}-daily-hint`} className={styles.meta}>
        {t('backup.keepDaily.hint')}
      </p>
    </div>
  );
}
