import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, getDeviceId, recipes, resetDb, settings } from '../../db';
import { t } from '../../i18n';
import { KEYCHECK_PATH, devicePaths } from '../../lib/backup/github-backup';
import { clearKey, createKeyCheck, loadKey, storeKey, type KeyCheck } from '../../lib/crypto';
import { createMockGitHub } from '../../../test/mocks/github';
import { BackupPage, formatSize } from './BackupPage';

const TOKEN = 'test-token-t09-ui';
const gh = createMockGitHub({ token: TOKEN, owner: 'octo', repo: 'data' });
const server = setupServer(...gh.handlers);
let key: CryptoKey;
let keyCheck: KeyCheck;

beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  ({ key, keyCheck } = await createKeyCheck('ui test passphrase', { iterations: 1000 }));
});
afterAll(() => server.close());
beforeEach(async () => {
  gh.reset();
  gh.clearErrors();
  await resetDb();
  await clearKey();
});

async function configure() {
  await settings.set('githubOwner', 'octo');
  await settings.set('githubRepo', 'data');
  await settings.set('githubBranch', 'main');
  await settings.set('githubToken', TOKEN);
  await settings.set('deviceName', 'Kitchen tablet');
  await gh.seed(KEYCHECK_PATH, JSON.stringify(keyCheck));
  await storeKey(key);
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <BackupPage />
    </MemoryRouter>,
  );

