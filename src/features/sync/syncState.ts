// App-wide sync run state (one run at a time, shared by the side menu badge, Sync page and Backup page)
// and the live open-conflict count.

import { liveQuery } from 'dexie';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { db } from '../../db';
import { BackupError, toBackupError, type BackupErrorKind } from '../../lib/backup/github-backup';
import { loadKey } from '../../lib/crypto';
import { syncWithGitHub, type SyncProgress, type SyncResult } from '../../lib/sync/github';
import { getGitHubConfig } from '../settings';

export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; progress?: SyncProgress }
  | { kind: 'done'; result: SyncResult }
  | { kind: 'error'; errorKind: BackupErrorKind };

let status: SyncStatus = { kind: 'idle' };
const listeners = new Set<() => void>();

function setStatus(s: SyncStatus): void {
  status = s;
  listeners.forEach((l) => l());
}

export function getSyncStatus(): SyncStatus {
  return status;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSyncStatus, getSyncStatus);
}

/** Test helper. */
export function resetSyncStatusForTests(): void {
  setStatus({ kind: 'idle' });
}

/** Runs one sync (no-op while one is running). Never throws; the outcome lands in the status. */
export async function runSync(): Promise<SyncStatus> {
  if (status.kind === 'busy') return status;
  setStatus({ kind: 'busy' });
  try {
    const cfg = await getGitHubConfig();
    if (!cfg) throw new BackupError('not-configured', 'GitHub not configured');
    const key = await loadKey();
    if (!key) throw new BackupError('locked', 'No key on this device');
    const result = await syncWithGitHub(cfg, key, {
      onProgress: (progress) => setStatus({ kind: 'busy', progress }),
    });
    setStatus({ kind: 'done', result });
  } catch (e) {
    setStatus({ kind: 'error', errorKind: toBackupError(e).kind });
  }
  return status;
}

/** Number of open sync conflicts; updates live (also across tabs). */
export function useConflictCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sub = liveQuery(() => db.syncConflicts.count()).subscribe({
      next: setCount,
      error: () => setCount(0),
    });
    return () => sub.unsubscribe();
  }, []);
  return count;
}
