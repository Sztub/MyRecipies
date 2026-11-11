// One GitHub repo operation at a time (backup, restore, sync) – across tabs too.
//
// A backup and a sync running together would both write latest.enc / device.json.enc and race on their shas,
// and a restore during a sync could be overwritten by the sync's merge. Callers queue instead of failing.

const LOCK_NAME = 'recipes-github-repo';

let chain: Promise<unknown> = Promise.resolve();

/** In-tab fallback where the Web Locks API is missing (old browsers, the Node test environment). */
function localLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/**
 * Runs `fn` while holding the repo lock. Not re-entrant: code that already holds it (sync calling its backup
 * step) must call the unlocked inner function instead.
 */
export function withRepoLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks && typeof locks.request === 'function') {
    return locks.request(LOCK_NAME, { mode: 'exclusive' }, fn) as Promise<T>;
  }
  return localLock(fn);
}
