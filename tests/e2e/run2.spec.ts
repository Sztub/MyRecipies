import { test, expect } from '@playwright/test';
import { createMockGitHub } from '../../test/mocks/github';
import { mockGitHub, setUpFirstDevice, watchLeaks } from './helpers';

// Run 2 journeys: inline unlock, keep-last-N pruning, side menu at 375 px, PL -> EN switch.

const TOKEN = 'test-token-e2e-run2';
const BACKUP_RE = /^devices\/[^/]+\/backups\/.+\.enc$/;

test('backup: inline unlock after forgetting the key, then back up', async ({ page }) => {
  const gh = createMockGitHub({ token: TOKEN });
  await mockGitHub(page, gh);
  const leaks = watchLeaks(page);
  const passphrase = await setUpFirstDevice(page, TOKEN);

  await page.getByRole('button', { name: 'Zapomnij klucz na tym urządzeniu' }).click();
  await expect(page.getByTestId('key-state')).toHaveAttribute('data-state', 'locked');

  await page.goto('/backup');
  const form = page.getByTestId('backup-unlock');
  await expect(form).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zrób kopię teraz' })).toBeDisabled();

  await form.getByLabel('Hasło do kopii').fill('definitely-wrong-passphrase');
  await form.getByRole('button', { name: 'Odblokuj' }).click();
  await expect(form.getByRole('alert')).toContainText('Nieprawidłowe hasło', { timeout: 30_000 });

  await form.getByLabel('Hasło do kopii').fill(passphrase);
  await form.getByRole('button', { name: 'Odblokuj' }).click();
  await expect(form).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole('button', { name: 'Zrób kopię teraz' }).click();
  await expect(page.getByText(/Kopia zakończona/)).toBeVisible({ timeout: 30_000 });
  expect(gh.paths().filter((p) => BACKUP_RE.test(p))).toHaveLength(1);
  leaks.expectNone([TOKEN, passphrase]);
});

test('backup: keep-last-N pruning deletes only this device old backups', async ({ page }) => {
  const gh = createMockGitHub({ token: TOKEN });
  await mockGitHub(page, gh);
  await setUpFirstDevice(page, TOKEN);

  await page.goto('/backup');
  await page.getByRole('button', { name: 'Zrób kopię teraz' }).click();
  await expect(page.getByText(/Kopia zakończona/)).toBeVisible({ timeout: 30_000 });
  const first = gh.paths().filter((p) => BACKUP_RE.test(p));
  expect(first).toHaveLength(1);
  const dir = first[0]!.replace(/\/[^/]+$/, '');

  // Four older backups of this device plus one of another device.
  for (let i = 1; i <= 4; i++)
    await gh.seed(`${dir}/2025-01-0${i}T10-00-00-000Z.enc`, `{"old":${i}}`);
  const other = 'devices/other-device-0000/backups/2025-01-01T10-00-00-000Z.enc';
  await gh.seed(other, '{"other":true}');

  const keep = page.getByLabel('Ile kopii tego urządzenia zachować');
  await keep.fill('2');
  await page.getByRole('button', { name: 'Zrób kopię teraz' }).click();
  await expect(page.getByText(/Kopia zakończona/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Usunięto 4 stare kopie/)).toBeVisible();

  const mine = gh.paths().filter((p) => p.startsWith(`${dir}/`) && p.endsWith('.enc'));
  expect(
    mine.filter((p) => !p.endsWith('latest.enc') && !p.endsWith('device.json.enc')),
  ).toHaveLength(2);
  expect(gh.paths()).toContain(other);
  expect(gh.paths()).toContain('keycheck.json');

  await page.reload();
  await expect(page.getByLabel('Ile kopii tego urządzenia zachować')).toHaveValue('2');
});

test('side menu works at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: 'Otwórz menu' });
  await expect(toggle).toBeVisible();
  const box = await toggle.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  const nav = page.getByRole('navigation', { name: 'Nawigacja główna' });
  await expect(nav.getByRole('link')).toHaveCount(5); // Recipes, New recipe, Manage, Sync (T43), Settings – Backup moved under Settings (#71)
  await nav.getByRole('link', { name: 'Ustawienia' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Ustawienia' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Otwórz menu' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test('journey: PL default, switch to EN, menu and recipe form follow, survives reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 2, name: 'Ustawienia' })).toBeVisible();
  await page.getByLabel('Język aplikacji').selectOption('en');
  await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Open menu' }).click();
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Backup' })).toHaveCount(0); // #71: under Settings now
  await expect(nav.getByRole('link', { name: 'Categories & tags' })).toBeVisible();
  await nav.getByRole('link', { name: 'Recipes' }).click();

  await page.getByRole('button', { name: 'Open menu' }).click();
  await nav.getByRole('link', { name: 'New recipe' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Pancakes');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Pancakes' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