describe('BackupPage', () => {
  it('asks to set up GitHub first', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 2, name: t('backup.title') })).toBeInTheDocument();
    expect(await screen.findByText(t('backup.needGithub'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('backup.toGithub') })).toHaveAttribute('href', '/settings/github');
    expect(screen.getByRole('button', { name: t('backup.now.button') })).toBeDisabled();
  });

  it('#50 disabled Back up now says why', async () => {
    renderPage();
    expect(await screen.findByTestId('backup-disabled-reason')).toHaveTextContent(t('backup.now.disabled.notConfigured'));
  });

  it('#50 locked key is explained, and the hint disappears once ready', async () => {
    await configure();
    await clearKey();
    renderPage();
    expect(await screen.findByTestId('backup-disabled-reason')).toHaveTextContent(t('backup.now.disabled.locked'));
    await storeKey(key);
    const { notifyKeyChanged } = await import('../settings');
    notifyKeyChanged();
    await waitFor(() => expect(screen.queryByTestId('backup-disabled-reason')).toBeNull());
  });

  it('#50 busy backup is explained while it runs', async () => {
    await configure();
    renderPage();
    const btn = screen.getByRole('button', { name: t('backup.now.button') });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    expect(await screen.findByTestId('backup-disabled-reason')).toHaveTextContent(t('backup.now.disabled.busy'));
    await waitFor(() => expect(screen.queryByTestId('backup-disabled-reason')).toBeNull());
  });

  it('asks for the passphrase when there is no key', async () => {
    await configure();
    await clearKey();
    renderPage();
    expect(await screen.findByTestId('backup-unlock')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('backup.now.button') })).toBeDisabled();
  });

  it('unlocks inline with the passphrase (wrong one first)', async () => {
    await configure();
    await clearKey();
    renderPage();
    const input = await screen.findByLabelText(t('backup.unlock.passphrase'));
    const submit = screen.getByRole('button', { name: t('backup.unlock.submit') });

    await userEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(t('backup.unlock.empty'));

    await userEvent.type(input, 'not the passphrase');
    await userEvent.click(submit);
    expect(await screen.findByText(t('backup.unlock.wrong'))).toBeInTheDocument();
    expect(await loadKey()).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, 'ui test passphrase');
    await userEvent.click(submit);
    const backupBtn = screen.getByRole('button', { name: t('backup.now.button') });
    await waitFor(() => expect(backupBtn).toBeEnabled());
    expect(screen.queryByTestId('backup-unlock')).not.toBeInTheDocument();
    expect(await loadKey()).not.toBeNull();
    // the passphrase is never stored as a setting
    const rows = await db.settings.toArray();
    expect(JSON.stringify(rows)).not.toContain('ui test passphrase');
  });

  it('inline unlock points to Settings when the repo has no key check yet', async () => {
    await configure();
    await clearKey();
    gh.remove(KEYCHECK_PATH);
    renderPage();
    await userEvent.type(await screen.findByLabelText(t('backup.unlock.passphrase')), 'anything at all');
    await userEvent.click(screen.getByRole('button', { name: t('backup.unlock.submit') }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('backup.unlock.noKeycheck'));
    expect(screen.getAllByRole('link', { name: t('backup.toEncryption') })[0]).toHaveAttribute('href', '/settings/encryption');
    expect(await loadKey()).toBeNull();
  });

  it('keep-last setting is saved and prunes this device after a backup', async () => {
    await configure();
    const deviceId = await getDeviceId();
    const dir = devicePaths(deviceId).backupsDir;
    for (let i = 1; i <= 4; i++) await gh.seed(`${dir}/2025-01-0${i}T00-00-00-000Z.enc`, '{}');
    renderPage();
    const field = await screen.findByLabelText(t('backup.keep.label'));
    await waitFor(() => expect(field).toHaveValue(20));
    await userEvent.clear(field);
    await userEvent.type(field, '2');
    await waitFor(async () => expect(await settings.get('backupKeepLast')).toBe(2));

    const backupBtn = screen.getByRole('button', { name: t('backup.now.button') });
    await waitFor(() => expect(backupBtn).toBeEnabled());
    await userEvent.click(backupBtn);
    expect(await screen.findByText(new RegExp(t('backup.now.prunedCount', { count: 3 })))).toBeInTheDocument();
    expect(gh.paths().filter((p) => p.startsWith(`${dir}/`))).toHaveLength(2);
  });

  it('keep-last ignores invalid input', async () => {
    await configure();
    renderPage();
    const field = await screen.findByLabelText(t('backup.keep.label'));
    await waitFor(() => expect(field).toHaveValue(20));
    await userEvent.clear(field);
    await userEvent.type(field, '0');
    await userEvent.tab();
    expect(field).toHaveValue(20);
    expect(await settings.get('backupKeepLast')).toBeUndefined();
  });

  it('shows a warning when pruning fails but the backup worked', async () => {
    await configure();
    await settings.set('backupKeepLast', 1);
    const dir = devicePaths(await getDeviceId()).backupsDir;
    await gh.seed(`${dir}/2025-01-01T00-00-00-000Z.enc`, '{}');
    gh.injectError({ kind: 'server', method: 'DELETE', times: Infinity });
    renderPage();
    const backupBtn = screen.getByRole('button', { name: t('backup.now.button') });
    await waitFor(() => expect(backupBtn).toBeEnabled());
    await userEvent.click(backupBtn);
    expect(await screen.findByText(new RegExp(t('backup.now.done')))).toBeInTheDocument();
    expect(screen.getByText(t('backup.now.pruneFailed'))).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('backs up, lists the backup and restores it', async () => {
    await configure();
    await recipes.save({ title: 'Bigos', tagIds: [], ingredients: [], steps: [], photoHashes: [] });
    renderPage();
    const backupBtn = screen.getByRole('button', { name: t('backup.now.button') });
    await waitFor(() => expect(backupBtn).toBeEnabled());
    expect(screen.getByTestId('last-backup')).toHaveTextContent(t('backup.last.never'));

    await userEvent.click(backupBtn);
    expect(await screen.findByText(new RegExp(t('backup.now.done')))).toBeInTheDocument();
    expect(screen.getByTestId('last-backup')).not.toHaveTextContent(t('backup.last.never'));
    expect(gh.paths().some((p) => p.includes('/backups/'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: t('backup.restore.load') }));
    expect(await screen.findByText('Kitchen tablet')).toBeInTheDocument();
    expect(screen.getByText(t('backup.restore.thisDevice'))).toBeInTheDocument();
    const restoreBtn = screen.getByRole('button', { name: t('backup.restore.button.merge') });
    expect(restoreBtn).toBeDisabled();

    await recipes.softDelete((await recipes.list())[0]!.id);
    const radios = screen.getAllByRole('radio');
    await userEvent.click(radios[0]!);
    await userEvent.click(restoreBtn);
    expect(await screen.findByText(t('backup.restore.done'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('localBackup.report.title'))).toBeInTheDocument();
  });

  it('shows a clear error and says nothing changed', async () => {
    await configure();
    renderPage();
    const backupBtn = screen.getByRole('button', { name: t('backup.now.button') });
    await waitFor(() => expect(backupBtn).toBeEnabled());
    gh.injectError({ kind: 'token-expired', times: Infinity });
    await userEvent.click(backupBtn);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('backup.error.token-expired'));
    expect(alert).toHaveTextContent(t('backup.error.unchanged'));
  });

  it('formats sizes', () => {
    expect(formatSize(500)).toBe('500 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
