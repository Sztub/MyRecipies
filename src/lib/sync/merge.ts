// Pure record merge (docs/HOW-IT-WORKS.md "Sync between devices"). No Dexie, no clock, no network.
//
// Per record we look at three versions: L (local), R (remote = peer's latest.enc), B (base = the last
// version of that record we saw from this peer). Comparison ignores meta fields; `deleted` is compared
// as a state (alive vs tombstone), and two tombstones are always equal.

import type { Category, Recipe, SyncMeta, Tag } from '../../domain/types';

export type SyncEntity = 'recipes' | 'categories' | 'tags';
export const SYNC_ENTITIES: readonly SyncEntity[] = ['recipes', 'categories', 'tags'];

/** Same shapes as the backup bundle (tombstones included). */
export interface Snapshot {
  recipes: Recipe[];
  categories: Category[];
  tags: Tag[];
}

export interface EntityRecordMap {
  recipes: Recipe;
  categories: Category;
  tags: Tag;
}

export type AnyRecord = Recipe | Category | Tag;

/** What happened to one record (only records that exist on the remote side are reported). */
export type MergeOutcome =
  | 'same' // local == remote, nothing to do
  | 'keep-local' // only local changed (or remote unchanged since base)
  | 'take-remote' // only remote changed → remote copied verbatim
  | 'add' // record only on the remote side → added verbatim
  | 'combine' // both changed different fields → combined record, rev bumped
  | 'conflict'; // needs a human; local stays active

export interface MergeChange<E extends SyncEntity = SyncEntity> {
  entity: E;
  kind: 'add' | 'take-remote' | 'combine';
  record: EntityRecordMap[E];
}

export interface MergeConflict<E extends SyncEntity = SyncEntity> {
  entity: E;
  recordId: string;
  /** 'first-sync' = no base yet; 'delete-edit' = tombstone on one side, edit on the other. */
  reason: 'same-field' | 'first-sync' | 'delete-edit';
  /** Top-level fields that conflict (empty for 'delete-edit'). */
  fields: string[];
  local: EntityRecordMap[E];
  remote: EntityRecordMap[E];
}

export interface MergeResult {
  /** Records to write locally. */
  changes: MergeChange[];
  conflicts: MergeConflict[];
  /** Per entity and record id (remote ids only). */
  outcomes: { entity: SyncEntity; recordId: string; outcome: MergeOutcome }[];
}

export interface MergeOptions {
  /** Stamped on combined records. Defaults to the local record's deviceId (applyMerge restamps). */
  deviceId?: string;
  /** ISO time stamped on combined records. Defaults to the local record's updatedAt (applyMerge restamps). */
  now?: string;
}

const META_KEYS: ReadonlySet<string> = new Set<keyof SyncMeta>([
  'id',
  'createdAt',
  'updatedAt',
  'deviceId',
  'rev',
  'deleted',
]);

/** Structural equality for JSON-like values; a missing key equals an `undefined` value. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!deepEqual(ao[k], bo[k])) return false;
  return true;
}

function contentKeys(...records: SyncMeta[]): string[] {
  const keys = new Set<string>();
  for (const r of records) for (const k of Object.keys(r)) if (!META_KEYS.has(k)) keys.add(k);
  return [...keys].sort();
}

function field(r: SyncMeta, k: string): unknown {
  return (r as unknown as Record<string, unknown>)[k];
}

/** Content equality: meta ignored, tombstone state compared, two tombstones always equal. */
export function sameRecord<T extends SyncMeta>(a: T, b: T): boolean {
  const ad = !!a.deleted;
  const bd = !!b.deleted;
  if (ad !== bd) return false;
  if (ad) return true;
  return contentKeys(a, b).every((k) => deepEqual(field(a, k), field(b, k)));
}

