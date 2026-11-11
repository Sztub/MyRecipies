import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db, recipes, resetDb, settings } from '../../db';
import type { Recipe } from '../../domain/types';
import { t } from '../../i18n';
import { KEYCHECK_PATH, devicePaths, envelopeToBytes } from '../../lib/backup/github-backup';
import { clearKey, createKeyCheck, encryptJson, storeKey, type KeyCheck } from '../../lib/crypto';
import { conflictId } from '../../lib/sync';
import { createMockGitHub } from '../../../test/mocks/github';
import { buildEdited, differingFields, isDeleteConflict } from './diff';
import { SyncBadge } from './SyncBadge';
import { SyncPage } from './SyncPage';
import { resetSyncStatusForTests } from './syncState';

const TOKEN = 'test-token-t43-ui';
const gh = createMockGitHub({ token: TOKEN, owner: 'octo', repo: 'data' });
const server = setupServer(...gh.handlers);
let key: CryptoKey;
let keyCheck: KeyCheck;

beforeAll(async () => {
  server.listen({ onUnhandledFrame: 'error' });
  ({ key, keyCheck } = await createKeyCheck('ui sync passphrase', { iterations: 1000 }));
});
afterAll(() => server.close());
beforeEach(async () => {
  gh.reset();
  gh.clearErrors();
  await resetDb();
  await clearKey();
  resetSyncStatusForTests();
});

async function configure() {
  await settings.set('githubOwner', 'octo');
  await settings.set('githubRepo', 'data');
  await settings.set('githubBranch', 'main');
  await settings.set('githubToken', TOKEN);
  await gh.seed(KEYCHECK_PATH, JSON.stringify(keyCheck));
  await storeKey(key);
}

function recipe(over: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r-1',
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    deviceId: 'peer-1',
    rev: 1,
    title: 'Bigos',
    tagIds: [],
    ingredients: [{ id: 'i1', name: 'cabbage', amount: 1, unit: 'kg' }],
    steps: [{ id: 's1', text: 'Stew' }],
    photoHashes: [],
    ...over,
  };
}

async function seedPeer(peerId: string, name: string, recs: Recipe[]) {
  const bundle = {
    format: 'recipes-backup',
    version: 1,
    createdAt: '2026-11-10T12:00:00.000Z',
    deviceId: peerId,
    appVersion: '0.1.0',
    recipes: recs,
    categories: [],
    tags: [],
    photos: [],
  };
  await gh.seed(devicePaths(peerId).latest, envelopeToBytes(await encryptJson(key, bundle)));
  await gh.seed(devicePaths(peerId).deviceInfo, envelopeToBytes(await encryptJson(key, { name })));
}

