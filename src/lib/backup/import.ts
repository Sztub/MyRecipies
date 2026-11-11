import { categories, db, recipes, tags } from '../../db';
import type { Photo, SyncMeta } from '../../domain/types';
import { base64ToBytes } from '../crypto/base64';
import { blobToBytes, sha256Hex } from './bytes';
import { createSafetyExport, type SafetyExport } from './safety';
import type { Bundle, BundlePhoto } from './schema';

export type ImportMode = 'replace' | 'merge-add-missing';

export interface EntityCounts {
  /** Written to the DB. */
  added: number;
  /** Already present locally (merge) – left untouched. Always 0 for replace. */
  skipped: number;
}

export interface ImportReport {
  mode: ImportMode;
  recipes: EntityCounts;
  categories: EntityCounts;
  tags: EntityCounts;
  photos: EntityCounts & {
    /** No bytes available (no `data`, resolver returned nothing, not stored locally). */
    missing: string[];
    /** Bytes did not match `hash`/`size`, or base64 was malformed – not stored. */
    invalid: string[];
  };
  /** Set for `replace`: the automatic safety export made before wiping. */
  safetyExport?: SafetyExport;
}

/**
 * Supplies photo bytes for bundle photos without `data` (GitHub backup, T09: fetch + decrypt).
 * Return `undefined` if unavailable. Called only for photos not already stored locally.
 */
export type PhotoResolver = (
  photo: BundlePhoto,
) => Promise<Blob | Uint8Array<ArrayBuffer> | undefined>;

export interface ImportOptions {
  resolvePhoto?: PhotoResolver;
  /** Called after each resolved photo (for progress UI). */
  onPhotoProgress?: (done: number, total: number) => void;
}

/** Resolves and verifies the photos that need writing. Runs before any DB write. */
async function resolvePhotos(
  bundle: Bundle,
  opts: ImportOptions,
): Promise<{ toWrite: Photo[]; present: string[]; missing: string[]; invalid: string[] }> {
  const toWrite: Photo[] = [];
  const present: string[] = [];
  const missing: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const list = bundle.photos.filter((p) => !seen.has(p.hash) && seen.add(p.hash));
  let done = 0;
  for (const meta of list) {
    if ((await db.photos.where('hash').equals(meta.hash).count()) > 0) {
      present.push(meta.hash);
    } else {
      let bytes: Uint8Array<ArrayBuffer> | undefined;
      try {
        if (meta.data !== undefined) {
          bytes = base64ToBytes(meta.data);
        } else if (opts.resolvePhoto) {
          const got = await opts.resolvePhoto(meta);
          if (got) bytes = got instanceof Uint8Array ? got : await blobToBytes(got);
        }
      } catch {
        invalid.push(meta.hash);
        bytes = undefined;
      }
      if (bytes) {
        if (bytes.length !== meta.size || (await sha256Hex(bytes)) !== meta.hash) {
          invalid.push(meta.hash);
        } else {
          toWrite.push({
            hash: meta.hash,
            mime: meta.mime,
            width: meta.width,
            height: meta.height,
            size: meta.size,
            blob: new Blob([bytes], { type: meta.mime }),
            createdAt: meta.createdAt ?? bundle.createdAt,
          });
        }
      } else if (!invalid.includes(meta.hash)) {
        missing.push(meta.hash);
      }
    }
    opts.onPhotoProgress?.(++done, list.length);
  }
  return { toWrite, present, missing, invalid };
}

/** Items whose `id` is not present locally (tombstones count as present). */
async function onlyMissing<T extends SyncMeta>(
  items: T[],
  existingIds: () => Promise<string[]>,
): Promise<T[]> {
  const have = new Set(await existingIds());
  return items.filter((x) => !have.has(x.id));
}

/**
 * Imports a parsed bundle.
 *
 * - `replace`: first stores an automatic safety export (see `createSafetyExport`), then replaces
 *   all recipes, categories and tags with the bundle's (incl. tombstones) and keeps only the photos
 *   referenced by the bundle (already-stored photos are reused, never re-downloaded).
 * - `merge-add-missing`: adds recipes/categories/tags whose UUID is not present locally
 *   (local tombstones count as present) and photos whose hash is missing. Never overwrites.
 *
 * Photo bytes come from `photo.data` (local export) or `opts.resolvePhoto` (GitHub backup).
 * All photos are resolved and verified *before* the DB is touched; writes happen in one
 * transaction, so a failure leaves the DB unchanged.
 */
export async function importBundle(
  bundle: Bundle,
  mode: ImportMode,
  opts: ImportOptions = {},
): Promise<ImportReport> {
  const resolved = await resolvePhotos(bundle, opts);
  const photoReport = {
    added: resolved.toWrite.length,
    skipped: mode === 'merge-add-missing' ? resolved.present.length : 0,
    missing: resolved.missing,
    invalid: resolved.invalid,
  };

  if (mode === 'replace') {
    const safetyExport = await createSafetyExport();
    const keep = new Set(bundle.photos.map((p) => p.hash));
    await db.transaction('rw', [db.recipes, db.categories, db.tags, db.photos], async () => {
      await Promise.all([db.recipes.clear(), db.categories.clear(), db.tags.clear()]);
      const stale = (await db.photos.toCollection().primaryKeys())
        .map(String)
        .filter((h) => !keep.has(h));
      await db.photos.bulkDelete(stale);
      await recipes.putRaw(bundle.recipes);
      await categories.putRaw(bundle.categories);
      await tags.putRaw(bundle.tags);
      await db.photos.bulkPut(resolved.toWrite);
    });
    return {
      mode,
      recipes: { added: bundle.recipes.length, skipped: 0 },
      categories: { added: bundle.categories.length, skipped: 0 },
      tags: { added: bundle.tags.length, skipped: 0 },
      photos: { ...photoReport, added: photoReport.added + resolved.present.length },
      safetyExport,
    };
  }

  return db.transaction('rw', [db.recipes, db.categories, db.tags, db.photos], async () => {
    const ids = (t: typeof db.recipes | typeof db.categories | typeof db.tags) => () =>
      t.toCollection().primaryKeys() as Promise<string[]>;
    const r = await onlyMissing(bundle.recipes, ids(db.recipes));
    const c = await onlyMissing(bundle.categories, ids(db.categories));
    const t = await onlyMissing(bundle.tags, ids(db.tags));
    await recipes.putRaw(r);
    await categories.putRaw(c);
    await tags.putRaw(t);
    // Re-check inside the transaction so a concurrently added photo is not overwritten.
    const have = new Set((await db.photos.toCollection().primaryKeys()).map(String));
    await db.photos.bulkAdd(resolved.toWrite.filter((p) => !have.has(p.hash)));
    return {
      mode,
      recipes: { added: r.length, skipped: bundle.recipes.length - r.length },
      categories: { added: c.length, skipped: bundle.categories.length - c.length },
      tags: { added: t.length, skipped: bundle.tags.length - t.length },
      photos: photoReport,
    };
  });
}
