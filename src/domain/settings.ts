import { z } from 'zod';

/**
 * Typed key-value settings. Each key has its own zod schema; values are validated on write and on
 * read (an invalid stored value reads as `undefined`). Tasks add keys here additively.
 *
 * Secrets (GitHub token, passphrase) do NOT belong here unless the owning task decides so explicitly.
 */
export const settingsSchemas = {
  /** Theme name, e.g. "warm" – matches `src/theme/themes/<name>.css` (T11). */
  theme: z.string().min(1),
  /** Light/dark preference (T11). */
  colorMode: z.enum(['system', 'light', 'dark']),
  /** Human-readable name of this device, shown in backups (T08/T09). */
  deviceName: z.string().max(100),
  /** GitHub backup target (T08). */
  githubOwner: z.string(),
  githubRepo: z.string(),
  githubBranch: z.string(),
  githubBasePath: z.string(),
  /** GitHub token (T08). SECRET: stored only in this device's IndexedDB; never exported, logged or put in URLs. */
  githubToken: z.string(),
  /** Keep this many newest GitHub backups of this device; older ones are deleted after a backup (T28). */
  backupKeepLast: z.number().int().min(1).max(500),
  /** Additionally keep the newest backup of each of the last N days; 0 = off (T41). */
  backupKeepDaily: z.number().int().min(0).max(366),
} as const;

export type SettingsKey = keyof typeof settingsSchemas;

export type Settings = { [K in SettingsKey]: z.infer<(typeof settingsSchemas)[K]> };

export function isSettingsKey(key: string): key is SettingsKey {
  return Object.prototype.hasOwnProperty.call(settingsSchemas, key);
}
