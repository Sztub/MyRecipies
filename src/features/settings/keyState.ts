import { useCallback, useEffect, useState } from 'react';
import { clearKey, loadKey } from '../../lib/crypto';

/**
 * Encryption key state on this device.
 * - `unlocked`: a key is stored in IndexedDB (backups/restores can run).
 * - `locked`: no key here; the user must enter the passphrase (first setup or existing keycheck.json –
 *   the Encryption section finds out which by looking at the repo).
 * - `loading`: not yet known.
 */
export type KeyState = 'loading' | 'unlocked' | 'locked';

const listeners = new Set<() => void>();
/** Call after storeKey/clearKey so every `useKeyState` consumer refreshes. */
export function notifyKeyChanged(): void {
  listeners.forEach((l) => l());
}

export async function getKeyState(): Promise<'unlocked' | 'locked'> {
  try {
    return (await loadKey()) ? 'unlocked' : 'locked';
  } catch {
    return 'locked';
  }
}

export async function forgetKey(): Promise<void> {
  await clearKey();
  notifyKeyChanged();
}

export function useKeyState(): { state: KeyState; refresh: () => void } {
  const [state, setState] = useState<KeyState>('loading');
  const refresh = useCallback(() => {
    void getKeyState().then(setState);
  }, []);
  useEffect(() => {
    refresh();
    listeners.add(refresh);
    return () => {
      listeners.delete(refresh);
    };
  }, [refresh]);
  return { state, refresh };
}
