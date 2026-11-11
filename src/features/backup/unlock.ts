import { fetchKeyCheck, toBackupError, type BackupErrorKind } from '../../lib/backup/github-backup';
import { WrongPassphraseError, storeKey, unlock } from '../../lib/crypto';
import { getGitHubConfig, notifyKeyChanged } from '../settings';

export type UnlockResult =
  | { ok: true }
  /** `wrong-passphrase`: keycheck.json didn't open; `no-keycheck`: first setup – create the key in Settings. */
  | { ok: false; reason: 'wrong-passphrase' | BackupErrorKind };

/**
 * Unlocks this device with the passphrase against the repo's keycheck.json and stores the
 * non-extractable key (same as Settings → Encryption, but never creates a new key check).
 * The passphrase only lives in this call; it is never stored or logged.
 */
export async function unlockWithPassphrase(passphrase: string): Promise<UnlockResult> {
  try {
    const cfg = await getGitHubConfig();
    if (!cfg) return { ok: false, reason: 'not-configured' };
    const keyCheck = await fetchKeyCheck(cfg);
    if (!keyCheck) return { ok: false, reason: 'no-keycheck' };
    const key = await unlock(passphrase, keyCheck);
    await storeKey(key);
    notifyKeyChanged();
    return { ok: true };
  } catch (e) {
    if (e instanceof WrongPassphraseError) return { ok: false, reason: 'wrong-passphrase' };
    return { ok: false, reason: toBackupError(e).kind };
  }
}
