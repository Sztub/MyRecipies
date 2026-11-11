import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { categories, recipes, resetDb } from '../../db';
import { t } from '../../i18n';
import { LocalBackup } from './LocalBackup';

const saved: { text: string; name: string }[] = [];
vi.mock('../../lib/backup/file', () => ({
  saveTextFile: vi.fn(async (text: string, name: string) => {
    saved.push({ text, name });
    return 'downloaded';
  }),
  downloadBlob: vi.fn(),
}));

function bundleFile(overrides: Record<string, unknown> = {}) {
  const bundle = {
    format: 'recipes-backup',
    version: 1,
    createdAt: '2026-03-01T12:00:00.000Z',
    deviceId: 'device-abc',
    appVersion: '0.1.0',
    recipes: [
      {
        id: 'r1',
        createdAt: '2026-03-01T12:00:00.000Z',
        updatedAt: '2026-03-01T12:00:00.000Z',
        deviceId: 'device-abc',
        rev: 1,
        title: 'Pierogi',
        tagIds: [],
        ingredients: [],
        steps: [],
        photoHashes: [],
      },
    ],
    categories: [],
    tags: [],
    photos: [],
    ...overrides,
  };
  return new File([JSON.stringify(bundle)], 'backup.json', { type: 'application/json' });
}

beforeEach(async () => {
  await resetDb();
  saved.length = 0;
});

describe('LocalBackup', () => {
  it('exports a bundle file', async () => {
    await recipes.save({ title: 'Soup', tagIds: [], ingredients: [], steps: [], photoHashes: [] });
    render(<LocalBackup />);
    await userEvent.click(screen.getByRole('button', { name: t('localBackup.export.button') }));
    expect(await screen.findByText(t('localBackup.export.done'))).toBeInTheDocument();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toMatch(/^recipes-backup-\d{8}-\d{4}\.json$/);
    const parsed = JSON.parse(saved[0]!.text) as { recipes: { title: string }[] };
    expect(parsed.recipes.map((r) => r.title)).toEqual(['Soup']);
  });

  it('previews and merges a backup file', async () => {
    render(<LocalBackup />);
    await userEvent.upload(screen.getByLabelText(t('localBackup.import.choose')), bundleFile());
    const preview = await screen.findByLabelText(t('localBackup.preview.title'));
    expect(preview).toHaveTextContent('device-abc');
    await userEvent.click(
      screen.getByRole('button', { name: t('localBackup.import.mergeButton') }),
    );
    expect(await screen.findByText(t('localBackup.import.done'))).toBeInTheDocument();
    expect((await recipes.get('r1'))?.title).toBe('Pierogi');
  });

  it('replace offers the safety copy', async () => {
    await categories.save({ name: 'Old', order: 1 });
    render(<LocalBackup />);
    await userEvent.upload(screen.getByLabelText(t('localBackup.import.choose')), bundleFile());
    await screen.findByLabelText(t('localBackup.preview.title'));
    await userEvent.click(screen.getByLabelText(new RegExp(t('localBackup.mode.replace.hint'))));
    expect(screen.getByRole('note')).toHaveTextContent(t('localBackup.mode.replace.warning'));
    await userEvent.click(
      screen.getByRole('button', { name: t('localBackup.import.replaceButton') }),
    );
    expect(await screen.findByText(t('localBackup.import.done'))).toBeInTheDocument();
    expect(await categories.list()).toEqual([]);
    await userEvent.click(
      screen.getByRole('button', { name: t('localBackup.report.safetyButton') }),
    );
    expect(saved[0]!.name).toMatch(/^recipes-backup-safety-/);
    expect(saved[0]!.text).toContain('"Old"');
  });

  it.each([
    [{ format: 'nope' }, 'localBackup.error.wrong-format'],
    [{ version: 99 }, 'localBackup.error.unsupported-version'],
    [{ recipes: [{ id: 1 }] }, 'localBackup.error.invalid-shape'],
  ] as const)('rejects invalid file %#', async (overrides, key) => {
    render(<LocalBackup />);
    await userEvent.upload(
      screen.getByLabelText(t('localBackup.import.choose')),
      bundleFile(overrides),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(t(key));
    expect(screen.queryByLabelText(t('localBackup.preview.title'))).not.toBeInTheDocument();
  });

  it('rejects non-JSON files', async () => {
    render(<LocalBackup />);
    await userEvent.upload(
      screen.getByLabelText(t('localBackup.import.choose')),
      new File(['hello'], 'x.json', { type: 'application/json' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(t('localBackup.error.invalid-json'));
  });
});
