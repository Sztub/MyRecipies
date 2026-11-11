// Encrypted backup to / restore from the GitHub data repo (T09).
//
// Repo layout (relative to the GitHubConfig basePath) – see docs/HOW-IT-WORKS.md "Backup format":
//   keycheck.json                                  plain KeyCheck (written by Settings, T08)
//   devices/<deviceId>/backups/<stamp>.enc         encrypted bundle (no photo data)
//   devices/<deviceId>/latest.enc                  copy of the newest backup
//   devices/<deviceId>/device.json.enc             encrypted { name, lastBackupAt }
//   photos/<hmac>.enc                              encrypted photo bytes, uploaded only if missing
//
// Every `.enc` file is UTF-8 JSON of a crypto `Envelope` ({ v, alg, iv, ct }). For bundles and
// device.json the plaintext is UTF-8 JSON; for photos it is the raw stored photo bytes.
// New files are `v: 2`: the AES-GCM AAD is `fileAad(<repo-relative path>)`, so a file copied or moved to
// another path (e.g. an old backup over latest.enc, or one device's file into another device's folder)
// no longer decrypts. `v: 1` files from older versions are still read (without AAD).
// `<stamp>` is the bundle's `createdAt` ISO time with ':' and '.' replaced by '-'
// (e.g. 2026-11-09T12-34-56-789Z) so the data repo can be checked out on Windows.
//
// Nothing here logs, and the token/key never leave the config/CryptoKey objects.

import { z } from 'zod';
import { db, getDeviceId, settings } from '../../db';
import { decrypt, decryptJson, encrypt, encryptJson, photoFileName, DecryptError } from '../crypto';
import type { Envelope, KeyCheck } from '../crypto';
import {
  GitHubError,
  deleteFile,
  getFile,
  listDir,
  putFile,
  type GitHubConfig,
  type GitHubErrorKind,
} from '../github';
import { buildBundle } from './build';
import { blobToBytes } from './bytes';
import { importBundle, type ImportMode, type ImportReport } from './import';
import { withRepoLock } from './repoLock';
import { BundleError, parseBundle, type Bundle } from './schema';

// ---------------------------------------------------------------------------------------------
// Paths

export const KEYCHECK_PATH = 'keycheck.json';
export const DEVICES_DIR = 'devices';
export const PHOTOS_DIR = 'photos';

export const devicePaths = (deviceId: string) => {
  const dir = `${DEVICES_DIR}/${deviceId}`;
  return {
    dir,
    backupsDir: `${dir}/backups`,
    latest: `${dir}/latest.enc`,
    deviceInfo: `${dir}/device.json.enc`,
  };
};

/** `2026-11-09T12:34:56.789Z` → `2026-11-09T12-34-56-789Z.enc` */
export function backupFileName(createdAt: string): string {
  return `${createdAt.replace(/[:.]/g, '-')}.enc`;
}

/** Inverse of `backupFileName`; null if the name doesn't look like one. */
export function backupTimeFromName(name: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.enc$/.exec(name);
  if (!m) return null;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
}

/** AES-GCM additional data for the `.enc` file at `path` (relative to the config's basePath). */
export function fileAad(path: string): string {
  return `recipes/file/v2:${path}`;
}

/** Device IDs are UUIDs from `crypto.randomUUID()`; ignore anything else found under devices/. */
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

// ---------------------------------------------------------------------------------------------
// Errors

export type BackupErrorKind =
  /** GitHub settings incomplete. */
  | 'not-configured'
  /** No key on this device – the passphrase must be entered in Settings. */
  | 'locked'
  /** keycheck.json missing in the repo. */
  | 'no-keycheck'
  /** The key on this device doesn't match the repo / the backup (different passphrase). */
  | 'wrong-key'
  /** A remote file is damaged, not an envelope, or not a valid bundle. */
  | 'corrupt'
  /** The chosen backup no longer exists. */
  | 'missing'
  | Exclude<GitHubErrorKind, 'not-found'>;

export class BackupError extends Error {
  readonly kind: BackupErrorKind;
  /** Seconds until the rate limit resets, when known. */
  readonly retryAfter?: number;

