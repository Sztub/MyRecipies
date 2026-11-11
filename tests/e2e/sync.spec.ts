// T43: two devices (two browser contexts) sharing one mocked GitHub data repo.
// create on A → sync B → edit both → conflict → resolve → converge.
import { test, expect, type Page } from '@playwright/test';
import { createMockGitHub } from '../../test/mocks/github';
import {
  configureGitHub,
  mockGitHub,
  setDeviceName,
  setUpFirstDevice,
  syncNow,
  unlockDevice,
  watchLeaks,
} from './helpers';
import { goViaMenu } from './menu';

const TOKEN = 'test-token-e2e-sync';
const TITLE = 'Barszcz-sync';

async function editTitle(page: Page, from: string, to: string) {
  await page.goto('/');
  await page.getByRole('link', { name: from }).click();
  await page.getByRole('link', { name: 'Edytuj' }).click();
  await page.getByLabel('Tytuł', { exact: true }).fill(to);
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByRole('heading', { level: 2, name: to })).toBeVisible();
}

async function createRecipe(page: Page, title: string) {
  await page.goto('/');
  await goViaMenu(page, 'Nowy przepis');
  await page.getByLabel('Tytuł', { exact: true }).fill(title);
  await page.getByLabel('Składnik 1', { exact: true }).fill('buraki');
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
}

test('sync: two devices – create, sync, conflict, resolve, converge', async ({ browser }, testInfo) => {
  test.setTimeout(240_000); // many full syncs; WebKit is slow under load
  const gh = createMockGitHub({ token: TOKEN });

  const ctxA = await browser.newContext(testInfo.project.use);
  const ctxB = await browser.newContext(testInfo.project.use);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const leaksA = watchLeaks(a);
  const leaksB = watchLeaks(b);
  await mockGitHub(a, gh);
  await mockGitHub(b, gh);

  // Device A: set up, create a recipe, sync (no peers yet → just a backup).
  const passphrase = await setUpFirstDevice(a, TOKEN);
  await setDeviceName(a, 'Telefon w kuchni');
  await createRecipe(a, TITLE);
  await syncNow(a);
  await expect(a.getByTestId('sync-summary')).toContainText('nie ma jeszcze innych urządzeń');

  // Device B: same repo, unlock with the passphrase, sync → gets A's recipe.
  await configureGitHub(b, TOKEN);
  await unlockDevice(b, passphrase);
  await expect(b.getByTestId('key-state')).toHaveAttribute('data-state', 'unlocked', { timeout: 30_000 });
  await setDeviceName(b, 'Tablet');
  await syncNow(b);
  await expect(b.getByTestId('sync-summary')).toContainText('Telefon w kuchni: 1 nowy');
  await b.goto('/');
  await expect(b.getByRole('link', { name: TITLE })).toBeVisible();

  // A learns B's state (base for B), still nothing to choose.
  await syncNow(a);
  await expect(a.getByTestId('sync-summary')).toContainText('Tablet: bez zmian');
  expect(gh.deviceIds()).toHaveLength(2);
  expect(gh.paths().filter((p) => /^devices\/[^/]+\/latest\.enc$/.test(p))).toHaveLength(2);

  // Both edit the same field differently.
  await editTitle(a, TITLE, `${TITLE} A`);
  await editTitle(b, TITLE, `${TITLE} B`);
  await syncNow(a); // B hasn't published its edit yet → nothing to choose on A
  await syncNow(b);
  await expect(b.getByTestId('sync-summary')).toContainText('1 wymaga Twojej decyzji');

  // Badge in the menu + the conflict screen.
  await b.goto('/');
  await b.getByRole('heading', { level: 1 }).waitFor(); // rendered, so the toggle check is reliable
  const toggle = b.getByRole('button', { name: 'Otwórz menu' });
  if (await toggle.isVisible()) await toggle.click();
  await expect(b.getByTestId('sync-badge')).toContainText('1');
  await b.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('link', { name: /Synchronizacja/ }).click();
  const card = b.getByTestId('conflict');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Zmienione też na: Telefon w kuchni');
  await expect(card).toContainText(`${TITLE} A`);
  await expect(card).toContainText(`${TITLE} B`);
  await card.getByRole('button', { name: 'Weź ich' }).click();
  await expect(b.getByTestId('no-conflicts')).toBeVisible();
  await expect(b.getByText('Zapisano. Zsynchronizuj ponownie')).toBeVisible();
  await expect(b.getByTestId('sync-badge')).toHaveCount(0);

  // Converge: B publishes its choice, A picks it up without a new conflict.
  await syncNow(b);
  await syncNow(a);
  await expect(a.getByTestId('no-conflicts')).toBeVisible();
  for (const p of [a, b]) {
    await p.goto('/');
    await expect(p.getByRole('link', { name: `${TITLE} A` })).toBeVisible();
    await expect(p.getByRole('link', { name: `${TITLE} B` })).toHaveCount(0);
  }

  // Nothing secret leaked into the repo, console or URLs.
  for (const path of gh.paths()) {
    const text = gh.readText(path) ?? '';
    expect(text).not.toContain(TITLE);
    expect(text).not.toContain(TOKEN);
  }
  leaksA.expectNone([TOKEN, passphrase]);
  leaksB.expectNone([TOKEN, passphrase]);
  await ctxA.close();
  await ctxB.close();
});

test('sync: no network → clear message, nothing changed', async ({ page }) => {
  const gh = createMockGitHub({ token: TOKEN });
  await mockGitHub(page, gh);
  await setUpFirstDevice(page, TOKEN);
  await createRecipe(page, TITLE);
  await page.goto('/sync');
  const button = page.getByRole('button', { name: 'Synchronizuj teraz' });
  await expect(button).toBeEnabled();
  // No network for GitHub from here on (a newer route wins over the mock).
  await page.route('https://api.github.com/**', (route) => route.abort('internetdisconnected'));
  await button.click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Nie można połączyć się z GitHubem', { timeout: 30_000 });
  await expect(alert).toContainText('Nic na tym urządzeniu nie zostało zmienione.');
  await page.goto('/');
  await expect(page.getByRole('link', { name: TITLE })).toBeVisible();
  expect(gh.paths().filter((p) => p.startsWith('devices/'))).toEqual([]);
});
