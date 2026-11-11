import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { t, type StringKey } from '../../i18n';
import { saveTextFile, type ImportMode, type ImportReport } from '../../lib/backup';
import {
  BackupError,
  backupNow,
  getLastBackup,
  listRemoteBackups,
  restoreBackup,
  toBackupError,
  type BackupErrorKind,
  type BackupProgress,
  type LastBackup,
  type RemoteDevice,
  type RestoreProgress,
} from '../../lib/backup/github-backup';
import { loadKey } from '../../lib/crypto';
import type { GitHubConfig } from '../../lib/github';
import { getGitHubConfig, useKeyState } from '../settings';
import { KeepDailyField, KeepLastField, UnlockForm } from './BackupControls';
import { LocalBackup } from './LocalBackup';
import styles from './BackupPage.module.css';
import { SyncNow } from '../sync';

const ERROR_KEYS: Record<BackupErrorKind, StringKey> = {
  'not-configured': 'backup.error.not-configured',
  locked: 'backup.error.locked',
  'no-keycheck': 'backup.error.no-keycheck',
  'wrong-key': 'backup.error.wrong-key',
  corrupt: 'backup.error.corrupt',
  missing: 'backup.error.missing',
  unauthorized: 'backup.error.unauthorized',
  'token-expired': 'backup.error.token-expired',
  forbidden: 'backup.error.forbidden',
  conflict: 'backup.error.conflict',
  'rate-limited': 'backup.error.rate-limited',
  network: 'backup.error.network',
  unknown: 'backup.error.unknown',
};

type Progress = BackupProgress | RestoreProgress;
type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; progress?: Progress }
  | { kind: 'ok'; text: string; warning?: string }
  | { kind: 'error'; errorKind: BackupErrorKind };

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Config + key, or throws a BackupError the UI can show. */
async function prerequisites(): Promise<{ cfg: GitHubConfig; key: CryptoKey }> {
  const cfg = await getGitHubConfig();
  if (!cfg) throw new BackupError('not-configured', 'GitHub not configured');
  const key = await loadKey();
  if (!key) throw new BackupError('locked', 'No key');
  return { cfg, key };
}

