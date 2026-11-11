import { settings } from '../../db';
import { getLanguage, setLanguage } from '../../i18n';
import { getKeepDaily, getKeepLast } from '../../lib/backup/github-backup';
import { loadGitHubForm, saveGitHubForm, validateGitHubForm } from '../settings/githubConfig';
import type { PairingData } from './payload';

/** What this (sending) device shares, or null when GitHub isn't fully set up here yet. */
export async function collectPairingData(now: Date = new Date()): Promise<PairingData | null> {
  const form = await loadGitHubForm();
  if (Object.keys(validateGitHubForm(form)).length > 0) return null;
  const [keepLast, keepDaily] = await Promise.all([getKeepLast(), getKeepDaily()]);
  return {
    v: 1,
    createdAt: now.toISOString(),
    github: {
      owner: form.owner.trim(),
      repo: form.repo.trim(),
      branch: form.branch.trim(),
      basePath: form.basePath.trim(),
      token: form.token.trim(),
    },
    language: getLanguage(),
    backupKeepLast: keepLast,
    backupKeepDaily: keepDaily,
  };
}

/** Saves received settings on this (receiving) device. The token is stored encrypted at rest (T23). */
export async function applyPairingData(data: PairingData): Promise<void> {
  await saveGitHubForm(data.github);
  if (data.backupKeepLast !== undefined) await settings.set('backupKeepLast', data.backupKeepLast);
  if (data.backupKeepDaily !== undefined)
    await settings.set('backupKeepDaily', data.backupKeepDaily);
  setLanguage(data.language);
}