  constructor(kind: BackupErrorKind, message: string, opts: { retryAfter?: number } = {}) {
    super(message);
    this.name = 'BackupError';
    this.kind = kind;
    if (opts.retryAfter !== undefined) this.retryAfter = opts.retryAfter;
  }
}

/** Wraps any thrown value into a BackupError (GitHub errors keep their kind). */
export function toBackupError(err: unknown): BackupError {
  if (err instanceof BackupError) return err;
  if (err instanceof GitHubError) {
    const kind: BackupErrorKind = err.kind === 'not-found' ? 'missing' : err.kind;
    return new BackupError(kind, err.message, err.retryAfter !== undefined ? { retryAfter: err.retryAfter } : {});
  }
  if (err instanceof DecryptError) return new BackupError('wrong-key', 'Could not decrypt');
  if (err instanceof BundleError) return new BackupError('corrupt', err.message);
  return new BackupError('unknown', err instanceof Error ? err.message : 'Unknown error');
}

// ---------------------------------------------------------------------------------------------
// Envelope I/O

const envelopeSchema = z.object({
  v: z.union([z.literal(1), z.literal(2)]),
  alg: z.literal('AES-256-GCM'),
  iv: z.string(),
  ct: z.string(),
});

const keyCheckFileSchema = z.object({ check: envelopeSchema });
/** The one zod schema for keycheck.json (Settings → Encryption, unlock, backup all go through it). */
export const keyCheckSchema = z.object({
  v: z.literal(1),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.number().int().positive(),
  salt: z.string(),
  check: envelopeSchema,
});

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export function envelopeToBytes(env: Envelope): Uint8Array {
  return enc.encode(JSON.stringify(env));
}

export function bytesToEnvelope(bytes: Uint8Array): Envelope {
  try {
    return envelopeSchema.parse(JSON.parse(dec.decode(bytes)));
  } catch {
    throw new BackupError('corrupt', 'Remote file is not an encrypted envelope');
  }
}

async function decryptJsonFile(key: CryptoKey, bytes: Uint8Array, path: string): Promise<unknown> {
  try {
    return await decryptJson(key, bytesToEnvelope(bytes), fileAad(path));
  } catch (e) {
    if (e instanceof DecryptError) throw new BackupError('wrong-key', 'Could not decrypt');
    throw e;
  }
}

/** Throws `no-keycheck` / `corrupt` / `wrong-key` unless `key` matches the repo's keycheck.json. */
export async function verifyKeyAgainstRepo(cfg: GitHubConfig, key: CryptoKey): Promise<void> {
  const file = await getFile(cfg, KEYCHECK_PATH);
  if (!file) throw new BackupError('no-keycheck', 'keycheck.json not found');
  let check: Envelope;
  try {
    check = keyCheckFileSchema.parse(JSON.parse(dec.decode(file.content))).check;
  } catch {
    throw new BackupError('corrupt', 'keycheck.json is malformed');
  }
  try {
    await decrypt(key, check);
  } catch {
    throw new BackupError('wrong-key', 'Key does not match keycheck.json');
  }
}

/**
 * Reads keycheck.json from the repo (for unlocking with the passphrase). null if it doesn't exist.
 * Throws `corrupt` if it is malformed; GitHub errors pass through as `BackupError`.
 */
export async function fetchKeyCheck(cfg: GitHubConfig): Promise<KeyCheck | null> {
  try {
    const file = await getFile(cfg, KEYCHECK_PATH);
    if (!file) return null;
    try {
      return keyCheckSchema.parse(JSON.parse(dec.decode(file.content)));
    } catch {
      throw new BackupError('corrupt', 'keycheck.json is malformed');
    }
  } catch (e) {
    throw toBackupError(e);
  }
}

/**
 * True when the repo already holds backup data (any device folder or photo). Used before creating a NEW
 * keycheck.json: if data exists but the key check is missing (deleted, wrong branch/base path), a new key would
 * split the family into devices that can't read each other's backups.
 */
export async function repoHasBackupData(cfg: GitHubConfig): Promise<boolean> {
  try {
    const [devices, photos] = await Promise.all([listDir(cfg, DEVICES_DIR), listDir(cfg, PHOTOS_DIR)]);
    return devices.length > 0 || photos.length > 0;
  } catch (e) {
    throw toBackupError(e);
  }
}

