import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { t, type StringKey } from '../../i18n';
import type { BackupErrorKind } from '../../lib/backup/github-backup';
import type { PeerSummary, SyncProgress, SyncResult } from '../../lib/sync/github';
import { getGitHubConfig, useKeyState } from '../settings';
import { runSync, useSyncStatus } from './syncState';
import styles from './sync.module.css';

export const SYNC_ERROR_KEYS: Record<BackupErrorKind, StringKey> = {
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

export function peerLabel(p: { peerId: string; name?: string }): string {
  return p.name || t('sync.peer.unnamed', { id: p.peerId.slice(0, 8) });
}

function progressText(p: SyncProgress | undefined): string {
  if (!p) return t('sync.progress.prepare');
  switch (p.phase) {
    case 'prepare':
      return t('sync.progress.prepare');
    case 'download':
      return t('sync.progress.download', { done: p.done, total: p.total });
    case 'photos':
      return t('sync.progress.photos', { done: p.done, total: p.total });
    case 'merge':
      return t('sync.progress.merge');
    case 'backup':
      return t('sync.progress.backup');
  }
}

/** "Kitchen iPad: 3 updated, 1 needs your choice" */
export function peerLine(p: PeerSummary): string {
  if (p.status !== 'synced') return `${peerLabel(p)}: ${t(`sync.peer.${p.status}`)}`;
  const parts: string[] = [];
  if (p.added) parts.push(t('sync.count.added', { count: p.added }));
  if (p.updated) parts.push(t('sync.count.updated', { count: p.updated }));
  if (p.conflicts) parts.push(t('sync.count.conflicts', { count: p.conflicts }));
  return `${peerLabel(p)}: ${parts.length ? parts.join(', ') : t('sync.peer.noChanges')}`;
}

function Summary({ result }: { result: SyncResult }) {
  return (
    <div className={styles.summary} role="status" data-testid="sync-summary">
      <p className={styles.ok}>{t('sync.done')}</p>
      {result.peers.length === 0 ? (
        <p className={styles.hint}>{t('sync.noPeers')}</p>
      ) : (
        <ul className={styles.peerList}>
          {result.peers.map((p) => (
            <li key={p.peerId}>{peerLine(p)}</li>
          ))}
        </ul>
      )}
      {result.photosDownloaded > 0 && (
        <p className={styles.hint}>
          {t('sync.photos.downloaded')} {result.photosDownloaded}
        </p>
      )}
      {result.photosMissing > 0 && (
        <p className={styles.warning}>
          {t('sync.photos.missing')} {result.photosMissing}
        </p>
      )}
      {result.backupError && (
        <p className={styles.warning} role="alert">
          {t('sync.backupFailed')} {t(SYNC_ERROR_KEYS[result.backupError])}
        </p>
      )}
    </div>
  );
}

/**
 * "Sync now" button with progress, summary and errors. Used on the Sync page and (compact: no hint,
 * no settings link, a link to the conflicts instead) on the Backup page.
 */
export function SyncNow({ compact = false }: { compact?: boolean }) {
  const status = useSyncStatus();
  const { state: keyState } = useKeyState();
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void getGitHubConfig().then((cfg) => alive && setConfigured(!!cfg));
    return () => {
      alive = false;
    };
  }, []);

  const busy = status.kind === 'busy';
  const disabledReason: StringKey | null =
    configured === false
      ? 'sync.disabled.notConfigured'
      : keyState === 'locked'
        ? 'sync.disabled.locked'
        : null;
  const ready = configured === true && keyState === 'unlocked';

  return (
    <div className={styles.now} data-testid="sync-now">
      {!compact && <p className={styles.hint}>{t('sync.hint')}</p>}
      <button
        type="button"
        className={styles.primary}
        onClick={() => void runSync()}
        disabled={busy || !ready}
      >
        {busy ? t('sync.now.working') : t('sync.now.button')}
      </button>
      {disabledReason && (
        <p className={styles.hint} data-testid="sync-disabled-reason">
          {t(disabledReason)}
          {!compact && (
            <>
              {' '}
              <Link to={configured === false ? '/settings/github' : '/settings/backup'}>
                {configured === false ? t('backup.toGithub') : t('nav.backup')}
              </Link>
            </>
          )}
        </p>
      )}
      {status.kind === 'busy' && (
        <p className={styles.hint} role="status" aria-live="polite">
          {progressText(status.progress)}
        </p>
      )}
      {status.kind === 'done' && <Summary result={status.result} />}
      {status.kind === 'error' && (
        <div className={styles.error} role="alert">
          <p>{t(SYNC_ERROR_KEYS[status.errorKind])}</p>
          <p>{t('backup.error.unchanged')}</p>
        </div>
      )}
      {status.kind === 'done' && status.result.peers.some((p) => p.conflicts > 0) && compact && (
        <Link to="/sync" className={styles.secondary}>
          {t('sync.conflicts.open')}
        </Link>
      )}
    </div>
  );
}