function mergeRecord<T extends AnyRecord>(
  l: T,
  r: T,
  b: T | undefined,
  opts: MergeOptions,
):
  | { outcome: 'same' | 'keep-local' | 'take-remote' }
  | { outcome: 'combine'; record: T }
  | { outcome: 'conflict'; reason: MergeConflict['reason']; fields: string[] } {
  if (sameRecord(l, r)) return { outcome: 'same' };
  if (!b) return { outcome: 'conflict', reason: 'first-sync', fields: diffFields(l, r) };
  const remoteChanged = !sameRecord(r, b);
  const localChanged = !sameRecord(l, b);
  if (!remoteChanged) return { outcome: 'keep-local' };
  if (!localChanged) return { outcome: 'take-remote' };
  if (l.deleted || r.deleted) return { outcome: 'conflict', reason: 'delete-edit', fields: [] };

  const merged: Record<string, unknown> = {};
  const conflicting: string[] = [];
  for (const k of contentKeys(l, r, b)) {
    const lv = field(l, k);
    const rv = field(r, k);
    const bv = field(b, k);
    const lc = !deepEqual(lv, bv);
    const rc = !deepEqual(rv, bv);
    if (lc && rc && !deepEqual(lv, rv)) conflicting.push(k);
    const v = rc ? rv : lv;
    if (v !== undefined) merged[k] = v;
  }
  if (conflicting.length) return { outcome: 'conflict', reason: 'same-field', fields: conflicting };

  const record = {
    ...merged,
    id: l.id,
    createdAt: l.createdAt,
    updatedAt: opts.now ?? l.updatedAt,
    deviceId: opts.deviceId ?? l.deviceId,
    rev: Math.max(l.rev, r.rev) + 1,
  } as unknown as T;
  // Combining can reproduce one side exactly (e.g. both made the same edit): avoid rev churn.
  if (sameRecord(record, r)) return { outcome: 'take-remote' };
  if (sameRecord(record, l)) return { outcome: 'keep-local' };
  return { outcome: 'combine', record };
}

function diffFields(a: SyncMeta, b: SyncMeta): string[] {
  if (!!a.deleted !== !!b.deleted) return [];
  return contentKeys(a, b).filter((k) => !deepEqual(field(a, k), field(b, k)));
}

function byId<T extends SyncMeta>(list: readonly T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

/**
 * Merges a peer's snapshot into the local one, record by record and field by field.
 * Pure: returns what to write; `applyMerge` persists it.
 */
export function mergeSnapshot(
  local: Snapshot,
  remote: Snapshot,
  base: Snapshot,
  opts: MergeOptions = {},
): MergeResult {
  const result: MergeResult = { changes: [], conflicts: [], outcomes: [] };
  for (const entity of SYNC_ENTITIES) mergeEntity(entity, local, remote, base, opts, result);
  return result;
}

function mergeEntity<E extends SyncEntity>(
  entity: E,
  local: Snapshot,
  remote: Snapshot,
  base: Snapshot,
  opts: MergeOptions,
  result: MergeResult,
): void {
  type T = EntityRecordMap[E];
  const lMap = byId(local[entity] as T[]);
  const bMap = byId(base[entity] as T[]);
  for (const r of remote[entity] as T[]) {
    const l = lMap.get(r.id);
    const recordId = r.id;
    if (!l) {
      result.changes.push({ entity, kind: 'add', record: r } as MergeChange);
      result.outcomes.push({ entity, recordId, outcome: 'add' });
      continue;
    }
    const m = mergeRecord<T>(l, r, bMap.get(r.id), opts);
    result.outcomes.push({ entity, recordId, outcome: m.outcome });
    if (m.outcome === 'take-remote') {
      result.changes.push({ entity, kind: 'take-remote', record: r } as MergeChange);
    } else if (m.outcome === 'combine') {
      result.changes.push({ entity, kind: 'combine', record: m.record } as MergeChange);
    } else if (m.outcome === 'conflict') {
      result.conflicts.push({
        entity,
        recordId,
        reason: m.reason,
        fields: m.fields,
        local: l,
        remote: r,
      } as MergeConflict);
    }
  }
  // Records only on the local side are kept as they are (nothing to do).
}

export function emptySnapshot(): Snapshot {
  return { recipes: [], categories: [], tags: [] };
}
