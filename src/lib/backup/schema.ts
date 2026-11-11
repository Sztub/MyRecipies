// Backup bundle v1 – zod schema + parser (docs/HOW-IT-WORKS.md "Backup format").
//
// This module must stay free of browser/Dexie imports: it is reused by T09 (GitHub backup) and by
// T12's Node script `scripts/decrypt-backup.mjs`. Only `zod` and type-only imports are allowed.

import { z } from 'zod';
import type { Category, Recipe, Tag, Unit } from '../../domain/types';

export const BUNDLE_FORMAT = 'recipes-backup';
export const BUNDLE_VERSION = 1;

const UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'pcs',
  'tbsp',
  'tsp',
  'glass',
  'pinch',
  'to_taste',
  'other',
] as const satisfies readonly Unit[];

const syncMetaShape = {
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deviceId: z.string(),
  rev: z.number().int().nonnegative(),
  deleted: z.boolean().optional(),
};

export const ingredientSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  amount: z.number().optional(),
  unit: z.enum(UNITS).optional(),
  unitText: z.string().optional(),
  note: z.string().optional(),
});

export const stepSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  photoHash: z.string().optional(),
});

export const recipeSchema = z.object({
  ...syncMetaShape,
  title: z.string(),
  categoryId: z.string().optional(),
  tagIds: z.array(z.string()),
  ingredients: z.array(ingredientSchema),
  steps: z.array(stepSchema),
  servings: z.number().optional(),
  notes: z.string().optional(),
  photoHashes: z.array(z.string()),
  // Run 3 (T46) – optional so old backups still parse.
  favourite: z.boolean().optional(),
  rating: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
    .optional(),
  lastCookedAt: z.string().optional(),
});

export const categorySchema = z.object({
  ...syncMetaShape,
  name: z.string(),
  order: z.number(),
});

export const tagSchema = z.object({
  ...syncMetaShape,
  name: z.string(),
});

const SHA256_HEX = /^[0-9a-f]{64}$/;

export const bundlePhotoSchema = z.object({
  hash: z.string().regex(SHA256_HEX),
  mime: z.string().min(1),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  size: z.number().int().nonnegative(),
  /** Additive to the contract: original `Photo.createdAt`, so a round-trip is lossless. */
  createdAt: z.string().optional(),
  /** base64 of the stored bytes. Present in local export, absent in GitHub backup. */
  data: z.string().optional(),
});

export const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(BUNDLE_VERSION),
  createdAt: z.string(),
  deviceId: z.string(),
  appVersion: z.string(),
  recipes: z.array(recipeSchema),
  categories: z.array(categorySchema),
  tags: z.array(tagSchema),
  photos: z.array(bundlePhotoSchema),
});

export type Bundle = z.infer<typeof bundleSchema>;
export type BundlePhoto = z.infer<typeof bundlePhotoSchema>;

// Compile-time guards: the schema output must stay assignable to the domain types.
type Assert<T extends true> = T;
export type _RecipeMatches = Assert<z.infer<typeof recipeSchema> extends Recipe ? true : false>;
export type _CategoryMatches = Assert<
  z.infer<typeof categorySchema> extends Category ? true : false
>;
export type _TagMatches = Assert<z.infer<typeof tagSchema> extends Tag ? true : false>;

export type BundleErrorCode =
  'invalid-json' | 'wrong-format' | 'unsupported-version' | 'invalid-shape';

/** Thrown by `parseBundle`. `code` maps to i18n key `backup.error.<code>`. */
export class BundleError extends Error {
  readonly code: BundleErrorCode;
  /** Human-readable validation details (paths), for `invalid-shape`. Never contains secrets. */
  readonly details: string[];

  constructor(code: BundleErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'BundleError';
    this.code = code;
    this.details = details;
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Validates a bundle. Accepts a JSON string or an already parsed value.
 * Checks, in order: JSON syntax → `format` → `version` → full shape.
 */
export function parseBundle(json: unknown): Bundle {
  let value: unknown = json;
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json);
    } catch {
      throw new BundleError('invalid-json', 'File is not valid JSON');
    }
  }
  if (!isRecord(value) || value.format !== BUNDLE_FORMAT) {
    throw new BundleError('wrong-format', 'Not a recipes backup file');
  }
  if (value.version !== BUNDLE_VERSION) {
    throw new BundleError(
      'unsupported-version',
      `Unsupported backup version: ${String(value.version)}`,
    );
  }
  const result = bundleSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new BundleError('invalid-shape', 'Backup file has an invalid structure', details);
  }
  return result.data;
}

export interface BundleSummary {
  createdAt: string;
  deviceId: string;
  appVersion: string;
  recipes: number;
  categories: number;
  tags: number;
  photos: number;
  /** Tombstones across recipes/categories/tags (not included in the counts above). */
  deleted: number;
  /** True if every photo carries `data`. */
  hasPhotoData: boolean;
}

/** Counts for the import preview. Item counts exclude tombstones. */
export function summarizeBundle(b: Bundle): BundleSummary {
  const live = <T extends { deleted?: boolean }>(xs: T[]) => xs.filter((x) => !x.deleted).length;
  const deleted =
    b.recipes.length +
    b.categories.length +
    b.tags.length -
    live(b.recipes) -
    live(b.categories) -
    live(b.tags);
  return {
    createdAt: b.createdAt,
    deviceId: b.deviceId,
    appVersion: b.appVersion,
    recipes: live(b.recipes),
    categories: live(b.categories),
    tags: live(b.tags),
    photos: b.photos.length,
    deleted,
    hasPhotoData: b.photos.every((p) => p.data !== undefined),
  };
}
