import { useEffect, useState } from 'react';

type Sentinel = { release: () => Promise<void> };
type WakeLockApi = { request: (type: 'screen') => Promise<Sentinel> };

export type WakeLockState = 'active' | 'unsupported' | 'failed';

/** Keeps the screen awake while mounted; re-acquires when the tab becomes visible again. */
export function useWakeLock(): WakeLockState {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supported) return;
    const api = (navigator as Navigator & { wakeLock: WakeLockApi }).wakeLock;
    let sentinel: Sentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await api.request('screen');
        if (cancelled) {
          void s.release().catch(() => undefined);
          return;
        }
        sentinel = s;
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, [supported]);

  if (!supported) return 'unsupported';
  return failed ? 'failed' : 'active';
}
