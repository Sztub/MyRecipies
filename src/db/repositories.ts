import type { Category, Photo, Recipe, Tag } from '../domain/types';
import { db } from './db';
import { createSyncRepo } from './syncRepo';

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** Recipes, listed by title. */
export const recipes = createSyncRepo<Recipe>(
  () => db.recipes,
  (a, b) => byText(a.title, b.title) || a.id.localeCompare(b.id),
);

/** Categories, listed by `order`, then name. */
export const categories = createSyncRepo<Category>(
  () => db.categories,
  (a, b) => a.order - b.order || byText(a.name, b.name),
);

/** Tags, listed by name. */
export const tags = createSyncRepo<Tag>(
  () => db.tags,
  (a, b) => byText(a.name, b.name) || a.id.localeCompare(b.id),
);

/** Content-addressed photo store (key = sha256 hex). Photos are immutable. */
export const photos = {
  /** Stores the photo; no-op if a photo with the same hash already exists. */
  async put(photo: Photo): Promise<void> {
    await db.transaction('rw', db.photos, async () => {
      if ((await db.photos.where('hash').equals(photo.hash).count()) === 0) {
        await db.photos.add(photo);
      }
    });
  },
  get(hash: string): Promise<Photo | undefined> {
    return db.photos.get(hash);
  },
  async has(hash: string): Promise<boolean> {
    return (await db.photos.where('hash').equals(hash).count()) > 0;
  },
  /** All stored hashes, sorted. */
  async listHashes(): Promise<string[]> {
    return (await db.photos.toCollection().primaryKeys()).map(String).sort();
  },
};
