import { test, expect } from '@playwright/test';
import { goViaMenu } from './menu';

async function addRecipe(page: import('@playwright/test').Page, title: string, ingredient: string) {
  await goViaMenu(page, 'Nowy przepis');
  await page.getByLabel('Tytuł', { exact: true }).fill(title);
  await page.getByLabel('Składnik 1', { exact: true }).fill(ingredient);
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
  await page.getByRole('link', { name: 'Wróć', exact: true }).click();
}

test('search ignores Polish diacritics', async ({ page }) => {
  await page.goto('/');
  await addRecipe(page, 'Żurek', 'Kiełbasa');
  await addRecipe(page, 'Pierogi', 'Mąka');

  const box = page.getByRole('searchbox', { name: 'Szukaj przepisów' });
  await box.fill('zur');
  await expect(page.getByRole('link', { name: 'Żurek' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pierogi' })).toHaveCount(0);

  await box.fill('maka');
  await expect(page.getByRole('link', { name: 'Pierogi' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Żurek' })).toHaveCount(0);
});
