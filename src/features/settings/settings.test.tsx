import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, settings } from '../../db';
import { getLanguage, resetI18nForTests, setLanguage, t } from '../../i18n';
import { clearKey, loadKey } from '../../lib/crypto';
import { createMockGitHub } from '../../../test/mocks/github';
import {
  buildConfigFile,
  getGitHubConfig,
  parseConfigFile,
  validateGitHubForm,
  type GitHubForm,
} from './githubConfig';
import { EncryptionSection } from './EncryptionSection';
import { MemoryRouter } from 'react-router-dom';
import { BackupPage } from '../backup';
import { GitHubSettingsPage, SettingsPage } from './SettingsPage';

const TOKEN = 'test-token-unit-123';
const gh = createMockGitHub({ token: TOKEN, owner: 'octo', repo: 'data' });
const server = setupServer(...gh.handlers);
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
beforeEach(async () => {
  gh.reset();
  gh.clearErrors();
  gh.setToken(TOKEN);
  await resetDb();
  await clearKey();
});

const goodForm: GitHubForm = { owner: 'octo', repo: 'data', branch: 'main', basePath: '', token: TOKEN };

describe('validateGitHubForm', () => {
  it('accepts a good form', () => {
    expect(validateGitHubForm(goodForm)).toEqual({});
  });
  it('flags required and invalid fields', () => {
    const errs = validateGitHubForm({ owner: '', repo: 'a b', branch: ' ', basePath: '/x/../y', token: '' });
    expect(errs).toEqual({
      owner: 'required',
      repo: 'invalid',
      branch: 'required',
      basePath: 'invalid',
      token: 'required',
    });
  });
});

describe('config file', () => {
  it('never contains the token and round-trips', () => {
    const text = buildConfigFile({ form: goodForm, deviceName: 'Kitchen tablet', theme: 'warm', colorMode: 'dark' });
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('token');
    const parsed = parseConfigFile(text);
    expect(parsed?.github).toEqual({ owner: 'octo', repo: 'data', branch: 'main', basePath: '' });
    expect(parsed?.deviceName).toBe('Kitchen tablet');
  });
  it('rejects garbage', () => {
    expect(parseConfigFile('nope')).toBeNull();
    expect(parseConfigFile('{"format":"other"}')).toBeNull();
  });
});


async function fillGitHub(token = TOKEN) {
  const user = userEvent.setup();
  const owner = await screen.findByLabelText(t('settings.github.owner'));
  await waitFor(() => expect(owner).toBeEnabled());
  await user.type(owner, 'octo');
  await user.type(screen.getByLabelText(t('settings.github.repo')), 'data');
  await user.type(screen.getByLabelText(t('settings.github.token')), token);
  return user;
}

describe('SettingsPage – GitHub section', () => {
  it('shows validation errors and does not save', async () => {
    render(<GitHubSettingsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t('settings.github.save') }));
    expect(screen.getAllByText(t('settings.error.required')).length).toBeGreaterThanOrEqual(3);
    expect(await getGitHubConfig()).toBeNull();
  });

  it('saves settings; token is masked until Show is clicked', async () => {
    render(<GitHubSettingsPage />);
    const user = await fillGitHub();
    const tokenInput = screen.getByLabelText(t('settings.github.token'));
    expect(tokenInput).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: t('settings.github.showToken') }));
    expect(tokenInput).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: t('settings.github.save') }));
    expect(await screen.findByText(t('settings.github.saved'))).toBeInTheDocument();
    expect(await getGitHubConfig()).toEqual({ owner: 'octo', repo: 'data', branch: 'main', token: TOKEN });
    // #69: once saved, the form is replaced by the summary; Edit shows the token masked again.
    await user.click(screen.getByRole('button', { name: t('settings.github.edit') }));
    expect(screen.getByLabelText(t('settings.github.token'))).toHaveAttribute('type', 'password');
  });

  it('test connection succeeds', async () => {
    render(<GitHubSettingsPage />);
    const user = await fillGitHub();
    await user.click(screen.getByRole('button', { name: t('settings.github.test') }));
    expect(await screen.findByText(t('settings.github.test.ok'))).toBeInTheDocument();
  });

  it('reports a read-only token', async () => {
    const ro = createMockGitHub({ token: TOKEN, permissions: { admin: false, push: false, pull: true } });
    server.use(...ro.handlers);
    render(<GitHubSettingsPage />);
    const user = await fillGitHub();
    await user.click(screen.getByRole('button', { name: t('settings.github.test') }));
    expect(await screen.findByText(t('settings.github.test.okReadOnly'))).toBeInTheDocument();
    server.resetHandlers();
  });

  it.each([
    ['unauthorized', 'settings.github.test.unauthorized'],
    ['token-expired', 'settings.github.test.token-expired'],
    ['forbidden', 'settings.github.test.forbidden'],
    ['not-found', 'settings.github.test.not-found'],
    ['rate-limited', 'settings.github.test.rate-limited'],
    ['network', 'settings.github.test.network'],
    ['server', 'settings.github.test.unknown'],
  ] as const)('test connection error: %s', async (kind, key) => {
    gh.injectError({ kind });
    render(<GitHubSettingsPage />);
    const user = await fillGitHub();
    await user.click(screen.getByRole('button', { name: t('settings.github.test') }));
    expect(await screen.findByText(t(key))).toBeInTheDocument();
  });
});

