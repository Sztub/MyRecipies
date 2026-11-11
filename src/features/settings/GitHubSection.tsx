import { useEffect, useId, useState, type FormEvent } from 'react';
import { t, type StringKey } from '../../i18n';
import { testConnection, type GitHubErrorKind } from '../../lib/github';
import {
  formToConfig,
  loadGitHubForm,
  saveGitHubForm,
  validateGitHubForm,
  type GitHubForm,
  type GitHubFormErrors,
} from './githubConfig';
import styles from './settings.module.css';

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; writable: boolean }
  | { kind: 'error'; error: GitHubErrorKind };

const EMPTY: GitHubForm = { owner: '', repo: '', branch: 'main', basePath: '', token: '' };

/** A stored form that can be used as is: shown as a summary with an Edit button (#69). */
const isComplete = (f: GitHubForm) => Object.keys(validateGitHubForm(f)).length === 0;

export function GitHubSection({
  imported,
  onSaved,
}: {
  /** Non-secret values imported from a settings file; merged into the form. */
  imported?: Partial<Omit<GitHubForm, 'token'>> | undefined;
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<GitHubForm>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [errors, setErrors] = useState<GitHubFormErrors>({});
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestStatus>({ kind: 'idle' });
  // Last saved values: the summary shows them and Cancel goes back to them. null = nothing usable saved yet.
  const [stored, setStored] = useState<GitHubForm | null>(null);
  const [editing, setEditing] = useState(true);
  const uid = useId();

  useEffect(() => {
    let live = true;
    void loadGitHubForm().then((f) => {
      if (!live) return;
      setForm(f);
      setLoaded(true);
      if (isComplete(f)) {
        setStored(f);
        setEditing(false);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Apply a newly imported settings file (adjusting state during render, per React docs).
  const [seenImport, setSeenImport] = useState(imported);
  if (imported !== seenImport) {
    setSeenImport(imported);
    if (imported) {
      setForm((f) => ({ ...f, ...imported }));
      setSaved(false);
      setEditing(true);
    }
  }

  const set = (field: keyof GitHubForm) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
    setSaved(false);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validateGitHubForm(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    await saveGitHubForm(form);
    setStored(form);
    setEditing(false);
    setShowToken(false);
    setSaved(true);
    onSaved?.();
  }

  async function onTest() {
    const errs = validateGitHubForm(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setTest({ kind: 'busy' });
    const res = await testConnection(formToConfig(form));
    if (res.ok) setTest({ kind: 'ok', writable: res.permissions.push !== false });
    else setTest({ kind: 'error', error: res.error.kind });
  }

  function field(name: keyof GitHubForm, labelKey: StringKey, opts: { secret?: boolean } = {}) {
    const id = `${uid}-${name}`;
    const err = errors[name];
    const errId = `${id}-err`;
    return (
      <div className={styles.field}>
        <label htmlFor={id}>{t(labelKey)}</label>
        <div className={styles.row}>
          <input
            id={id}
            className={styles.input}
            type={opts.secret && !showToken ? 'password' : 'text'}
            value={form[name]}
            disabled={!loaded}
            onChange={set(name)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={err ? true : undefined}
            aria-describedby={err ? errId : undefined}
          />
          {opts.secret && (
            <button type="button" className={styles.secondary} onClick={() => setShowToken((s) => !s)}>
              {showToken ? t('settings.github.hideToken') : t('settings.github.showToken')}
            </button>
          )}
        </div>
        {err && (
          <p id={errId} className={styles.error} role="alert">
            {t(err === 'required' ? 'settings.error.required' : 'settings.error.invalid')}
          </p>
        )}
      </div>
    );
  }

  const testButton = (
    <button
      type="button"
      className={styles.secondary}
      disabled={test.kind === 'busy'}
      onClick={() => void onTest()}
    >
      {test.kind === 'busy' ? t('settings.github.testing') : t('settings.github.test')}
    </button>
  );

  const statusArea = (
    <div role="status" aria-live="polite">
      {saved && <p className={styles.ok}>{t('settings.github.saved')}</p>}
      {test.kind === 'ok' && (
        <p className={test.writable ? styles.ok : styles.error}>
          {test.writable ? t('settings.github.test.ok') : t('settings.github.test.okReadOnly')}
        </p>
      )}
      {test.kind === 'error' && (
        <p className={styles.error}>{t(`settings.github.test.${test.error}` as StringKey)}</p>
      )}
    </div>
  );

  if (!editing && stored) {
    return (
      <section className={styles.section} aria-labelledby={`${uid}-title`} data-testid="github-summary">
        <h2 id={`${uid}-title`}>{t('settings.github.title')}</h2>
        <p className={styles.ok}>{t('settings.github.summary')}</p>
        <dl className={styles.summary}>
          <dt>{t('settings.github.repo')}</dt>
          <dd>
            {stored.owner}/{stored.repo}
          </dd>
          <dt>{t('settings.github.branch')}</dt>
          <dd>{stored.branch}</dd>
          <dt>{t('settings.github.basePath')}</dt>
          <dd>{stored.basePath || t('settings.github.noFolder')}</dd>
          <dt>{t('settings.github.token')}</dt>
          <dd>{t('settings.github.tokenSaved')}</dd>
        </dl>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              setEditing(true);
              setSaved(false);
              setTest({ kind: 'idle' });
            }}
          >
            {t('settings.github.edit')}
          </button>
          {testButton}
        </div>
        {statusArea}
      </section>
    );
  }

  return (
    <section className={styles.section} aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`}>{t('settings.github.title')}</h2>
      <p className={styles.hint}>{t('settings.github.hint')}</p>
      <form className={styles.form} onSubmit={(e) => void onSubmit(e)} noValidate>
        {field('owner', 'settings.github.owner')}
        {field('repo', 'settings.github.repo')}
        {field('branch', 'settings.github.branch')}
        {field('basePath', 'settings.github.basePath')}
        {field('token', 'settings.github.token', { secret: true })}
        <div className={styles.row}>
          <button type="submit" className={styles.primary} disabled={!loaded}>
            {t('settings.github.save')}
          </button>
          {testButton}
          {stored && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setForm(stored);
                setErrors({});
                setTest({ kind: 'idle' });
                setShowToken(false);
                setEditing(false);
              }}
            >
              {t('settings.github.cancel')}
            </button>
          )}
        </div>
        {statusArea}
      </form>
    </section>
  );
}