async function addConflict(local: Recipe, remote: Recipe) {
  await db.recipes.put(local);
  await db.syncConflicts.put({
    id: conflictId('peer-1', 'recipes', local.id),
    entity: 'recipes',
    recordId: local.id,
    peerId: 'peer-1',
    peerName: "Mum's iPhone",
    local,
    remote,
    createdAt: '2026-11-10T12:00:00.000Z',
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <SyncPage />
    </MemoryRouter>,
  );

describe('diff helpers', () => {
  it('lists differing content fields only, in display order', () => {
    const a = recipe();
    const b = recipe({ rev: 5, deviceId: 'x', notes: 'n', title: 'Other', ingredients: [] });
    expect(differingFields(a, b)).toEqual(['title', 'ingredients', 'notes']);
    expect(differingFields(a, { ...a, rev: 9 })).toEqual([]);
  });

  it('detects delete conflicts', () => {
    expect(isDeleteConflict(recipe(), recipe({ deleted: true }))).toBe(true);
    expect(isDeleteConflict(recipe(), recipe({ title: 'x' }))).toBe(false);
  });

  it('builds an edited record from per-field choices', () => {
    const local = recipe({ notes: 'mine' });
    const remote = recipe({ title: 'Theirs', notes: 'theirs', ingredients: [] });
    const out = buildEdited(local, remote, {
      title: { from: 'mine', text: 'Typed title' },
      ingredients: { from: 'theirs' },
      notes: { from: 'theirs', text: '' },
    }) as Recipe;
    expect(out.title).toBe('Typed title');
    expect(out.ingredients).toEqual([]);
    expect('notes' in out).toBe(false);
    expect(out.deleted).toBeUndefined();
  });
});

describe('SyncPage', () => {
  it('explains why Sync now is disabled without GitHub', async () => {
    renderPage();
    expect(await screen.findByTestId('sync-disabled-reason')).toHaveTextContent(t('sync.disabled.notConfigured'));
    expect(screen.getByRole('button', { name: t('sync.now.button') })).toBeDisabled();
  });

  it('syncs with another device and shows a summary', async () => {
    await configure();
    await seedPeer('peer-1', "Mum's iPhone", [recipe()]);
    renderPage();
    const button = screen.getByRole('button', { name: t('sync.now.button') });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    const summary = await screen.findByTestId('sync-summary', {}, { timeout: 5000 });
    expect(summary).toHaveTextContent(t('sync.done'));
    expect(summary).toHaveTextContent(`Mum's iPhone: ${t('sync.count.added', { count: 1 })}`);
    expect((await recipes.get('r-1'))?.title).toBe('Bigos');
    expect(screen.getByTestId('no-conflicts')).toBeInTheDocument();
  });

  it('network failure: clear message, nothing changed', async () => {
    await configure();
    await seedPeer('peer-1', 'Phone', [recipe()]);
    gh.injectError({ kind: 'network', method: 'GET', pathIncludes: 'latest.enc', times: 20 });
    renderPage();
    const button = screen.getByRole('button', { name: t('sync.now.button') });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert).toHaveTextContent(t('backup.error.network'));
    expect(alert).toHaveTextContent(t('backup.error.unchanged'));
    expect(await recipes.get('r-1')).toBeUndefined();
  });

  it('shows mine / theirs per field and keeps theirs', async () => {
    await addConflict(recipe({ title: 'Bigos mine', rev: 2 }), recipe({ title: 'Bigos theirs', rev: 2, notes: 'x' }));
    renderPage();
    const card = await screen.findByTestId('conflict');
    expect(within(card).getByText(t('sync.conflict.from', { name: "Mum's iPhone" }))).toBeInTheDocument();
    const titleRow = card.querySelector('[data-field="title"]') as HTMLElement;
    expect(titleRow).toHaveTextContent('Bigos mine');
    expect(titleRow).toHaveTextContent('Bigos theirs');
    expect(card.querySelector('[data-field="notes"]')).not.toBeNull();
    expect(card.querySelector('[data-field="ingredients"]')).toBeNull();

    await userEvent.click(within(card).getByRole('button', { name: t('sync.conflict.keepTheirs') }));
    await screen.findByText(t('sync.conflict.resolved'));
    expect(screen.getByTestId('no-conflicts')).toBeInTheDocument();
    const saved = await recipes.get('r-1');
    expect(saved?.title).toBe('Bigos theirs');
    expect(saved?.notes).toBe('x');
    expect(saved?.rev).toBe(3);
    expect(await db.syncConflicts.count()).toBe(0);
  });

  it('edit: pick per field and type a new title', async () => {
    await addConflict(
      recipe({ title: 'Mine', rev: 2 }),
      recipe({ title: 'Theirs', rev: 2, ingredients: [{ id: 'i2', name: 'pork', amount: 500, unit: 'g' }] }),
    );
    renderPage();
    const card = await screen.findByTestId('conflict');
    await userEvent.click(within(card).getByRole('button', { name: t('sync.conflict.edit') }));
    const ingRow = card.querySelector('[data-field="ingredients"]') as HTMLElement;
    await userEvent.click(within(ingRow).getByRole('radio', { name: t('sync.conflict.useTheirs') }));
    const input = within(card).getByRole('textbox', {
      name: t('sync.conflict.editField', { field: t('sync.field.title') }),
    });
    await userEvent.clear(input);
    await userEvent.type(input, 'Combined');
    await userEvent.click(within(card).getByRole('button', { name: t('sync.conflict.save') }));
    await screen.findByTestId('no-conflicts');
    const saved = await recipes.get('r-1');
    expect(saved?.title).toBe('Combined');
    expect(saved?.ingredients.map((i) => i.name)).toEqual(['pork']);
  });

  it('delete vs edit offers keep mine / keep theirs only', async () => {
    await addConflict(recipe({ title: 'Kept', rev: 2 }), recipe({ deleted: true, rev: 2 }));
    renderPage();
    const card = await screen.findByTestId('conflict');
    expect(within(card).getByText(t('sync.conflict.deleted'))).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: t('sync.conflict.edit') })).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: t('sync.conflict.keepMine') }));
    await screen.findByTestId('no-conflicts');
    expect((await recipes.get('r-1'))?.deleted).toBeFalsy();
  });
});

describe('SyncBadge', () => {
  it('shows the open conflict count and hides at zero', async () => {
    render(<SyncBadge />);
    expect(screen.queryByTestId('sync-badge')).toBeNull();
    await addConflict(recipe({ title: 'a' }), recipe({ title: 'b' }));
    expect(await screen.findByTestId('sync-badge')).toHaveTextContent(t('sync.badge', { count: 1 }));
    await db.syncConflicts.clear();
    await waitFor(() => expect(screen.queryByTestId('sync-badge')).toBeNull());
  });
});
