import { test, expect, type Page } from '@playwright/test';
import { createMockGitHub } from '../../test/mocks/github';

const TOKEN = 'test-token-e2e-settings';

async function mockGitHub(page: Page, gh: ReturnType<typeof createMockGitHub>) {
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

async function fill(page: Page, token: string) {
  await page.goto('/settings/github');
  await page.getByLabel('Właściciel', { exact: true }).fill('octo');
  await page.getByLabel('Repozytorium', { exact: true }).fill('data');
  await page.getByLabel('Token dostępu', { exact: true }).fill(token);
}

test('settings: fill GitHub settings and test connection against the mock', async ({ page }) => {
  const gh = createMockGitHub({ token: TOKEN });
  await mockGitHub(page, gh);
  await fill(page, TOKEN);
  await page.getByRole('button', { name: 'Sprawdź połączenie' }).click();
  await expect(page.getByText('Połączenie działa.')).toBeVisible();

  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByText('Zapisano.')).toBeVisible();
  // #69: after a reload the saved settings are a summary; Edit opens the form with the saved values.
  await page.reload();
  const summary = page.getByTestId('github-summary');
  await expect(summary).toContainText('octo/data');
  await expect(summary).toContainText('zapisany (ukryty)');
  await expect(summary).not.toContainText(TOKEN);
  await page.getByRole('button', { name: 'Sprawdź połączenie' }).click();
  await expect(page.getByText('Połączenie działa.')).toBeVisible();
  await page.getByRole('button', { name: 'Edytuj' }).click();
  await expect(page.getByLabel('Właściciel', { exact: true })).toHaveValue('octo');
  await expect(page.getByLabel('Token dostępu', { exact: true })).toHaveAttribute(
    'type',
    'password',
  );
});

test('settings: a wrong token shows a clear error', async ({ page }) => {
  const gh = createMockGitHub({ token: TOKEN });
  await mockGitHub(page, gh);
  await fill(page, 'test-token-wrong');
  await page.getByRole('button', { name: 'Sprawdź połączenie' }).click();
  await expect(page.getByText('Token został odrzucony. Sprawdź, czy jest poprawny.')).toBeVisible();
});

test('settings: first-time encryption setup uploads keycheck.json', async ({ page }) => {
  const gh = createMockGitHub({ token: TOKEN });
  await mockGitHub(page, gh);
  await fill(page, TOKEN);
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByText('Zapisano.')).toBeVisible();

  await page.goto('/settings/encryption');
  await page.getByRole('button', { name: 'Zaproponuj hasło' }).click();
  await page.getByRole('button', { name: 'Skonfiguruj / odblokuj' }).click();
  await expect(page.getByText(/Szyfrowanie skonfigurowane/)).toBeVisible({ timeout: 30_000 });
  expect(gh.paths()).toContain('keycheck.json');
  await expect(page.getByTestId('key-state')).toHaveAttribute('data-state', 'unlocked');
});
