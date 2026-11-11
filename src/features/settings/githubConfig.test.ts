import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetDb, settings } from '../../db';
import { clearKey, createKeyCheck, storeKey } from '../../lib/crypto';
import { clearDeviceKey } from '../../lib/crypto/deviceKey';
import { forgetKey } from './keyState';
import { getGitHubConfig, loadGitHubForm, saveGitHubForm, TOKEN_PREFIX, type GitHubForm } from './githubConfig';

const TOKEN = 'test-token-at-rest-42';
const form: GitHubForm = { owner: 'octo', repo: 'data', branch: 'main', basePath: '', token: TOKEN };

async function rawToken(): Promise<unknown> {
  return (await db.settings.get('githubToken'))?.value;
}

beforeEach(async () => {
  await resetDb();
  await clearKey();
  await clearDeviceKey();
});

describe('GitHub token at rest', () => {
  it('stores an encrypted value, not the plain token', async () => {
    await saveGitHubForm(form);
    const raw = await rawToken();
    expect(typeof raw).toBe('string');
    expect(raw).not.toBe(TOKEN);
    expect(raw as string).not.toContain(TOKEN);
    expect((raw as string).startsWith(TOKEN_PREFIX)).toBe(true);
    // Nothing else in the settings table carries the token either.
    expect(JSON.stringify(await db.settings.toArray())).not.toContain(TOKEN);
  });

  it('round-trips through loadGitHubForm and getGitHubConfig', async () => {
    await saveGitHubForm(form);
    expect((await loadGitHubForm()).token).toBe(TOKEN);
    expect(await getGitHubConfig()).toEqual({ owner: 'octo', repo: 'data', branch: 'main', token: TOKEN });
  });

  it('migrates a legacy plain token on first load and removes the plain value', async () => {
    await settings.set('githubOwner', 'octo');
    await settings.set('githubRepo', 'data');
    await settings.set('githubBranch', 'main');
    await settings.set('githubToken', TOKEN); // pre-T23 format
    expect(await getGitHubConfig()).toEqual({ owner: 'octo', repo: 'data', branch: 'main', token: TOKEN });
    const raw = (await rawToken()) as string;
    expect(raw.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(raw).not.toContain(TOKEN);
    // Second load reads the encrypted value.
    expect((await loadGitHubForm()).token).toBe(TOKEN);
  });

  it('forgetting the passphrase key keeps the token', async () => {
    await saveGitHubForm(form);
    const { key } = await createKeyCheck('correct horse battery', { iterations: 1000 });
    await storeKey(key);
    await forgetKey();
    expect((await getGitHubConfig())?.token).toBe(TOKEN);
  });

  it('an unreadable value (device key lost) reads as no token, never as ciphertext', async () => {
    await saveGitHubForm(form);
    await clearDeviceKey();
    expect((await loadGitHubForm()).token).toBe('');
    expect(await getGitHubConfig()).toBeNull();
  });

  it('corrupted ciphertext reads as no token', async () => {
    await settings.set('githubToken', TOKEN_PREFIX + '{not json');
    expect((await loadGitHubForm()).token).toBe('');
  });

  it('an empty token is stored as empty', async () => {
    await saveGitHubForm({ ...form, token: '' });
    expect(await rawToken()).toBe('');
    expect((await loadGitHubForm()).token).toBe('');
  });
});