describe('Run 4 – Settings sub-screens and GitHub summary', () => {
  it('#71 Settings home: language + style first, then links to the sub-screens with a status', async () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.slice(0, 4)).toEqual([
      t('settings.title'),
      t('settings.language.title'),
      t('settings.appearance.title'),
      t('settings.screens.title'),
    ]);
    for (const [name, href] of [
      [t('settings.github.title'), '/settings/github'],
      [t('settings.crypto.title'), '/settings/encryption'],
      [t('backup.title'), '/settings/backup'],
      [t('pairing.title'), '/settings/pairing'],
    ] as const) {
      expect(screen.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', href);
    }
    expect(await screen.findByText(t('settings.status.notConfigured'))).toBeInTheDocument();
    expect(await screen.findByText(t('settings.status.locked'))).toBeInTheDocument();
    expect(await screen.findByText(t('settings.status.noBackup'))).toBeInTheDocument();
    // The GitHub form itself is not on the home page any more.
    expect(screen.queryByLabelText(t('settings.github.owner'))).not.toBeInTheDocument();
  });

  it('#69 a saved GitHub config shows a summary; Edit opens the form, Cancel keeps the saved values', async () => {
    await settings.set('githubOwner', 'octo');
    await settings.set('githubRepo', 'data');
    await settings.set('githubBranch', 'main');
    await settings.set('githubBasePath', '');
    await settings.set('githubToken', TOKEN);
    render(<GitHubSettingsPage />);
    const summary = await screen.findByTestId('github-summary');
    expect(summary).toHaveTextContent('octo/data');
    expect(summary).toHaveTextContent(t('settings.github.tokenSaved'));
    expect(summary).not.toHaveTextContent(TOKEN);
    expect(screen.queryByLabelText(t('settings.github.owner'))).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t('settings.github.edit') }));
    const repo = screen.getByLabelText(t('settings.github.repo'));
    expect(repo).toHaveValue('data');
    await user.clear(repo);
    await user.type(repo, 'other');
    await user.click(screen.getByRole('button', { name: t('settings.github.cancel') }));
    expect(await screen.findByTestId('github-summary')).toHaveTextContent('octo/data');
    expect((await getGitHubConfig())?.repo).toBe('data');

    await user.click(screen.getByRole('button', { name: t('settings.github.edit') }));
    await user.clear(screen.getByLabelText(t('settings.github.repo')));
    await user.type(screen.getByLabelText(t('settings.github.repo')), 'recipes');
    await user.click(screen.getByRole('button', { name: t('settings.github.save') }));
    expect(await screen.findByTestId('github-summary')).toHaveTextContent('octo/recipes');
    expect(screen.getByText(t('settings.github.saved'))).toBeInTheDocument();
    expect((await getGitHubConfig())?.repo).toBe('recipes');
  });

  it('#69 test connection also works from the summary', async () => {
    await settings.set('githubOwner', 'octo');
    await settings.set('githubRepo', 'data');
    await settings.set('githubBranch', 'main');
    await settings.set('githubToken', TOKEN);
    render(<GitHubSettingsPage />);
    await screen.findByTestId('github-summary');
    await userEvent.click(screen.getByRole('button', { name: t('settings.github.test') }));
    expect(await screen.findByText(t('settings.github.test.ok'))).toBeInTheDocument();
  });
});