/**
 * Uploads a new keycheck.json, create-only (no sha): if one appeared meanwhile, GitHub refuses and this
 * throws `conflict` instead of overwriting another device's key.
 */
export async function createRepoKeyCheck(cfg: GitHubConfig, keyCheck: KeyCheck): Promise<void> {
  try {
    await putFile(cfg, KEYCHECK_PATH, enc.encode(JSON.stringify(keyCheck, null, 2)), 'Add key check');
  } catch (e) {
    throw toBackupError(e);
  }
}

/** PUT that creates or overwrites, fetching the current sha (retries once on a sha race). */
async function upsertFile(cfg: GitHubConfig, path: string, content: Uint8Array, message: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const existing = await getFile(cfg, path);
    try {
      await putFile(cfg, path, content, message, existing?.sha);
      return;
    } catch (e) {
      if (attempt === 0 && e instanceof GitHubError && e.kind === 'conflict') continue;
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Local "last backup" status (kv table, this device only)

export const LAST_BACKUP_KEY = 'backup.github.last';

export interface LastBackup {
  at: string;
  /** Repo-relative path of the uploaded backup file. */
  path: string;
  photosUploaded: number;
  photosSkipped: number;
  /** Size in bytes of the uploaded (encrypted) backup file. */
  size: number;
}

const lastBackupSchema = z.object({
  at: z.string(),
  path: z.string(),
  photosUploaded: z.number(),
  photosSkipped: z.number(),
  size: z.number(),
});

export async function getLastBackup(): Promise<LastBackup | null> {
  const row = await db.kv.get(LAST_BACKUP_KEY);
  const parsed = lastBackupSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------------------------
// Back up

export type BackupProgress =
  | { phase: 'prepare' }
  | { phase: 'photos'; done: number; total: number }
  | { phase: 'upload' }
  | { phase: 'finish' }
  | { phase: 'prune' };

export interface BackupResult extends LastBackup {
  deviceId: string;
  /** Old backups of this device deleted by keep-last-N pruning. */
  pruned: number;
  /** Set when pruning failed; the backup itself still succeeded (leftovers go next time). */
  pruneError?: BackupErrorKind;
}

export interface BackupOptions {
  onProgress?: (p: BackupProgress) => void;
  /** Keep this many newest backups of this device; default: the `backupKeepLast` setting, else 20. */
  keepLast?: number;
  /** Also keep the newest backup of each of the last N days; default: the `backupKeepDaily` setting, else 0 (off). */
  keepDaily?: number;
}

/** Default for the "keep last N backups" setting. */
export const DEFAULT_KEEP_LAST = 20;
export const MIN_KEEP_LAST = 1;
export const MAX_KEEP_LAST = 500;

/** The "keep last N backups" setting (clamped, default 20). */
export async function getKeepLast(): Promise<number> {
  return clampKeepLast((await settings.get('backupKeepLast')) ?? DEFAULT_KEEP_LAST);
}

export const MAX_KEEP_DAILY = 366;

/** The "also keep one per day for N days" setting (0 = off). */
export async function getKeepDaily(): Promise<number> {
  return clampKeepDaily((await settings.get('backupKeepDaily')) ?? 0);
}

export function clampKeepDaily(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_KEEP_DAILY, Math.max(0, Math.floor(n)));
}

export function clampKeepLast(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_KEEP_LAST;
  return Math.min(MAX_KEEP_LAST, Math.max(MIN_KEEP_LAST, Math.floor(n)));
}

const deviceInfoSchema = z.object({
  name: z.string().optional(),
  lastBackupAt: z.string().optional(),
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

/**
 * Full encrypted backup of this device:
 * verify key → build bundle (no photo data) → upload missing photos → upload backups/<stamp>.enc →
 * update latest.enc and device.json.enc → remember the result locally.
 * Local recipe data is only read. Throws `BackupError`. Waits for any running backup/restore/sync (repo lock).
 */
export function backupNow(cfg: GitHubConfig, key: CryptoKey, opts: BackupOptions = {}): Promise<BackupResult> {
  return withRepoLock(() => backupNowUnlocked(cfg, key, opts));
}

/** `backupNow` for callers that already hold the repo lock (syncWithGitHub). */
export async function backupNowUnlocked(
  cfg: GitHubConfig,
  key: CryptoKey,
  opts: BackupOptions = {},
): Promise<BackupResult> {
  const progress = opts.onProgress ?? (() => {});
  try {
    progress({ phase: 'prepare' });
    await verifyKeyAgainstRepo(cfg, key);
    const deviceId = await getDeviceId();
    const bundle = await buildBundle({ includePhotoData: false });
    const paths = devicePaths(deviceId);

    // Photos: content-addressed, so upload only names not already in the repo.
    const remote = new Set(
      (await listDir(cfg, PHOTOS_DIR)).filter((e) => e.type !== 'dir').map((e) => e.name),
    );
    let uploaded = 0;
    let skipped = 0;
    const total = bundle.photos.length;
    progress({ phase: 'photos', done: 0, total });
    for (const [i, meta] of bundle.photos.entries()) {
      const name = await photoFileName(key, meta.hash);
      if (remote.has(name)) {
        skipped++;
      } else {
        const row = await db.photos.get(meta.hash);
        if (!row) throw new BackupError('unknown', 'Photo vanished during backup');
        const photoPath = `${PHOTOS_DIR}/${name}`;
        const env = await encrypt(key, await blobToBytes(row.blob), fileAad(photoPath));
        try {
          await putFile(cfg, photoPath, envelopeToBytes(env), 'Add photo');
          uploaded++;
        } catch (e) {
          // The directory listing is capped (1 000 entries on GitHub) – an existing file shows up as
          // a 422/409 here. Same name ⇒ same photo under the same key, so it is already backed up.
          if (e instanceof GitHubError && e.kind === 'conflict') skipped++;
          else throw e;
        }
        remote.add(name);
      }
      progress({ phase: 'photos', done: i + 1, total });
    }

    progress({ phase: 'upload' });
    const backupPath = `${paths.backupsDir}/${backupFileName(bundle.createdAt)}`;
    // Same bundle, encrypted once per path (each copy is bound to where it lives).
    const bundleBytes = envelopeToBytes(await encryptJson(key, bundle, fileAad(backupPath)));
    await putFile(cfg, backupPath, bundleBytes, `Backup ${deviceId}`);

    progress({ phase: 'finish' });
    const latestBytes = envelopeToBytes(await encryptJson(key, bundle, fileAad(paths.latest)));
    await upsertFile(cfg, paths.latest, latestBytes, `Update latest backup ${deviceId}`);
    const info: DeviceInfo = { name: (await settings.get('deviceName')) ?? '', lastBackupAt: bundle.createdAt };
    const infoBytes = envelopeToBytes(await encryptJson(key, info, fileAad(paths.deviceInfo)));
    await upsertFile(cfg, paths.deviceInfo, infoBytes, `Update device ${deviceId}`);

    const last: LastBackup = {
      at: bundle.createdAt,
      path: backupPath,
      photosUploaded: uploaded,
      photosSkipped: skipped,
      size: bundleBytes.length,
    };
    await db.kv.put({ key: LAST_BACKUP_KEY, value: last });

    // The backup is complete here. Pruning is best effort and never fails the backup.
    progress({ phase: 'prune' });
    const keepLast = clampKeepLast(opts.keepLast ?? (await getKeepLast()));
    const keepDaily = clampKeepDaily(opts.keepDaily ?? (await getKeepDaily()));
    const prune = await pruneDeviceBackups(cfg, deviceId, keepLast, backupPath, keepDaily);
    return { ...last, deviceId, pruned: prune.deleted, ...(prune.error ? { pruneError: prune.error } : {}) };
  } catch (e) {
    throw toBackupError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Pruning (keep last N)

export interface PruneResult {
  deleted: number;
  /** Set if listing or a delete failed; deletion stops at the first failure. */
  error?: BackupErrorKind;
}

/**
 * Deletes the oldest `devices/<deviceId>/backups/*.enc` so that the newest `keepLast` remain.
 * Only ever touches files directly in THIS device's backups folder whose names follow the backup
 * naming scheme; never latest.enc, device.json.enc, photos, keycheck.json or other devices' files.
 * `keepPath` (the backup just uploaded) is never deleted. Never throws.
 */
export async function pruneDeviceBackups(
  cfg: GitHubConfig,
  deviceId: string,
  keepLast: number,
  keepPath?: string,
  keepDaily = 0,
): Promise<PruneResult> {
  let deleted = 0;
  try {
    if (!DEVICE_ID_RE.test(deviceId)) return { deleted, error: 'unknown' };
    const { backupsDir } = devicePaths(deviceId);
    const listing = (await listDir(cfg, backupsDir)).filter(
      (e) => e.type !== 'dir' && e.path === `${backupsDir}/${e.name}`,
    );
    const shaByPath = new Map(listing.map((e) => [e.path, e.sha]));
    const backups: RemoteBackup[] = listing.map((e) => ({
      path: e.path,
      name: e.name,
      createdAt: backupTimeFromName(e.name),
      size: e.size,
    }));
    // The fresh upload counts towards N even if the listing doesn't show it yet.
    if (keepPath && !shaByPath.has(keepPath) && keepPath.startsWith(`${backupsDir}/`)) {
      const name = keepPath.slice(backupsDir.length + 1);
      backups.push({ path: keepPath, name, createdAt: backupTimeFromName(name), size: 0 });
    }
    for (const path of selectBackupsToPrune(backups, { keepLast, keepDaily })) {
      const sha = shaByPath.get(path);
      if (path === keepPath || !sha || !path.startsWith(`${backupsDir}/`)) continue;
      await deleteFile(cfg, path, sha, `Prune old backup ${deviceId}`);
      deleted++;
    }
    return { deleted };
  } catch (e) {
    return { deleted, error: toBackupError(e).kind };
  }
}

// ---------------------------------------------------------------------------------------------
// List

export interface RemoteBackup {
  /** Repo-relative path, pass to `restoreBackup`. */
  path: string;
  name: string;
  /** From the file name; null if it doesn't follow the naming scheme. */
  createdAt: string | null;
  /** Encrypted size in bytes. */
  size: number;
}

export interface RemoteDevice {
  deviceId: string;
  /** Decrypted from device.json.enc; undefined if missing or not readable with this key. */
  name?: string;
  lastBackupAt?: string;
  /** device.json.enc exists but could not be decrypted with this key. */
  unreadable: boolean;
  isThisDevice: boolean;
  /** Newest first. */
  backups: RemoteBackup[];
  /** Sum of `backups[].size`. */
  totalSize: number;
}

/** Lists every device folder and its backups. Throws `BackupError` (GitHub errors only). */
export async function listRemoteBackups(cfg: GitHubConfig, key: CryptoKey): Promise<RemoteDevice[]> {
  try {
    const thisDevice = await getDeviceId();
    const dirs = (await listDir(cfg, DEVICES_DIR)).filter((e) => e.type === 'dir' && DEVICE_ID_RE.test(e.name));
    const devices: RemoteDevice[] = [];
    for (const d of dirs) {
      const paths = devicePaths(d.name);
      const backups: RemoteBackup[] = (await listDir(cfg, paths.backupsDir))
        .filter((e) => e.type !== 'dir' && e.name.endsWith('.enc'))
        .map((e) => ({ path: e.path, name: e.name, createdAt: backupTimeFromName(e.name), size: e.size }))
        .sort((a, b) => b.name.localeCompare(a.name));
      let info: DeviceInfo = {};
      let unreadable = false;
      const infoFile = await getFile(cfg, paths.deviceInfo);
      if (infoFile) {
        try {
          const parsed = deviceInfoSchema.safeParse(await decryptJsonFile(key, infoFile.content, paths.deviceInfo));
          if (parsed.success) info = parsed.data;
          else unreadable = true;
        } catch (e) {
          if (e instanceof BackupError) unreadable = true;
          else throw e;
        }
      }
      devices.push({
        deviceId: d.name,
        ...(info.name ? { name: info.name } : {}),
        ...(info.lastBackupAt ? { lastBackupAt: info.lastBackupAt } : {}),
        unreadable,
        isThisDevice: d.name === thisDevice,
        backups,
        totalSize: backups.reduce((s, b) => s + b.size, 0),
      });
    }
    // This device first, then by most recent backup.
    return devices.sort(
      (a, b) =>
        Number(b.isThisDevice) - Number(a.isThisDevice) ||
        (b.backups[0]?.name ?? '').localeCompare(a.backups[0]?.name ?? ''),
    );
  } catch (e) {
    throw toBackupError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Restore

export type RestoreProgress =
  | { phase: 'download' }
  | { phase: 'photos'; done: number; total: number }
  | { phase: 'import' };

export interface RestoreOptions {
  onProgress?: (p: RestoreProgress) => void;
}

/** Downloads and decrypts one backup file (no local changes). Throws `BackupError`. */
export async function downloadBackup(cfg: GitHubConfig, key: CryptoKey, path: string): Promise<Bundle> {
  try {
    const file = await getFile(cfg, path);
    if (!file) throw new BackupError('missing', 'Backup not found');
    const value = await decryptJsonFile(key, file.content, path);
    return parseBundle(value);
  } catch (e) {
    throw toBackupError(e);
  }
}

/**
 * Downloads → decrypts → validates the backup, then fetches + decrypts every photo not stored
 * locally, and only then calls `importBundle` (which writes in one transaction). Any GitHub or
 * decryption failure before that point throws `BackupError` with local data untouched.
 * Photos whose remote file is absent or unreadable are reported in `report.photos.missing`.
 */
export function restoreBackup(
  cfg: GitHubConfig,
  key: CryptoKey,
  path: string,
  mode: ImportMode,
  opts: RestoreOptions = {},
): Promise<ImportReport> {
  return withRepoLock(() => restoreBackupUnlocked(cfg, key, path, mode, opts));
}

async function restoreBackupUnlocked(
  cfg: GitHubConfig,
  key: CryptoKey,
  path: string,
  mode: ImportMode,
  opts: RestoreOptions,
): Promise<ImportReport> {
  const progress = opts.onProgress ?? (() => {});
  try {
    progress({ phase: 'download' });
    const bundle = await downloadBackup(cfg, key, path);

    const needed: Bundle['photos'] = [];
    const seen = new Set<string>();
    for (const p of bundle.photos) {
      if (seen.has(p.hash)) continue;
      seen.add(p.hash);
      if ((await db.photos.where('hash').equals(p.hash).count()) === 0) needed.push(p);
    }
    const fetched = new Map<string, Uint8Array<ArrayBuffer>>();
    progress({ phase: 'photos', done: 0, total: needed.length });
    for (const [i, meta] of needed.entries()) {
      const photoPath = `${PHOTOS_DIR}/${await photoFileName(key, meta.hash)}`;
      const file = await getFile(cfg, photoPath);
      if (file) {
        try {
          const env = bytesToEnvelope(file.content);
          fetched.set(meta.hash, new Uint8Array(await decrypt(key, env, fileAad(photoPath))));
        } catch (e) {
          if (!(e instanceof BackupError || e instanceof DecryptError)) throw e;
          // Damaged photo file: leave it out, importBundle reports it as missing.
        }
      }
      progress({ phase: 'photos', done: i + 1, total: needed.length });
    }

    progress({ phase: 'import' });
    return await importBundle(bundle, mode, { resolvePhoto: async (meta) => fetched.get(meta.hash) });
  } catch (e) {
    throw toBackupError(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Retention policy (pure; used by `pruneDeviceBackups`)

export interface PrunePolicy {
  /** Always keep this many newest backups per device (min 1). */
  keepLast: number;
  /** Additionally keep the newest backup of each of the last N distinct days. */
  keepDaily?: number;
}

/**
 * Pure: which backups of ONE device a pruning run would delete (paths, oldest first).
 * Never selects the newest backup. Files with unparseable names are never selected.
 */
export function selectBackupsToPrune(backups: RemoteBackup[], policy: PrunePolicy): string[] {
  const dated = backups
    .filter((b): b is RemoteBackup & { createdAt: string } => b.createdAt !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const keep = new Set(dated.slice(0, Math.max(1, policy.keepLast)).map((b) => b.path));
  if (policy.keepDaily && policy.keepDaily > 0) {
    const days = new Set<string>();
    for (const b of dated) {
      const day = b.createdAt.slice(0, 10);
      if (days.has(day)) continue;
      if (days.size >= policy.keepDaily) break;
      days.add(day);
      keep.add(b.path);
    }
  }
  return dated
    .filter((b) => !keep.has(b.path))
    .map((b) => b.path)
    .reverse();
}
