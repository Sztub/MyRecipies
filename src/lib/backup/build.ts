import { categories, getDeviceId, photos, recipes, tags } from '../../db';
import { db } from '../../db';
import { nowIso } from '../../domain/ids';
import { bytesToBase64 } from '../crypto/base64';
import { blobToBytes } from './bytes';
import { BUNDLE_FORMAT, BUNDLE_VERSION, type Bundle, type BundlePhoto } from './schema';

/** Kept in sync with package.json "version" (checked by a unit test). */
export const APP_VERSION = '0.1.0';

export interface BuildBundleOptions {
  /** Embed photo bytes as base64 (`data`). True for local export, false for GitHub backup. */
  includePhotoData: boolean;
}

/** Snapshot of the whole DB (incl. tombstones) as a v1 bundle. */
export async function buildBundle({ includePhotoData }: BuildBundleOptions): Promise<Bundle> {
  const [deviceId, r, c, t, hashes] = await Promise.all([
    getDeviceId(),
    recipes.list({ includeDeleted: true }),
    categories.list({ includeDeleted: true }),
    tags.list({ includeDeleted: true }),
    photos.listHashes(),
  ]);
  const photoRows = await db.photos.bulkGet(hashes);
  const bundlePhotos: BundlePhoto[] = [];
  for (const p of photoRows) {
    if (!p) continue;
    const meta: BundlePhoto = {
      hash: p.hash,
      mime: p.mime,
      width: p.width,
      height: p.height,
      size: p.size,
      createdAt: p.createdAt,
    };
    if (includePhotoData) meta.data = bytesToBase64(await blobToBytes(p.blob));
    bundlePhotos.push(meta);
  }
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    createdAt: nowIso(),
    deviceId,
    appVersion: APP_VERSION,
    recipes: r,
    categories: c,
    tags: t,
    photos: bundlePhotos,
  };
}

/** `recipes-backup-YYYYMMDD-HHmm.json` in local time. */
export function bundleFileName(date: Date = new Date(), ext = 'json'): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}`;
  return `recipes-backup-${stamp}.${ext}`;
}

/** Serialises a bundle (compact JSON). */
export function bundleToJson(bundle: Bundle): string {
  return JSON.stringify(bundle);
}
