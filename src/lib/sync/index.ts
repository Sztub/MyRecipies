// Sync engine (T40) – see README.md "Sync between devices". Transport + UI live in T43.
export { mergeSnapshot, sameRecord, deepEqual, emptySnapshot, SYNC_ENTITIES } from './merge';
export type {
  Snapshot,
  SyncEntity,
  AnyRecord,
  EntityRecordMap,
  MergeResult,
  MergeChange,
  MergeConflict,
  MergeOutcome,
  MergeOptions,
} from './merge';
export {
  applyMerge,
  syncPeer,
  loadLocalSnapshot,
  loadBase,
  listConflicts,
  resolveConflict,
  conflictId,
  ConflictNotFoundError,
} from './store';
export type { SyncConflict } from './store';
export { syncWithGitHub, listPeerIds } from './github';
export type { SyncProgress, SyncResult, SyncOptions, PeerSummary, PeerStatus } from './github';
