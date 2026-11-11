// T47: more two-device sync journeys (two browser contexts, one mocked repo).
//  1. favourite + rating on A and a steps edit on B combine without a conflict (queue #64)
//  2. delete on A vs edit on B → one conflict, "Weź ich" converges both devices
import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
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

const TOKEN = 'test-token-e2e-sync-fields';

async function createWithSteps(page: Page, title: string) {
  await page.goto('/');
  await goViaMenu(page, 'Nowy przepis');
  await page.getByLabel('Tytuł', { exact: true }).fill(title);
  await page.getByLabel('Składnik 1', { exact: true }).fill('buraki');
  await page.getByRole('button', { name: 'Dodaj krok' }).click();
  await page.getByLabel('Treść kroku 1', { exact: true }).fill('Pokrój');
  await page.getByLabel('Treść kroku 2', { exact: true }).fill('Ugotuj');
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
}

/** Device A creates `title`, syncs; device B joins, syncs; A syncs again so both have a base for each other. */
async function twoDevices(browser: Browser, testInfo: TestInfo, title: string) {
  const gh = createMockGitHub({ token: TOKEN });
  const ctxA = await browser.newContext(testInfo.project.use);
  const ctxB = await browser.newContext(testInfo.project.use);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const leaks = [watchLeaks(a), watchLeaks(b)];
  await mockGitHub(a, gh);
  await mockGitHub(b, gh);

  const passphrase = await setUpFirstDevice(a, TOKEN);
  await setDeviceName(a, 'Telefon Mamy');
  await createWithSteps(a, title);
  await syncNow(a);

  await configureGitHub(b, TOKEN);
  await unlockDevice(b, passphrase);
  await expect(b.getByTestId('key-state')).toHaveAttribute('data-state', 'unlocked', { timeout: 30_000 });
  await setDeviceName(b, 'Tablet');
  await syncNow(b);
  await expect(b.getByTestId('sync-summary')).toContainText('Telefon Mamy: 1 nowy');
  await syncNow(a);
  await expect(a.getByTestId('sync-summary')).toContainText('Tablet: bez zmian');

  const close = async () => {
    for (const l of leaks) l.expectNone([TOKEN, passphrase]);
    await ctxA.close();
    await ctxB.close();
  };
  return { gh, a, b, close };
}

async function openRecipe(page: Page, title: string) {
  await page.goto('/');
  await page.getByRole('link', { name: title }).click();
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
}

test('sync: favourite + rating on A and a steps edit on B combine without a conflict', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const title = 'Zupa-pola';
  const { a, b, close } = await twoDevices(browser, testInfo, title);

  // A: favourite + 4 stars. B: edit step 2.
  await openRecipe(a, title);
  await a.getByRole('button', { name: 'Ulubione' }).click();
  await expect(a.getByRole('button', { name: 'Ulubione' })).toHaveAttribute('aria-pressed', 'true');
  await a.getByRole('radio', { name: 'Oceń na 4 z 5' }).click();
  await expect(a.getByRole('radio', { name: 'Oceń na 4 z 5' })).toHaveAttribute('aria-checked', 'true');

  await openRecipe(b, title);
  await b.getByRole('link', { name: 'Edytuj' }).click();
  await b.getByLabel('Treść kroku 2', { exact: true }).fill('Ugotuj do miękkości');
  await b.getByRole('button', { name: 'Zapisz' }).click();
  await expect(b.getByText('Ugotuj do miękkości')).toBeVisible();

  // A publishes first (B has not published yet → nothing to choose), then B merges A's flags.
  await syncNow(a);
  await syncNow(b);
  await expect(b.getByTestId('sync-summary')).not.toContainText('wymaga Twojej decyzji');
  await expect(b.getByTestId('no-conflicts')).toBeVisible();
  await openRecipe(b, title);
  await expect(b.getByRole('button', { name: 'Ulubione' })).toHaveAttribute('aria-pressed', 'true');
  await expect(b.getByRole('radio', { name: 'Oceń na 4 z 5' })).toHaveAttribute('aria-checked', 'true');
  await expect(b.getByText('Ugotuj do miękkości')).toBeVisible();

  // B publishes the combined record, A picks up the new step and keeps its flags.
  await syncNow(b);
  await syncNow(a);
  await expect(a.getByTestId('no-conflicts')).toBeVisible();
  await openRecipe(a, title);
  await expect(a.getByText('Ugotuj do miękkości')).toBeVisible();
  await expect(a.getByRole('button', { name: 'Ulubione' })).toHaveAttribute('aria-pressed', 'true');
  await expect(a.getByRole('radio', { name: 'Oceń na 4 z 5' })).toHaveAttribute('aria-checked', 'true');

  // The list filter on B sees the favourite that came from A.
  await b.goto('/');
  await b.getByRole('button', { name: 'Ulubione' }).click();
  await expect(b.getByRole('link', { name: title })).toBeVisible();
  await close();
});

test('sync: delete on A vs edit on B → one conflict, "Weź ich" converges', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const title = 'Barszcz-del';
  const { a, b, close } = await twoDevices(browser, testInfo, title);

  // A deletes, B edits the title.
  await openRecipe(a, title);
  await a.getByRole('button', { name: 'Usuń', exact: true }).click();
  await a.getByRole('button', { name: 'Tak, usuń' }).click();
  await expect(a.getByRole('link', { name: title })).toHaveCount(0);
  await openRecipe(b, title);
  await b.getByRole('link', { name: 'Edytuj' }).click();
  await b.getByLabel('Tytuł', { exact: true }).fill(`${title} B`);
  await b.getByRole('button', { name: 'Zapisz' }).click();
  await expect(b.getByRole('heading', { level: 2, name: `${title} B` })).toBeVisible();

  await syncNow(a);
  await syncNow(b);
  await expect(b.getByTestId('sync-summary')).toContainText('1 wymaga Twojej decyzji');
  await b.goto('/sync');
  const card = b.getByTestId('conflict');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Usunięte');
  await expect(card).toContainText('Zachowane');
  await card.getByRole('button', { name: 'Weź ich' }).click();
  await expect(b.getByTestId('no-conflicts')).toBeVisible();
  await b.goto('/');
  await expect(b.getByRole('link', { name: `${title} B` })).toHaveCount(0);

  await syncNow(b);
  await syncNow(a);
  await expect(a.getByTestId('no-conflicts')).toBeVisible();
  for (const p of [a, b]) {
    await p.goto('/');
    await expect(p.getByRole('link', { name: new RegExp(title) })).toHaveCount(0);
  }
  await close();
});
