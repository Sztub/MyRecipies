import { lazy, Suspense, useEffect, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { getDeviceId, settings } from '../../db';
import { getLanguage, setLanguage, t, type StringKey } from '../../i18n';
import { saveTextFile } from '../../lib/backup/file';
import { getStorageEstimate, usePersistStatus } from '../../pwa';
import { useTheme } from '../../theme';
import { getLastBackup } from '../../lib/backup/github-backup';
import { PairingSection } from '../pairing';
import { EncryptionSection } from './EncryptionSection';
import { GitHubSection } from './GitHubSection';
import { LanguageSection } from './LanguageSection';
import { buildConfigFile, getGitHubConfig, loadGitHubForm, parseConfigFile, type GitHubForm } from './githubConfig';
import { useKeyState } from './keyState';
import styles from './settings.module.css';

// Dev-only (T29): the dynamic import sits behind a build-time constant, so it is dropped from production builds.
const DevSamples = import.meta.env.DEV ? lazy(() => import('../../dev/SampleRecipesSection')) : null;

function formatBytes(n: number | undefined): string {
  if (n === undefined) return t('settings.storage.unknown');
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function DeviceSection() {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  useEffect(() => {
    void settings.get('deviceName').then((n) => setName(n ?? ''));
    void getDeviceId().then(setId);
  }, []);
  return (
    <section className={styles.section} aria-labelledby="settings-device">
      <h2 id="settings-device">{t('settings.device.title')}</h2>
      <div className={styles.field}>
        <label htmlFor="settings-device-name">{t('settings.device.name')}</label>
        <input
          id="settings-device-name"
          className={styles.input}
          value={name}
          maxLength={100}
          onChange={(e) => {
            setName(e.target.value);
            void settings.set('deviceName', e.target.value);
          }}
        />
      </div>
      <p>
        {t('settings.device.id')}: <code>{id}</code>
      </p>
    </section>
  );
}

/**
 * Theme source of truth: localStorage via `useTheme()` (T11, needed synchronously to avoid a flash).
 * Every change is mirrored into the Dexie `theme`/`colorMode` settings so exports and backups see it.
 */
function AppearanceSection() {
  const { themes, modes, theme, mode, setTheme, setMode } = useTheme();
  useEffect(() => {
    void settings.set('theme', theme);
    void settings.set('colorMode', mode);
  }, [theme, mode]);
  return (
    <section className={styles.section} aria-labelledby="settings-appearance">
      <h2 id="settings-appearance">{t('settings.appearance.title')}</h2>
      <div className={styles.field}>
        <label htmlFor="settings-theme">{t('settings.appearance.theme')}</label>
        <select
          id="settings-theme"
          className={styles.input}
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
        >
          {themes.map((th) => (
            <option key={th.id} value={th.id}>
              {t(th.labelKey)}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.field}>
        <label htmlFor="settings-mode">{t('settings.appearance.mode')}</label>
        <select
          id="settings-mode"
          className={styles.input}
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          {modes.map((m) => (
            <option key={m} value={m}>
              {t(`theme.mode.${m}` as StringKey)}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

function StorageSection() {
  const { status, request } = usePersistStatus();
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number }>({});
  useEffect(() => {
    void getStorageEstimate().then(setEstimate);
  }, []);
  return (
    <section className={styles.section} aria-labelledby="settings-storage">
      <h2 id="settings-storage">{t('settings.storage.title')}</h2>
      <p>
        {t('settings.storage.persist')}: {status ? t(`settings.storage.${status}` as StringKey) : ''}
      </p>
      {status === 'not-persisted' && (
        <button type="button" className={styles.secondary} onClick={() => void request()}>
          {t('settings.storage.request')}
        </button>
      )}
      <p>
        {t('settings.storage.usage')}: {formatBytes(estimate.usage)}
        {estimate.quota !== undefined ? ` / ${formatBytes(estimate.quota)}` : ''}
      </p>
    </section>
  );
}

function ConfigFileSection({ onImport }: { onImport: (v: Omit<GitHubForm, 'token'>) => void }) {
  const theme = useTheme();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function doExport() {
    const form = await loadGitHubForm();
    const deviceName = (await settings.get('deviceName')) ?? '';
    const text = buildConfigFile({ form, deviceName, theme: theme.theme, colorMode: theme.mode, language: getLanguage() });
    await saveTextFile(text, 'recipes-settings.json');
  }

  async function doImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const cfg = parseConfigFile(await file.text());
    if (!cfg) {
      setMessage({ ok: false, text: t('settings.config.invalid') });
      return;
    }
    if (cfg.deviceName !== undefined) await settings.set('deviceName', cfg.deviceName);
    if (cfg.theme && theme.themes.some((th) => th.id === cfg.theme)) theme.setTheme(cfg.theme);
    if (cfg.colorMode) theme.setMode(cfg.colorMode);
    if (cfg.language) setLanguage(cfg.language);
    if (cfg.github) onImport(cfg.github);
    setMessage({ ok: true, text: t('settings.config.imported') });
  }

  return (
    <section className={styles.section} aria-labelledby="settings-config">
      <h2 id="settings-config">{t('settings.config.title')}</h2>
      <p className={styles.hint}>{t('settings.config.hint')}</p>
      <div className={styles.row}>
        <button type="button" className={styles.secondary} onClick={() => void doExport()}>
          {t('settings.config.export')}
        </button>
        <label className={styles.secondary}>
          {t('settings.config.import')}
          <input
            type="file"
            accept="application/json,.json"
            className={styles.fileInput}
            onChange={(e) => void doImport(e)}
          />
        </label>
      </div>
      {message && (
        <p className={message.ok ? styles.ok : styles.error} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}

/** Status line under each sub-screen link on the Settings home page. */
function useScreenStatus() {
  const { state: keyState } = useKeyState();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [last, setLast] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void Promise.all([getGitHubConfig(), getLastBackup()]).then(([cfg, l]) => {
      if (!alive) return;
      setConfigured(cfg !== null);
      setLast(l?.at ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);
  return {
    github:
      configured === null ? '' : t(configured ? 'settings.status.configured' : 'settings.status.notConfigured'),
    crypto:
      keyState === 'unlocked'
        ? t('settings.status.unlocked')
        : keyState === 'locked'
          ? t('settings.status.locked')
          : '',
    backup:
      last === undefined
        ? ''
        : last === null
          ? t('settings.status.noBackup')
          : t('settings.status.lastBackup', { date: new Date(last).toLocaleString() }),
    pairing: t('settings.status.pairing'),
  };
}

const SCREENS = [
  { to: '/settings/github', label: 'settings.github.title', status: 'github' },
  { to: '/settings/encryption', label: 'settings.crypto.title', status: 'crypto' },
  { to: '/settings/backup', label: 'backup.title', status: 'backup' },
  { to: '/settings/pairing', label: 'pairing.title', status: 'pairing' },
] as const;

function ScreensSection() {
  const status = useScreenStatus();
  return (
    <section className={styles.section} aria-labelledby="settings-screens">
      <h2 id="settings-screens">{t('settings.screens.title')}</h2>
      <ul className={styles.screenList}>
        {SCREENS.map((s) => (
          <li key={s.to}>
            <Link to={s.to} className={styles.screenLink}>
              <span className={styles.screenText}>
                <span className={styles.screenLabel}>{t(s.label)}</span>
                <span className={styles.hint} data-testid={`screen-status-${s.status}`}>
                  {status[s.status]}
                </span>
              </span>
              <span aria-hidden="true">›</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Settings home (#71): everyday choices on top, GitHub / encryption / backups / second device on sub-screens. */
export function SettingsPage() {
  return (
    <div className={styles.page}>
      <h2>{t('settings.title')}</h2>
      <LanguageSection />
      <AppearanceSection />
      <ScreensSection />
      <DeviceSection />
      <StorageSection />
      {DevSamples && <Suspense><DevSamples /></Suspense>}
    </div>
  );
}

/** Settings → GitHub backup: connection form (summary once set up, #69) + settings file. */
export function GitHubSettingsPage() {
  const [imported, setImported] = useState<Omit<GitHubForm, 'token'> | undefined>();
  return (
    <div className={styles.page}>
      <GitHubSection imported={imported} />
      <ConfigFileSection onImport={setImported} />
    </div>
  );
}

/** Settings → Encryption. */
export function EncryptionSettingsPage() {
  return (
    <div className={styles.page}>
      <EncryptionSection />
    </div>
  );
}

/** Settings → Second device (QR pairing, T44). */
export function PairingSettingsPage() {
  return (
    <div className={styles.page}>
      <PairingSection />
    </div>
  );
}