describe('EncryptionSection', () => {
  async function saveConfig() {
    await settings.set('githubOwner', 'octo');
    await settings.set('githubRepo', 'data');
    await settings.set('githubBranch', 'main');
    await settings.set('githubBasePath', '');
    await settings.set('githubToken', TOKEN);
  }

  it('asks for GitHub settings first', async () => {
    render(<EncryptionSection iterations={1000} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(t('settings.crypto.passphrase')), 'long enough pass');
    await user.click(screen.getByRole('button', { name: t('settings.crypto.submit') }));
    expect(await screen.findByText(t('settings.crypto.needGithub'))).toBeInTheDocument();
  });

  it('first setup uploads keycheck.json and stores the key; forget clears it', async () => {
    await saveConfig();
    render(<EncryptionSection iterations={1000} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(t('settings.crypto.passphrase')), 'correct horse battery');
    await user.type(screen.getByLabelText(t('settings.crypto.confirm')), 'different');
    await user.click(screen.getByRole('button', { name: t('settings.crypto.submit') }));
    expect(await screen.findByText(t('settings.crypto.mismatch'))).toBeInTheDocument();
    expect(gh.paths()).not.toContain('keycheck.json');

    await user.clear(screen.getByLabelText(t('settings.crypto.confirm')));
    await user.type(screen.getByLabelText(t('settings.crypto.confirm')), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: t('settings.crypto.submit') }));
    expect(await screen.findByText(t('settings.crypto.created'))).toBeInTheDocument();
    expect(gh.paths()).toContain('keycheck.json');
    expect(await loadKey()).not.toBeNull();
    expect(screen.getByTestId('key-state')).toHaveAttribute('data-state', 'unlocked');

    await user.click(screen.getByRole('button', { name: t('settings.crypto.forget') }));
    await waitFor(() => expect(screen.getByTestId('key-state')).toHaveAttribute('data-state', 'locked'));
    expect(await loadKey()).toBeNull();
  });

  it('unlocks with an existing keycheck.json; wrong passphrase is rejected', async () => {
    await saveConfig();
    const { createKeyCheck } = await import('../../lib/crypto');
    const { keyCheck } = await createKeyCheck('the right passphrase', { iterations: 1000 });
    await gh.seed('keycheck.json', JSON.stringify(keyCheck));
    render(<EncryptionSection iterations={1000} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(t('settings.crypto.passphrase')), 'a wrong passphrase');
    await user.click(screen.getByRole('button', { name: t('settings.crypto.submit') }));
    expect(await screen.findByText(t('settings.crypto.wrong'))).toBeInTheDocument();
    expect(await loadKey()).toBeNull();

    await user.clear(screen.getByLabelText(t('settings.crypto.passphrase')));
    await user.type(screen.getByLabelText(t('settings.crypto.passphrase')), 'the right passphrase');
    await user.click(screen.getByRole('button', { name: t('settings.crypto.submit') }));
    expect(await screen.findByText(t('settings.crypto.unlocked'))).toBeInTheDocument();
    expect(await loadKey()).not.toBeNull();
  });

  it('passphrase fields are hidden until Show is pressed; Suggest shows them (to write down)', async () => {
    render(<EncryptionSection iterations={1000} />);
    const user = userEvent.setup();
    const pass = await screen.findByLabelText(t('settings.crypto.passphrase'));
    const confirm = screen.getByLabelText(t('settings.crypto.confirm'));
    expect(pass).toHaveAttribute('type', 'password');
    expect(confirm).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: t('settings.crypto.show') }));
    expect(pass).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: t('settings.crypto.hide') }));
    expect(pass).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: t('settings.crypto.generate') }));
    await waitFor(() => expect(pass).toHaveAttribute('type', 'text'));
    expect(confirm).toHaveAttribute('type', 'text');
  });

  it('no keycheck.json and only one passphrase typed: explains, creates nothing', async () => {
    await saveConfig();
    render(<EncryptionSection iterations={1000} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(t('settings.crypto.passphrase')), 'meant to unlock');
    await user.click(screen.getByRole('button', { name: t('settings.crypto.submit') }));
    expect(
      await screen.findByText(t('settings.crypto.noKeyCheck', { where: 'octo/data (main)' })),
    ).toBeInTheDocument();
    expect(gh.paths()).not.toContain('keycheck.json');
    expect(await loadKey()).toBeNull();
  });

  it('refuses to create a new key when the repo already has backups but keycheck.json is gone', async () => {
    await saveConfig();
    await gh.seed('devices/abc/latest.enc', '{}');
    render(<EncryptionSection iterations={1000} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(t('settings.crypto.passphrase')), 'correct horse battery');
    await user.type(screen.getByLabelText(t('settings.crypto.confirm')), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: t('settings.crypto.submit') }));
    expect(
      await screen.findByText(t('settings.crypto.orphanData', { where: 'octo/data (main)' })),
    ).toBeInTheDocument();
    expect(gh.paths()).not.toContain('keycheck.json');
    expect(await loadKey()).toBeNull();
  });

  it('a GitHub error while looking for keycheck.json never leads to creating a key', async () => {
    await saveConfig();
    gh.injectError({ kind: 'server', method: 'GET', pathIncludes: 'keycheck.json', times: Infinity });
    render(<EncryptionSection iterations={1000} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(t('settings.crypto.passphrase')), 'correct horse battery');
    await user.type(screen.getByLabelText(t('settings.crypto.confirm')), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: t('settings.crypto.submit') }));
    expect(await screen.findByText(t('settings.crypto.githubError'))).toBeInTheDocument();
    gh.clearErrors();
    expect(gh.paths()).not.toContain('keycheck.json');
  });
});

