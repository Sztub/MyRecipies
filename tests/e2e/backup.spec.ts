import { test, expect, type Page } from '@playwright/test';
import { createMockGitHub } from '../../test/mocks/github';
import { goViaMenu } from './menu';

const TOKEN = 'test-token-e2e-backup';
const TITLE = 'Gołąbki-e2e-secret';

type MockGitHub = ReturnType<typeof createMockGitHub>;

async function mockGitHub(page: Page, gh: MockGitHub) {
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const body = req.postDataBuffer();
    const request = new Request(req.url(), {
      method: req.method(),
      headers: req.headers(),
      ...(body && req.method() !== 'GET' && req.method() !== 'HEAD'
        ? { body: new Uint8Array(body) }
        : {}),
    });
    const res = await gh.handle(request);
    await route.fulfill({
      status: res.status,
      headers: {
        ...Object.fromEntries(res.headers.entries()),
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
      },
      body: Buffer.from(await res.arrayBuffer()),
    });
  });
}

async function setUp(page: Page, gh: MockGitHub) {
  await mockGitHub(page, gh);
  await page.goto('/settings/github');
  await page.getByLabel('Właściciel', { exact: true }).fill('octo');
  await page.getByLabel('Repozytorium', { exact: true }).fill('data');
  await page.getByLabel('Token dostępu', { exact: true }).fill(TOKEN);
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByText('Zapisano.')).toBeVisible();
  await page.goto('/settings/encryption');
  await page.getByRole('button', { name: 'Zaproponuj hasło' }).click();
  await page.getByRole('button', { name: 'Skonfiguruj / odblokuj' }).click();
  await expect(page.getByTestId('key-state')).toHaveAttribute('data-state', 'unlocked', {
    timeout: 30_000,
  });
}

async function createRecipe(page: Page) {
  await page.goto('/');
  await goViaMenu(page, 'Nowy przepis');
  await page.getByLabel('Tytuł', { exact: true }).fill(TITLE);
  await page.getByLabel('Składnik 1', { exact: true }).fill('Cabbage-secret');
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByRole('heading', { level: 2, name: TITLE })).toBeVisible();
}

test('backup: back up, delete locally, restore from GitHub', async ({ page }) => {
  const gh = createMockGitHub({ token: TOKEN });
  await setUp(page, gh);
  await createRecipe(page);

  await page.goto('/backup');
  await expect(page.getByTestId('last-backup')).toContainText('Nigdy');
  await page.getByRole('button', { name: 'Zrób kopię teraz' }).click();
  await expect(page.getByText(/Kopia zakończona/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('last-backup')).not.toContainText('Nigdy');

  const backups = gh.paths().filter((p) => /^devices\/[^/]+\/backups\/.+\.enc$/.test(p));
  expect(backups).toHaveLength(1);
  for (const path of gh.paths()) {
    const text = gh.readText(path) ?? '';
    expect(text).not.toContain(TITLE);
    expect(text).not.toContain('Cabbage-secret');
    expect(text).not.toContain(TOKEN);
  }

  // Delete the recipe locally …
  await page.goto('/');
  await page.getByRole('link', { name: TITLE }).click();
  await page.getByRole('button', { name: 'Usuń' }).click();
  await page.getByRole('button', { name: 'Tak, usuń' }).click();
  await expect(page.getByRole('link', { name: TITLE })).toHaveCount(0);

  // … and restore it from GitHub (replace).
  await page.goto('/backup');
  await page.getByRole('button', { name: 'Pokaż kopie' }).click();
  await expect(page.getByText('(to urządzenie)')).toBeVisible();
  await page.getByRole('radio').first().check();
  await page.getByText('Zastępuje wszystko na tym urządzeniu zawartością kopii.').click();
  await page.getByRole('button', { name: 'Przywróć – zastąp wszystkie dane' }).click();
  await expect(page.getByText('Przywracanie zakończone.')).toBeVisible({ timeout: 30_000 });

  await page.goto('/');
  await expect(page.getByRole('link', { name: TITLE })).toBeVisible();
});

test('backup: an expired token shows a clear error', async ({ page }) => {
  const gh = createMockGitHub({ token: TOKEN });
  await setUp(page, gh);
  await page.goto('/backup');
  gh.injectError({ kind: 'token-expired', times: 100 });
  await page.getByRole('button', { name: 'Zrób kopię teraz' }).click();
  await expect(page.getByRole('alert')).toContainText('Twój token GitHub wygasł');
  await expect(page.getByRole('alert')).toContainText(
    'Nic na tym urządzeniu nie zostało zmienione.',
  );
});
