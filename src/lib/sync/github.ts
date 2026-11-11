// Two-way sync over the GitHub data repo (T43) – see docs/HOW-IT-WORKS.md "Sync between devices".
//
//   verify key → list devices/* → for every OTHER device download latest.enc (+ device.json.enc for its
//   name) → download photos those bundles reference that are missing here → merge every peer (T40
//   engine) and store the photos in ONE local transaction → normal backup of the merged state.
//
// All network reads happen before the first local write, so a network/GitHub failure while reading
// leaves this device untouched (the error is thrown as `BackupError`). Peers whose latest.enc is
// missing, encrypted with another key or damaged are skipped and reported, never fatal.
// If only the final backup fails, the merge stays applied and `backupError` is set.
//
// Nothing here logs; the token and key never leave the config / CryptoKey objects.

import { db, getDeviceId } from '../../db';
import type { Photo } from '../../domain/types';
import type { Bundle, BundlePhoto } from '../backup/schema';
import {
  BackupError,
  DEVICES_DIR,
  PHOTOS_DIR,
  backupNowUnlocked,
  bytesToEnvelope,
  devicePaths,
  fileAad,
  downloadBackup,
  toBackupError,
  verifyKeyAgainstRepo,
  type BackupErrorKind,
  type BackupProgress,
  type BackupResult,
} from '../backup/github-backup';
import { DecryptError, decrypt, decryptJson, photoFileName } from '../crypto';
import { withRepoLock } from '../backup/repoLock';
import { getFile, listDir, type GitHubConfig } from '../github';
import { sha256Hex } from '../image/hash';
import type { MergeResult, Snapshot } from './merge';
import { syncPeer } from './store';

/** Device folders are UUIDs; anything else under devices/ is ignored (same rule as github-backup). */
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export type SyncProgress =
  | { phase: 'prepare' }
  | { phase: 'download'; done: number; total: number }
  | { phase: 'photos'; done: number; total: number }
  | { phase: 'merge' }
  | { phase: 'backup'; backup: BackupProgress };

/**
 * - `synced`: merged.
 * - `no-latest`: the device folder has no latest.enc (never finished a backup).
 * - `unreadable`: latest.enc is encrypted with a different key (another passphrase).
 * - `corrupt`: latest.enc is not a valid envelope / bundle, or it belongs to another device.
 * - `stale`: latest.enc is older than the newest one already merged from this peer (an old backup put
 *   back in its place – merging it would silently undo the peer's later edits).
 */
export type PeerStatus = 'synced' | 'no-latest' | 'unreadable' | 'corrupt' | 'stale';

/** kv key holding the `createdAt` of the newest bundle merged from `peerId` (rollback guard). */
export const peerSeenKey = (peerId: string) => `sync.peerSeen.${peerId}`;

async function lastSeenFrom(peerId: string): Promise<string | undefined> {
  const v = (await db.kv.get(peerSeenKey(peerId)))?.value;
  return typeof v === 'string' ? v : undefined;
}

export interface PeerSummary {
  peerId: string;
  /** From device.json.enc; undefined if missing or unreadable. */
  name?: string;
  status: PeerStatus;
  /** Records added from this peer. */
  added: number;
  /** Records updated from this peer (taken over or combined). */
  updated: number;
  /** Records that now need the human's choice (open conflicts with this peer after the sync). */
  conflicts: number;
}

export interface SyncResult {
  peers: PeerSummary[];
  /** Photos downloaded and stored locally. */
  photosDownloaded: number;
  /** Referenced photos that are absent or damaged in the repo. */
  photosMissing: number;
  /** The backup of the merged state (absent if it failed, see `backupError`). */
  backup?: BackupResult;
  /** The merge was applied, but the following backup failed. */
  backupError?: BackupErrorKind;
}

export interface SyncOptions {
  onProgress?: (p: SyncProgress) => void;
}

interface Downloaded {
  peerId: string;
  name?: string;
  bundle?: Bundle;
  status: PeerStatus;
}

async function readDeviceName(cfg: GitHubConfig, key: CryptoKey, peerId: string): Promise<string | undefined> {
  const path = devicePaths(peerId).deviceInfo;
  const file = await getFile(cfg, path);
  if (!file) return undefined;
  try {
    const value = await decryptJson(key, bytesToEnvelope(file.content), fileAad(path));
    if (value && typeof value === 'object' && 'name' in value) {
      const name = (value as { name?: unknown }).name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  } catch (e) {
    if (!(e instanceof BackupError || e instanceof DecryptError)) throw e;
  }
  return undefined;
}

async function downloadPeer(cfg: GitHubConfig, key: CryptoKey, peerId: string): Promise<Downloaded> {
  const name = await readDeviceName(cfg, key, peerId);
  const withName = name ? { name } : {};
  try {
    const bundle = await downloadBackup(cfg, key, devicePaths(peerId).latest);
    // Another device's bundle copied into this folder (older v1 files have no path binding).
    if (bundle.deviceId !== peerId) return { peerId, ...withName, status: 'corrupt' };
    const seen = await lastSeenFrom(peerId);
    if (seen !== undefined && bundle.createdAt < seen) return { peerId, ...withName, status: 'stale' };
    return { peerId, ...withName, bundle, status: 'synced' };
  } catch (e) {
    const err = toBackupError(e);
    if (err.kind === 'missing') return { peerId, ...withName, status: 'no-latest' };
    if (err.kind === 'wrong-key') return { peerId, ...withName, status: 'unreadable' };
    if (err.kind === 'corrupt') return { peerId, ...withName, status: 'corrupt' };
    throw err;
  }
}

/** Fetches + decrypts + verifies one photo; undefined if absent or damaged. Network errors throw. */
async function downloadPhoto(
  cfg: GitHubConfig,
  key: CryptoKey,
  meta: BundlePhoto,
  fallbackCreatedAt: string,
): Promise<Photo | undefined> {
  const path = `${PHOTOS_DIR}/${await photoFileName(key, meta.hash)}`;
  const file = await getFile(cfg, path);
  if (!file) return undefined;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await decrypt(key, bytesToEnvelope(file.content), fileAad(path)));
  } catch (e) {
    if (e instanceof BackupError || e instanceof DecryptError) return undefined;
    throw e;
  }
  if (bytes.length !== meta.size || (await sha256Hex(bytes.buffer)) !== meta.hash) return undefined;
  return {
    hash: meta.hash,
    mime: meta.mime,
    width: meta.width,
    height: meta.height,
    size: meta.size,
    blob: new Blob([bytes], { type: meta.mime }),
    createdAt: meta.createdAt ?? fallbackCreatedAt,
  };
}

