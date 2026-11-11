import { test, expect } from '@playwright/test';
import { goViaMenu } from './menu';

test('Polish by default; English chosen in Settings survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
  await expect(page.getByRole('heading', { level: 2, name: 'Przepisy' })).toBeVisible();
  // Default categories are shown in Polish.
  await goViaMenu(page, 'Nowy przepis');
  await expect(
    page.getByLabel('Kategoria', { exact: true }).locator('option', { hasText: 'Zupy' }),
  ).toHaveCount(1);

  await page.goto('/settings');
  await page.getByLabel('Język aplikacji').selectOption('en');
  await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeVisible();
  await page.goto('/recipes/new');
  await expect(
    page.getByLabel('Category', { exact: true }).locator('option', { hasText: 'Soups' }),
  ).toHaveCount(1);

  await page.goto('/settings');
  await page.getByLabel('App language').selectOption('pl');
  await expect(page.getByRole('heading', { level: 2, name: 'Ustawienia' })).toBeVisible();
});

test('ingredient amounts use Polish plural forms', async ({ page }) => {
  await page.goto('/recipes/new');
  await page.getByLabel('Tytuł', { exact: true }).fill('Placki');
  await page.getByLabel('Porcje', { exact: true }).fill('5');
  await page.getByLabel('Składnik 1', { exact: true }).fill('mąki');
  await page.getByLabel('Ilość 1', { exact: true }).fill('2');
  await page.getByLabel('Jednostka 1', { exact: true }).selectOption('tbsp');
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Placki' })).toBeVisible();
  await expect(page.getByText('2 łyżki mąki')).toBeVisible();
  await expect(page.getByText('5 porcji')).toBeVisible();
});
