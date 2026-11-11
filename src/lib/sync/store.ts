// Persistence side of the sync engine: snapshots, per-peer base, conflict store (Dexie). No network.

import type { Table } from 'dexie';
import { db, type SyncBaseRow, type SyncConflictRow } from '../../db/db';
import { getDeviceId } from '../../db/device';
import { nowIso } from '../../domain/ids';
import type { SyncMeta } from '../../domain/types';
import {
  SYNC_ENTITIES,
  emptySnapshot,
  mergeSnapshot,
  type AnyRecord,
  type MergeResult,
  type Snapshot,
  type SyncEntity,
} from './merge';

export type SyncConflict = SyncConflictRow;

function entityTable(entity: SyncEntity): Table<AnyRecord, string> {
  return db[entity] as unknown as Table<AnyRecord, string>;
}

const allTables = () => [db.recipes, db.categories, db.tags, db.syncBase, db.syncConflicts];

export function conflictId(peerId: string, entity: SyncEntity, recordId: string): string {
  return `${peerId}|${entity}|${recordId}`;
}

/** Full local state incl. tombstones. */
export async function loadLocalSnapshot(): Promise<Snapshot> {
  return db.transaction('r', db.recipes, db.categories, db.tags, async () => ({
    recipes: await db.recipes.toArray(),
    categories: await db.categories.toArray(),
    tags: await db.tags.toArray(),
  }));
}

/** The last versions we saw from `peerId` (empty before the first sync). */
export async function loadBase(peerId: string): Promise<Snapshot> {
  const rows = await db.syncBase.where('peerId').equals(peerId).toArray();
  const base = emptySnapshot();
  for (const row of rows) (base[row.entity] as AnyRecord[]).push(row.record);
  return base;
}

/**
 * Persists a merge in one transaction: writes changed records (combined ones get this device's
 * `deviceId` and `updatedAt` = now), replaces the peer's base with `remote`, stores new conflicts and
 * drops open conflicts with this peer for records that are now settled.
 */
export async function applyMerge(
  peerId: string,
  peerName: string,
  remote: Snapshot,
  result: MergeResult,
): Promise<void> {
  const deviceId = await getDeviceId();
  await db.transaction('rw', allTables(), () =>
    writeMerge(peerId, peerName, remote, result, deviceId),
  );
}

async function writeMerge(
  peerId: string,
  peerName: string,
  remote: Snapshot,
  result: MergeResult,
  deviceId: string,
): Promise<void> {
  const now = nowIso();
  for (const ch of result.changes) {
    const record = ch.kind === 'combine' ? { ...ch.record, deviceId, updatedAt: now } : ch.record;
    await entityTable(ch.entity).put(record);
  }

  await db.syncBase.where('peerId').equals(peerId).delete();
  const baseRows: SyncBaseRow[] = [];
  for (const entity of SYNC_ENTITIES) {
    for (const record of remote[entity]) baseRows.push({ peerId, entity, id: record.id, record });
  }
  await db.syncBase.bulkPut(baseRows);

  const settled = result.outcomes
    .filter((o) => o.outcome === 'same' || o.outcome === 'take-remote' || o.outcome === 'combine')
    .map((o) => conflictId(peerId, o.entity, o.recordId));
  await db.syncConflicts.bulkDelete(settled);

  const existing = new Map(
    (await db.syncConflicts.where('peerId').equals(peerId).toArray()).map((c) => [c.id, c]),
  );
  await db.syncConflicts.bulkPut(
    result.conflicts.map((c) => {
      const id = conflictId(peerId, c.entity, c.recordId);
      return {
        id,
        entity: c.entity,
        recordId: c.recordId,
        peerId,
        peerName,
        local: c.local,
        remote: c.remote,
        createdAt: existing.get(id)?.createdAt ?? now,
      };
    }),
  );
}

/**
 * Convenience for the transport (T43): merge one peer's snapshot into local state atomically
 * (read local + base, merge, write — all in one transaction).
 */
export async function syncPeer(
  peerId: string,
  peerName: string,
  remote: Snapshot,
): Promise<MergeResult> {
  const deviceId = await getDeviceId();
  return db.transaction('rw', allTables(), async () => {
    const result = mergeSnapshot(await loadLocalSnapshot(), remote, await loadBase(peerId), {
      deviceId,
      now: nowIso(),
    });
    await writeMerge(peerId, peerName, remote, result, deviceId);
    return result;
  });
}

/** Open conflicts, oldest first. */
export async function listConflicts(): Promise<SyncConflict[]> {
  return (await db.syncConflicts.toArray()).sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export class ConflictNotFoundError extends Error {
  constructor(id: string) {
    super(`Sync conflict not found: ${id}`);
    this.name = 'ConflictNotFoundError';
  }
}

/**
 * Resolves a conflict. 'mine' keeps the current local record, 'theirs' takes the peer's version
 * (a tombstone deletes), a record = the human's edited version. The winner is written with
 * `rev = max(local, remote) + 1`, this device and now, and the conflict is removed.
 */
export async function resolveConflict(
  id: string,
  choice: 'mine' | 'theirs' | AnyRecord,
): Promise<AnyRecord> {
  const deviceId = await getDeviceId();
  return db.transaction('rw', allTables(), async () => {
    const conflict = await db.syncConflicts.get(id);
    if (!conflict) throw new ConflictNotFoundError(id);
    const table = entityTable(conflict.entity);
    const current = (await table.get(conflict.recordId)) ?? conflict.local;
    const content: SyncMeta =
      choice === 'mine' ? current : choice === 'theirs' ? conflict.remote : choice;
    const { deleted, ...rest } = stripMeta(content);
    const record = {
      ...rest,
      id: conflict.recordId,
      createdAt: current.createdAt,
      updatedAt: nowIso(),
      deviceId,
      rev: Math.max(current.rev, conflict.remote.rev, conflict.local.rev) + 1,
      ...(deleted ? { deleted: true } : {}),
    } as AnyRecord;
    await table.put(record);
    await db.syncConflicts.delete(id);
    return record;
  });
}

function stripMeta(r: SyncMeta): Record<string, unknown> & { deleted?: boolean } {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdAt, updatedAt, deviceId, rev, ...rest } = r;
  return rest;
}
