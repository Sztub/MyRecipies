import Dexie, { type EntityTable, type Table } from 'dexie';
import type { Category, Photo, Recipe, Tag, UUID } from '../domain/types';

/** User-facing settings row (see `src/db/settings.ts`). */
export interface SettingRow {
  key: string;
  value: unknown;
}

/** Internal app state (device ID, seed flags…). Not user-facing settings. */
export interface KvRow {
  key: string;
  value: unknown;
}

/** Per peer device: the last version of each record we saw from it (T40, Run 3 "Sync model"). */
export interface SyncBaseRow {
  peerId: string;
  entity: 'recipes' | 'categories' | 'tags';
  id: UUID;
  record: Recipe | Category | Tag;
}

/** An unresolved merge conflict (T40). Local version stays active until resolved. */
export interface SyncConflictRow {
  id: string; // `${peerId}|${entity}|${recordId}` – one open conflict per peer and record
  entity: 'recipes' | 'categories' | 'tags';
  recordId: UUID;
  peerId: string;
  peerName: string;
  local: Recipe | Category | Tag;
  remote: Recipe | Category | Tag;
  createdAt: string;
}

export const DB_NAME = 'recipes';

export class RecipesDb extends Dexie {
  // IDs are always set by the repositories, so plain Table (not EntityTable's optional-id insert).
  recipes!: Table<Recipe, UUID>;
  categories!: Table<Category, UUID>;
  tags!: Table<Tag, UUID>;
  photos!: EntityTable<Photo, 'hash'>;
  settings!: EntityTable<SettingRow, 'key'>;
  kv!: EntityTable<KvRow, 'key'>;
  syncBase!: Table<SyncBaseRow, [string, string, string]>;
  syncConflicts!: EntityTable<SyncConflictRow, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      recipes: 'id, updatedAt, categoryId, *tagIds',
      categories: 'id, order',
      tags: 'id, name',
      photos: 'hash',
      settings: 'key',
      kv: 'key',
    });
    // v2 (T40): sync tables only; existing tables unchanged.
    this.version(2).stores({
      syncBase: '[peerId+entity+id], peerId',
      syncConflicts: 'id, peerId, [entity+recordId]',
    });
  }
}

/** The single shared database instance. */
export const db = new RecipesDb();

type ResetListener = () => void;
const resetListeners = new Set<ResetListener>();

/** Lets modules drop in-memory caches (e.g. device ID) when the DB is reset. */
export function onDbReset(listener: ResetListener): void {
  resetListeners.add(listener);
}

/** Tests only: delete all data and reopen the shared instance empty. */
export async function resetDb(): Promise<void> {
  db.close();
  await db.delete();
  resetListeners.forEach((l) => l());
  await db.open();
}
