// Pure helpers for the conflict screen: which top-level fields differ, and how to build an edited record.

import { deepEqual, type AnyRecord } from '../../lib/sync';

/** Meta fields are never shown or compared (same rule as the merge engine). */
const META = new Set(['id', 'createdAt', 'updatedAt', 'deviceId', 'rev', 'deleted']);

/** Preferred display order; unknown (future) fields follow alphabetically. */
const ORDER = [
  'title',
  'name',
  'categoryId',
  'tagIds',
  'servings',
  'ingredients',
  'steps',
  'notes',
  'photoHashes',
  'order',
];

function rank(field: string): number {
  const i = ORDER.indexOf(field);
  return i === -1 ? ORDER.length : i;
}

/**
 * Top-level content fields whose values differ between the two versions (an absent field and
 * `undefined` count as equal). Deletion is reported separately via `isDeleteConflict`.
 */
export function differingFields(local: AnyRecord, remote: AnyRecord): string[] {
  const l = local as unknown as Record<string, unknown>;
  const r = remote as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(l), ...Object.keys(r)]);
  return [...keys]
    .filter((k) => !META.has(k) && !deepEqual(l[k], r[k]))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** One side deleted the record, the other edited it. */
export function isDeleteConflict(local: AnyRecord, remote: AnyRecord): boolean {
  return !!local.deleted !== !!remote.deleted;
}

/** Fields the edit form offers a free-text box for (others are picked mine/theirs). */
export const TEXT_FIELDS: ReadonlySet<string> = new Set(['title', 'name', 'notes']);

export type FieldChoice = { from: 'mine' | 'theirs'; text?: string };

/**
 * The human's edited version: starts from the local record and, per differing field, takes the
 * chosen side (text fields may carry an edited value). Never deleted. Meta is fixed up by
 * `resolveConflict`.
 */
export function buildEdited(
  local: AnyRecord,
  remote: AnyRecord,
  choices: Record<string, FieldChoice>,
): AnyRecord {
  const out: Record<string, unknown> = { ...(local as unknown as Record<string, unknown>) };
  const r = remote as unknown as Record<string, unknown>;
  for (const [field, choice] of Object.entries(choices)) {
    if (META.has(field)) continue;
    let value = choice.from === 'theirs' ? r[field] : out[field];
    if (choice.text !== undefined && TEXT_FIELDS.has(field)) value = choice.text;
    if (value === undefined || (field === 'notes' && value === '')) delete out[field];
    else out[field] = value;
  }
  delete out.deleted;
  return out as unknown as AnyRecord;
}