describe('T41 – queue fixes', () => {
  afterEach(() => resetI18nForTests());

  it('#32 config file carries the UI language (and still no token)', () => {
    const text = buildConfigFile({ form: goodForm, deviceName: 'K', theme: 'warm', colorMode: 'light', language: 'en' });
    expect(text).not.toContain(TOKEN);
    expect(parseConfigFile(text)?.language).toBe('en');
    // Older files without a language, and invalid values, behave sanely.
    expect(parseConfigFile(buildConfigFile({ form: goodForm, deviceName: 'K', theme: 'warm', colorMode: 'light' }))?.language).toBeUndefined();
    expect(parseConfigFile('{"format":"recipes-settings","version":1,"language":"xx"}')).toBeNull();
  });

  it('#32 importing a settings file switches the UI language', async () => {
    render(<GitHubSettingsPage />);
    const file = new File(
      [buildConfigFile({ form: goodForm, deviceName: 'K', theme: 'warm', colorMode: 'light', language: 'en' })],
      'recipes-settings.json',
      { type: 'application/json' },
    );
    const input = (await screen.findByText(t('settings.config.import'))).querySelector('input') as HTMLInputElement;
    await userEvent.upload(input, file);
    await waitFor(() => expect(getLanguage()).toBe('en'));
  });

  it('#33 suggested passphrase uses the word list of the UI language', async () => {
    setLanguage('en');
    const { WORDS } = await import('./wordlists/en');
    await settings.set('githubOwner', 'octo');
    render(<EncryptionSection iterations={1000} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: t('settings.crypto.generate') }));
    const input = screen.getByLabelText(t('settings.crypto.passphrase')) as HTMLInputElement;
    await waitFor(() => expect(input.value).not.toBe(''));
    for (const w of input.value.split(' ')) expect(WORDS).toContain(w);
  });

  it('#43 Settings → Backup has keep-last and keep-daily', async () => {
    await settings.set('backupKeepLast', 7);
    render(
      <MemoryRouter>
        <BackupPage />
      </MemoryRouter>,
    );
    const last = await screen.findByLabelText(t('backup.keep.label'));
    await waitFor(() => expect(last).toHaveValue(7));
    await userEvent.clear(last);
    await userEvent.type(last, '3');
    await waitFor(async () => expect(await settings.get('backupKeepLast')).toBe(3));

    const daily = screen.getByLabelText(t('backup.keepDaily.label'));
    await waitFor(() => expect(daily).toHaveValue(0));
    await userEvent.clear(daily);
    await userEvent.type(daily, '14');
    await waitFor(async () => expect(await settings.get('backupKeepDaily')).toBe(14));
  });
});
