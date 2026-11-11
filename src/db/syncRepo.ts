import type { Table } from 'dexie';
import { newId, nowIso } from '../domain/ids';
import type { Draft, SyncMeta, UUID } from '../domain/types';
import { db } from './db';
import { getDeviceId } from './device';

export interface ListOptions {
  /** Include tombstones (`deleted: true`). For backup/export only. */
  includeDeleted?: boolean;
}

export interface GetOptions {
  includeDeleted?: boolean;
}

export interface SyncRepo<T extends SyncMeta> {
  /** Non-deleted items, sorted (see each repo). */
  list(opts?: ListOptions): Promise<T[]>;
  /** Returns undefined for unknown IDs and (by default) for tombstones. */
  get(id: UUID, opts?: GetOptions): Promise<T | undefined>;
  /**
   * Create or update. Sets `updatedAt`, `deviceId`, `rev++` (new = 1); keeps `createdAt` and
   * `deleted` of the stored record. Meta fields in the draft are ignored.
   */
  save(draft: Draft<T>): Promise<T>;
  /** Soft delete: `deleted: true`, `rev++`, `updatedAt`. Returns undefined for unknown/already deleted IDs. */
  softDelete(id: UUID): Promise<T | undefined>;
  /** Writes records exactly as given (meta untouched). For import/restore (T05/T09). */
  putRaw(items: T[]): Promise<void>;
}

function withoutMeta<T extends SyncMeta>(draft: Draft<T>): Omit<T, keyof SyncMeta> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdAt, updatedAt, deviceId, rev, deleted, ...rest } = draft;
  return rest as Omit<T, keyof SyncMeta>;
}

export function createSyncRepo<T extends SyncMeta>(
  table: () => Table<T, UUID>,
  compare: (a: T, b: T) => number,
): SyncRepo<T> {
  return {
    async list(opts = {}) {
      const all = await table().toArray();
      return all.filter((x) => opts.includeDeleted || !x.deleted).sort(compare);
    },

    async get(id, opts = {}) {
      const item = await table().get(id);
      if (!item || (item.deleted && !opts.includeDeleted)) return undefined;
      return item;
    },

    async save(draft) {
      const deviceId = await getDeviceId();
      return db.transaction('rw', table(), async () => {
        const id = draft.id ?? newId();
        const existing = await table().get(id);
        const now = nowIso();
        const record = {
          ...withoutMeta(draft),
          id,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          deviceId,
          rev: (existing?.rev ?? 0) + 1,
          ...(existing?.deleted ? { deleted: true } : {}),
        } as T;
        await table().put(record);
        return record;
      });
    },

    async softDelete(id) {
      const deviceId = await getDeviceId();
      return db.transaction('rw', table(), async () => {
        const existing = await table().get(id);
        if (!existing || existing.deleted) return undefined;
        const record: T = {
          ...existing,
          deleted: true,
          rev: existing.rev + 1,
          updatedAt: nowIso(),
          deviceId,
        };
        await table().put(record);
        return record;
      });
    },

    async putRaw(items) {
      await table().bulkPut(items);
    },
  };
}
