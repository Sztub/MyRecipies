import { useEffect, useState } from 'react';

export type PersistStatus = 'persisted' | 'not-persisted' | 'unsupported';

export async function getPersistStatus(): Promise<PersistStatus> {
  if (!navigator.storage?.persisted) return 'unsupported';
  return (await navigator.storage.persisted()) ? 'persisted' : 'not-persisted';
}

/** Ask the browser not to evict our data. Returns the resulting status. */
export async function requestPersist(): Promise<PersistStatus> {
  if (!navigator.storage?.persist) return 'unsupported';
  try {
    if (!(await navigator.storage.persisted?.())) await navigator.storage.persist();
  } catch {
    // ignore: the status returned below reflects reality
  }
  return getPersistStatus();
}

export async function getStorageEstimate(): Promise<{ usage?: number; quota?: number }> {
  if (!navigator.storage?.estimate) return {};
  const { usage, quota } = await navigator.storage.estimate();
  return { usage, quota };
}

/** For Settings (T08): current persist status, with request() to retry. */
export function usePersistStatus() {
  const [status, setStatus] = useState<PersistStatus | null>(null);
  useEffect(() => {
    let live = true;
    void getPersistStatus().then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, []);
  const request = async () => {
    const s = await requestPersist();
    setStatus(s);
    return s;
  };
  return { status, request };
}
