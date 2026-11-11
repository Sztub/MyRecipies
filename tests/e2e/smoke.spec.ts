import { test, expect } from '@playwright/test';
import { goViaMenu } from './menu';

test('app loads and side menu works', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Przepisy' })).toBeVisible();
  await goViaMenu(page, 'Ustawienia');
  await expect(page.getByRole('heading', { level: 2, name: 'Ustawienia' })).toBeVisible();
  // #71: backup is a Settings sub-screen (no longer in the menu), with a back link to Settings.
  await expect(
    page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('link', { name: 'Kopia zapasowa' }),
  ).toHaveCount(0);
  await page.getByRole('main').getByRole('link', { name: /^Kopia zapasowa/ }).click();
  await expect(page).toHaveURL(/\/settings\/backup$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Kopia zapasowa' })).toBeVisible();
  await page.getByRole('link', { name: 'Wróć' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Ustawienia' })).toBeVisible();
  await goViaMenu(page, 'Przepisy');
  await expect(page.getByRole('heading', { level: 2, name: 'Przepisy' })).toBeVisible();
});

test('side menu reaches Manage and, on narrow screens, closes after navigation', async ({
  page,
}) => {
  await page.goto('/');
  await goViaMenu(page, 'Kategorie i tagi');
  await expect(page).toHaveURL(/\/manage$/);
  const toggle = page.getByRole('button', { name: /menu/i });
  if (await toggle.isVisible()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Focus moves into the drawer on open (the first link), and Escape closes it, returning focus to the button.
    const nav = page.getByRole('navigation', { name: 'Nawigacja główna' });
    await expect(nav.getByRole('link', { name: 'Przepisy', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  } else {
    await expect(page.getByRole('navigation', { name: 'Nawigacja główna' })).toBeVisible();
  }
});

test('desktop width keeps the side menu permanently visible', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /menu/i })).toBeHidden();
  await expect(
    page
      .getByRole('navigation', { name: 'Nawigacja główna' })
      .getByRole('link', { name: 'Ustawienia' }),
  ).toBeVisible();
});