/** GitHub backup + restore screen (T09). */
export function BackupPage() {
  const uid = useId();
  const { state: keyState } = useKeyState();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [last, setLast] = useState<LastBackup | null>(null);
  const [backupStatus, setBackupStatus] = useState<Status>({ kind: 'idle' });
  const [restoreStatus, setRestoreStatus] = useState<Status>({ kind: 'idle' });
  const [devices, setDevices] = useState<RemoteDevice[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge-add-missing');
  const [report, setReport] = useState<ImportReport | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([getGitHubConfig(), getLastBackup()]).then(([cfg, l]) => {
      if (!alive) return;
      setConfigured(cfg !== null);
      setLast(l);
    });
    return () => {
      alive = false;
    };
  }, []);

  const busy = backupStatus.kind === 'busy' || restoreStatus.kind === 'busy';
  const ready = configured === true && keyState === 'unlocked';
  const disabledReason: StringKey | null = busy
    ? 'backup.now.disabled.busy'
    : configured === false
      ? 'backup.now.disabled.notConfigured'
      : !ready && configured === true && keyState !== 'loading'
        ? 'backup.now.disabled.locked'
        : null;

  async function onBackup() {
    setBackupStatus({ kind: 'busy' });
    try {
      const { cfg, key } = await prerequisites();
      const res = await backupNow(cfg, key, {
        onProgress: (progress) => setBackupStatus({ kind: 'busy', progress }),
      });
      setLast(res);
      const pruned = res.pruned > 0 ? ` ${t('backup.now.prunedCount', { count: res.pruned })}` : '';
      setBackupStatus({
        kind: 'ok',
        text: `${t('backup.now.done')} ${t('backup.now.photosUploaded')} ${res.photosUploaded}${pruned}`,
        ...(res.pruneError ? { warning: t('backup.now.pruneFailed') } : {}),
      });
      if (devices) void loadList();
    } catch (e) {
      setBackupStatus({ kind: 'error', errorKind: toBackupError(e).kind });
    }
  }

  const loadList = useCallback(async () => {
    setRestoreStatus({ kind: 'busy' });
    setReport(null);
    try {
      const { cfg, key } = await prerequisites();
      const list = await listRemoteBackups(cfg, key);
      setDevices(list);
      setSelected((cur) =>
        cur && list.some((d) => d.backups.some((b) => b.path === cur)) ? cur : null,
      );
      setRestoreStatus({ kind: 'idle' });
    } catch (e) {
      setRestoreStatus({ kind: 'error', errorKind: toBackupError(e).kind });
    }
  }, []);

  async function onRestore() {
    if (!selected) {
      setRestoreStatus({ kind: 'ok', text: t('backup.restore.pick') });
      return;
    }
    setRestoreStatus({ kind: 'busy' });
    setReport(null);
    try {
      const { cfg, key } = await prerequisites();
      const r = await restoreBackup(cfg, key, selected, mode, {
        onProgress: (progress) => setRestoreStatus({ kind: 'busy', progress }),
      });
      setReport(r);
      setRestoreStatus({ kind: 'ok', text: t('backup.restore.done') });
    } catch (e) {
      setRestoreStatus({ kind: 'error', errorKind: toBackupError(e).kind });
    }
  }

  async function onSaveSafety() {
    if (report?.safetyExport) {
      await saveTextFile(report.safetyExport.json, report.safetyExport.fileName);
    }
  }

  return (
    <section className={styles.page} aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className={styles.title}>
        {t('backup.title')}
      </h2>

      {configured === null || keyState === 'loading' ? (
        <p role="status">{t('backup.loading')}</p>
      ) : !configured ? (
        <div className={styles.block}>
          <p className={styles.note} role="note">
            {t('backup.needGithub')}
          </p>
          <Link to="/settings/github" className={styles.secondary}>
            {t('backup.toGithub')}
          </Link>
        </div>
      ) : !ready ? (
        <UnlockForm errorKeys={ERROR_KEYS} />
      ) : null}

      <section className={styles.block} aria-labelledby={`${uid}-now`}>
        <h3 id={`${uid}-now`} className={styles.subtitle}>
          {t('backup.now.title')}
        </h3>
        <p className={styles.hint}>{t('backup.now.hint')}</p>
        <dl className={styles.facts} data-testid="last-backup">
          <dt>{t('backup.last.label')}</dt>
          <dd>{last ? formatDate(last.at) : t('backup.last.never')}</dd>
          {last && (
            <>
              <dt>{t('backup.last.size')}</dt>
              <dd>{formatSize(last.size)}</dd>
            </>
          )}
        </dl>
        <KeepLastField disabled={busy} />
        <KeepDailyField disabled={busy} />
        <button
          type="button"
          className={styles.primary}
          onClick={() => void onBackup()}
          disabled={busy || !ready}
        >
          {t('backup.now.button')}
        </button>
        {disabledReason && (
          <p className={styles.hint} data-testid="backup-disabled-reason">
            {t(disabledReason)}
          </p>
        )}
        <StatusView status={backupStatus} />
      </section>

      <section className={styles.block} aria-labelledby={`${uid}-sync`}>
        <h3 id={`${uid}-sync`} className={styles.subtitle}>
          {t('sync.title')}
        </h3>
        <SyncNow compact />
      </section>

      <section className={styles.block} aria-labelledby={`${uid}-restore`}>
        <h3 id={`${uid}-restore`} className={styles.subtitle}>
          {t('backup.restore.title')}
        </h3>
        <p className={styles.hint}>{t('backup.restore.hint')}</p>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => void loadList()}
          disabled={busy || !ready}
        >
          {devices ? t('backup.restore.reload') : t('backup.restore.load')}
        </button>

        {devices && devices.length === 0 && <p className={styles.hint}>{t('backup.restore.none')}</p>}

        {devices && devices.length > 0 && (
          <>
            {devices.map((d) => (
              <fieldset key={d.deviceId} className={styles.device}>
                <legend>
                  <strong>
                    {d.name ?? (d.unreadable ? t('backup.restore.unreadable') : t('backup.restore.unnamed'))}
                  </strong>{' '}
                  {d.isThisDevice && t('backup.restore.thisDevice')}
                </legend>
                <p className={styles.meta}>
                  {t('backup.restore.backupCount', { count: d.backups.length })} · {t('backup.restore.totalSize')}{' '}
                  {formatSize(d.totalSize)}
                </p>
                {d.backups.map((b) => (
                  <label key={b.path} className={styles.choice}>
                    <input
                      type="radio"
                      name={`${uid}-backup`}
                      value={b.path}
                      checked={selected === b.path}
                      onChange={() => setSelected(b.path)}
                      disabled={busy}
                    />
                    <span>
                      {b.createdAt ? formatDate(b.createdAt) : b.name}{' '}
                      <span className={styles.meta}>({formatSize(b.size)})</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}

            <fieldset className={styles.device}>
              <legend>{t('localBackup.mode.legend')}</legend>
              <label className={styles.choice}>
                <input
                  type="radio"
                  name={`${uid}-mode`}
                  checked={mode === 'merge-add-missing'}
                  onChange={() => setMode('merge-add-missing')}
                  disabled={busy}
                />
                <span>
                  <strong>{t('localBackup.mode.merge')}</strong>
                  <br />
                  {t('localBackup.mode.merge.hint')}
                </span>
              </label>
              <label className={styles.choice}>
                <input
                  type="radio"
                  name={`${uid}-mode`}
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                  disabled={busy}
                />
                <span>
                  <strong>{t('localBackup.mode.replace')}</strong>
                  <br />
                  {t('localBackup.mode.replace.hint')}
                </span>
              </label>
            </fieldset>
            {mode === 'replace' && (
              <p className={styles.warning} role="note">
                {t('localBackup.mode.replace.warning')}
              </p>
            )}
            <button
              type="button"
              className={styles.primary}
              onClick={() => void onRestore()}
              disabled={busy || !selected}
            >
              {mode === 'replace' ? t('backup.restore.button.replace') : t('backup.restore.button.merge')}
            </button>
          </>
        )}

        <StatusView status={restoreStatus} restore />

        {report && (
          <div className={styles.report} aria-label={t('localBackup.report.title')}>
            <h4 className={styles.subtitle}>{t('localBackup.report.title')}</h4>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th />
                  <th scope="col">{t('localBackup.report.added')}</th>
                  <th scope="col">{t('localBackup.report.skipped')}</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['localBackup.preview.recipes', report.recipes],
                    ['localBackup.preview.categories', report.categories],
                    ['localBackup.preview.tags', report.tags],
                    ['localBackup.preview.photos', report.photos],
                  ] as const
                ).map(([k, c]) => (
                  <tr key={k}>
                    <th scope="row">{t(k)}</th>
                    <td>{c.added}</td>
                    <td>{c.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.photos.missing.length + report.photos.invalid.length > 0 && (
              <p className={styles.warning}>
                {t('localBackup.report.photoProblems')}{' '}
                {report.photos.missing.length + report.photos.invalid.length}
              </p>
            )}
            {report.safetyExport && (
              <>
                <p className={styles.hint}>{t('localBackup.report.safetyHint')}</p>
                <button type="button" className={styles.secondary} onClick={() => void onSaveSafety()}>
                  {t('localBackup.report.safetyButton')}
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </section>
  );
}

function progressText(p: Progress, restore: boolean): { text: string; value?: number; max?: number } {
  switch (p.phase) {
    case 'prepare':
      return { text: t('backup.progress.prepare') };
    case 'photos':
      return {
        text: `${t(restore ? 'backup.progress.fetchPhotos' : 'backup.progress.photos')} ${p.done}/${p.total}`,
        value: p.done,
        max: p.total,
      };
    case 'upload':
      return { text: t('backup.progress.upload') };
    case 'finish':
      return { text: t('backup.progress.finish') };
    case 'prune':
      return { text: t('backup.progress.prune') };
    case 'download':
      return { text: t('backup.progress.download') };
    case 'import':
      return { text: t('backup.progress.import') };
  }
}

function StatusView({ status, restore = false }: { status: Status; restore?: boolean }) {
  if (status.kind === 'busy') {
    const p = status.progress ? progressText(status.progress, restore) : { text: t('backup.loading') };
    return (
      <div className={styles.status} role="status">
        <span>{p.text}</span>
        {p.max !== undefined && p.max > 0 && (
          <progress aria-label={t('backup.progress.label')} value={p.value} max={p.max} />
        )}
      </div>
    );
  }
  if (status.kind === 'ok') {
    return (
      <>
        <p className={styles.status} role="status">
          {status.text}
        </p>
        {status.warning && (
          <p className={styles.warning} role="note">
            {status.warning}
          </p>
        )}
      </>
    );
  }
  if (status.kind === 'error') {
    return (
      <p className={styles.error} role="alert">
        {t(ERROR_KEYS[status.errorKind])} {t('backup.error.unchanged')}
      </p>
    );
  }
  return null;
}

/** Settings → Backup (#71): GitHub backup/restore plus the local backup file, moved here from the side menu. */
export function BackupSettingsPage() {
  return (
    <div className={styles.page}>
      <BackupPage />
      <LocalBackup />
    </div>
  );
}
