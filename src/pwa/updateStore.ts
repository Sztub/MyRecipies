import { useSyncExternalStore } from 'react';

/** Tiny store holding "a new version is waiting" and the function that applies it. */
type State = { needRefresh: boolean; apply: (() => Promise<void>) | null };

let state: State = { needRefresh: false, apply: null };
const listeners = new Set<() => void>();

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function setUpdateAvailable(apply: () => Promise<void>) {
  emit({ needRefresh: true, apply });
}

export function dismissUpdate() {
  emit({ needRefresh: false, apply: null });
}

export function useUpdateState(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
