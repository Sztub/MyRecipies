import { db } from '../../db';
import { buildBundle, bundleFileName, bundleToJson } from './build';
import type { Bundle } from './schema';

/** kv key holding the latest automatic safety export (only one is kept). */
export const SAFETY_EXPORT_KEY = 'backup.safetyExport';

export interface SafetyExport {
  createdAt: string;
  fileName: string;
  /** Full bundle JSON incl. photo data. */
  json: string;
}

/**
 * Snapshots the current DB (with photo data) and stores it in the `kv` table, which `replace`
 * never touches. Returns the stored record so the UI can offer it as a download.
 */
export async function createSafetyExport(): Promise<SafetyExport> {
  const bundle: Bundle = await buildBundle({ includePhotoData: true });
  const record: SafetyExport = {
    createdAt: bundle.createdAt,
    fileName: bundleFileName(new Date(bundle.createdAt)).replace(
      'recipes-backup-',
      'recipes-backup-safety-',
    ),
    json: bundleToJson(bundle),
  };
  await db.kv.put({ key: SAFETY_EXPORT_KEY, value: record });
  return record;
}

export async function getSafetyExport(): Promise<SafetyExport | undefined> {
  const row = await db.kv.get(SAFETY_EXPORT_KEY);
  const v = row?.value as Partial<SafetyExport> | undefined;
  if (
    v &&
    typeof v.json === 'string' &&
    typeof v.fileName === 'string' &&
    typeof v.createdAt === 'string'
  ) {
    return v as SafetyExport;
  }
  return undefined;
}
