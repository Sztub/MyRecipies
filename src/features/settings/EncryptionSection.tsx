import { useEffect, useId, useState, type FormEvent } from 'react';
import { getLanguage, t } from '../../i18n';
import {
  BackupError,
  createRepoKeyCheck,
  fetchKeyCheck,
  repoHasBackupData,
} from '../../lib/backup/github-backup';
import { WrongPassphraseError, createKeyCheck, storeKey, unlock } from '../../lib/crypto';
import { getGitHubConfig } from './githubConfig';
import { forgetKey, notifyKeyChanged, useKeyState } from './keyState';
import { generatePassphrase, loadWordList, passphraseLanguageForUi } from './passphrase';
import styles from './settings.module.css';

const MIN_LENGTH = 8;

type Message = { kind: 'ok' | 'error'; text: string };

export function EncryptionSection({ iterations }: { /** test hook: fewer PBKDF2 iterations */ iterations?: number }) {
  const uid = useId();
  const { state } = useKeyState();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  // Hidden by default (shoulder-surfing, screenshots, keyboards that learn typed words); shown after "Suggest".
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  // Fetch the passphrase word list while the section is shown, so "Suggest a passphrase" answers at once.
  useEffect(() => {
    void loadWordList(passphraseLanguageForUi(getLanguage())).catch(() => undefined);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (pass.length < MIN_LENGTH) {
      setMessage({ kind: 'error', text: t('settings.crypto.tooShort') });
      return;
    }
    const cfg = await getGitHubConfig();
    if (!cfg) {
      setMessage({ kind: 'error', text: t('settings.crypto.needGithub') });
      return;
    }
    setBusy(true);
    try {
      const keyCheck = await fetchKeyCheck(cfg);
      if (keyCheck) {
        const key = await unlock(pass, keyCheck);
        await storeKey(key);
        setMessage({ kind: 'ok', text: t('settings.crypto.unlocked') });
      } else {
        // No key check in the repo. Creating one is only safe on a repo without backups, and only when the user
        // meant it (typed the passphrase twice) - someone who came to unlock must not get a second, different key.
        const where = [`${cfg.owner}/${cfg.repo}`, cfg.basePath, `(${cfg.branch})`].filter(Boolean).join(' ');
        if (await repoHasBackupData(cfg)) {
          setMessage({ kind: 'error', text: t('settings.crypto.orphanData', { where }) });
          return;
        }
        if (!confirm) {
          setMessage({ kind: 'error', text: t('settings.crypto.noKeyCheck', { where }) });
          return;
        }
        if (pass !== confirm) {
          setMessage({ kind: 'error', text: t('settings.crypto.mismatch') });
          return;
        }
        const created = await createKeyCheck(pass, iterations ? { iterations } : {});
        await createRepoKeyCheck(cfg, created.keyCheck);
        await storeKey(created.key);
        setMessage({ kind: 'ok', text: t('settings.crypto.created') });
      }
      setPass('');
      setConfirm('');
      setShow(false);
      notifyKeyChanged();
    } catch (err) {
      if (err instanceof WrongPassphraseError) {
        setMessage({ kind: 'error', text: t('settings.crypto.wrong') });
      } else if (err instanceof BackupError && err.kind === 'corrupt') {
        setMessage({ kind: 'error', text: t('settings.crypto.badKeyCheck') });
      } else if (err instanceof BackupError && err.kind === 'conflict') {
        setMessage({ kind: 'error', text: t('settings.crypto.keyCheckAppeared') });
      } else if (err instanceof BackupError) {
        setMessage({ kind: 'error', text: t('settings.crypto.githubError') });
      } else {
        setMessage({ kind: 'error', text: t('settings.github.test.unknown') });
      }
    } finally {
      setBusy(false);
    }
  }

  async function suggest() {
    const p = await generatePassphrase({ lang: passphraseLanguageForUi(getLanguage()) });
    setPass(p);
    setConfirm(p);
    setShow(true); // it has to be written down on paper
  }

  return (
    <section className={styles.section} aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`}>{t('settings.crypto.title')}</h2>
      <p className={styles.warning} role="note">
        {t('settings.crypto.warning')}
      </p>
      <p role="status" data-testid="key-state" data-state={state}>
        {state === 'unlocked'
          ? t('settings.crypto.state.unlocked')
          : state === 'locked'
            ? t('settings.crypto.state.locked')
            : ''}
      </p>
      {state === 'unlocked' ? (
        <button type="button" className={styles.secondary} onClick={() => void forgetKey()}>
          {t('settings.crypto.forget')}
        </button>
      ) : (
        <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
          <p className={styles.hint}>{t('settings.crypto.suggest')}</p>
          <div className={styles.field}>
            <label htmlFor={`${uid}-pass`}>{t('settings.crypto.passphrase')}</label>
            <input
              id={`${uid}-pass`}
              className={styles.input}
              type={show ? 'text' : 'password'}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${uid}-confirm`}>{t('settings.crypto.confirm')}</label>
            <input
              id={`${uid}-confirm`}
              className={styles.input}
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
          <div className={styles.row}>
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? t('settings.crypto.working') : t('settings.crypto.submit')}
            </button>
            <button type="button" className={styles.secondary} onClick={suggest}>
              {t('settings.crypto.generate')}
            </button>
            <button
              type="button"
              className={styles.secondary}
              aria-pressed={show}
              onClick={() => setShow((v) => !v)}
            >
              {show ? t('settings.crypto.hide') : t('settings.crypto.show')}
            </button>
          </div>
        </form>
      )}
      {message && (
        <p className={message.kind === 'ok' ? styles.ok : styles.error} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}
