import { test, expect } from '@playwright/test';
import { goViaMenu } from './menu';

// Runs against the production build (vite preview) because the SW is not registered in dev.
test('app still renders after going offline and reloading', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Przepisy' })).toBeVisible();

  // Wait until the service worker controls the page (precache finished).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Przepisy' })).toBeVisible();
  await goViaMenu(page, 'Ustawienia');
  await expect(page.getByRole('heading', { level: 2, name: 'Ustawienia' })).toBeVisible();
  await context.setOffline(false);
});
