// Domain types. They are stored in IndexedDB and in backups: changes must stay backward compatible.

export type UUID = string; // crypto.randomUUID()

export interface SyncMeta {
  id: UUID;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  deviceId: string;
  rev: number;
  deleted?: boolean; // tombstone
}

export type Unit =
  'g' | 'kg' | 'ml' | 'l' | 'pcs' | 'tbsp' | 'tsp' | 'glass' | 'pinch' | 'to_taste' | 'other';
// glass = szklanka (250 ml), tbsp = łyżka, tsp = łyżeczka, pinch = szczypta

export interface Ingredient {
  id: UUID;
  name: string;
  amount?: number;
  unit?: Unit;
  unitText?: string;
  note?: string;
}

export interface Step {
  id: UUID;
  text: string;
  photoHash?: string;
}

export interface Recipe extends SyncMeta {
  title: string;
  categoryId?: UUID;
  tagIds: UUID[];
  ingredients: Ingredient[];
  steps: Step[];
  servings?: number;
  notes?: string;
  photoHashes: string[];
  /** Run 3 (T46): shared family data, synced like any other field. Absent = not set. */
  favourite?: boolean;
  rating?: Rating;
  /** Local calendar date `YYYY-MM-DD`. */
  lastCookedAt?: string;
}

export type Rating = 1 | 2 | 3 | 4 | 5;

export interface Category extends SyncMeta {
  name: string;
  order: number;
}

export interface Tag extends SyncMeta {
  name: string;
}

export interface Photo {
  hash: string; // sha256 hex of stored bytes
  mime: string;
  width: number;
  height: number;
  size: number;
  blob: Blob;
  createdAt: string;
}

export type SyncMetaKey = keyof SyncMeta;

/**
 * Input accepted by `save()`: the entity without sync metadata. `id` is optional (new entity when
 * absent or unknown). Any meta fields passed in are ignored – the repository owns them.
 */
export type Draft<T extends SyncMeta> = Omit<T, SyncMetaKey> & Partial<SyncMeta>;