function toSnapshot(bundle: Bundle): Snapshot {
  return { recipes: bundle.recipes, categories: bundle.categories, tags: bundle.tags };
}

/** Lists the other devices' folders in the repo (never this device). */
export async function listPeerIds(cfg: GitHubConfig): Promise<string[]> {
  const thisDevice = await getDeviceId();
  return (await listDir(cfg, DEVICES_DIR))
    .filter((e) => e.type === 'dir' && DEVICE_ID_RE.test(e.name) && e.name !== thisDevice)
    .map((e) => e.name)
    .sort();
}

/**
 * Sync with every other device in the repo, then back up. Throws `BackupError` (with nothing changed
 * locally) if the key doesn't match the repo or GitHub can't be read.
 */
export function syncWithGitHub(cfg: GitHubConfig, key: CryptoKey, opts: SyncOptions = {}): Promise<SyncResult> {
  // One repo operation at a time (also across tabs): a backup or restore started meanwhile waits.
  return withRepoLock(() => syncUnlocked(cfg, key, opts));
}

async function syncUnlocked(cfg: GitHubConfig, key: CryptoKey, opts: SyncOptions): Promise<SyncResult> {
  const progress = opts.onProgress ?? (() => {});

  // ---- 1. Read everything from GitHub (no local writes) -------------------------------------
  const downloaded: Downloaded[] = [];
  const photos: Photo[] = [];
  let photosMissing = 0;
  try {
    progress({ phase: 'prepare' });
    await verifyKeyAgainstRepo(cfg, key);
    await getDeviceId(); // cached from here on – syncPeer reads it inside our transaction
    const peerIds = await listPeerIds(cfg);
    progress({ phase: 'download', done: 0, total: peerIds.length });
    for (const [i, peerId] of peerIds.entries()) {
      downloaded.push(await downloadPeer(cfg, key, peerId));
      progress({ phase: 'download', done: i + 1, total: peerIds.length });
    }

    const needed = new Map<string, { meta: BundlePhoto; createdAt: string }>();
    for (const d of downloaded) {
      for (const meta of d.bundle?.photos ?? []) {
        if (needed.has(meta.hash)) continue;
        if ((await db.photos.where('hash').equals(meta.hash).count()) > 0) continue;
        needed.set(meta.hash, { meta, createdAt: d.bundle?.createdAt ?? new Date().toISOString() });
      }
    }
    const list = [...needed.values()];
    progress({ phase: 'photos', done: 0, total: list.length });
    for (const [i, { meta, createdAt }] of list.entries()) {
      const photo = await downloadPhoto(cfg, key, meta, createdAt);
      if (photo) photos.push(photo);
      else photosMissing++;
      progress({ phase: 'photos', done: i + 1, total: list.length });
    }
  } catch (e) {
    throw toBackupError(e);
  }

  // ---- 2. Apply: photos first (records may reference them), then every peer – one transaction --
  progress({ phase: 'merge' });
  const results = new Map<string, MergeResult>();
  const tables = [db.recipes, db.categories, db.tags, db.syncBase, db.syncConflicts, db.photos, db.kv];
  const openConflicts = await db.transaction('rw', tables, async () => {
    const have = new Set((await db.photos.toCollection().primaryKeys()).map(String));
    await db.photos.bulkAdd(photos.filter((p) => !have.has(p.hash)));
    for (const d of downloaded) {
      if (!d.bundle) continue;
      results.set(d.peerId, await syncPeer(d.peerId, d.name ?? '', toSnapshot(d.bundle)));
      await db.kv.put({ key: peerSeenKey(d.peerId), value: d.bundle.createdAt });
    }
    const counts = new Map<string, number>();
    for (const c of await db.syncConflicts.toArray()) counts.set(c.peerId, (counts.get(c.peerId) ?? 0) + 1);
    return counts;
  });

  const peers: PeerSummary[] = downloaded.map((d) => {
    const r = results.get(d.peerId);
    return {
      peerId: d.peerId,
      ...(d.name ? { name: d.name } : {}),
      status: d.status,
      added: r ? r.changes.filter((c) => c.kind === 'add').length : 0,
      updated: r ? r.changes.filter((c) => c.kind !== 'add').length : 0,
      conflicts: r ? (openConflicts.get(d.peerId) ?? 0) : 0,
    };
  });

  // ---- 3. Publish the merged state (and this device's own edits) -----------------------------
  const result: SyncResult = { peers, photosDownloaded: photos.length, photosMissing };
  try {
    result.backup = await backupNowUnlocked(cfg, key, {
      onProgress: (backup) => progress({ phase: 'backup', backup }),
    });
  } catch (e) {
    result.backupError = toBackupError(e).kind;
  }
  return result;
}
