import { photos, recipes } from '../../db';

/**
 * Hashes of stored photos that no recipe references (cover photos or step photos).
 * Tombstoned recipes still count as references, so restoring them never loses photos.
 * Read-only: nothing is deleted in Run 1.
 */
export async function findOrphanPhotos(): Promise<string[]> {
  const used = new Set<string>();
  for (const r of await recipes.list({ includeDeleted: true })) {
    r.photoHashes.forEach((h) => used.add(h));
    r.steps.forEach((s) => s.photoHash && used.add(s.photoHash));
  }
  return (await photos.listHashes()).filter((h) => !used.has(h));
}
