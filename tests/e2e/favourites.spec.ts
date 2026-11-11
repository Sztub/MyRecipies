import { test, expect } from '@playwright/test';
import { goViaMenu } from './menu';

async function create(page: import('@playwright/test').Page, title: string) {
  await goViaMenu(page, 'Nowy przepis');
  await page.getByLabel('Tytuł', { exact: true }).fill(title);
  await page.getByLabel('Składnik 1', { exact: true }).fill('sól');
  await page.getByRole('button', { name: 'Dodaj krok' }).click();
  await page.getByLabel('Treść kroku 1', { exact: true }).fill('Pokrój');
  await page.getByLabel('Treść kroku 2', { exact: true }).fill('Ugotuj');
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
}

test('favourite, rating and last cooked: set, finish cooking, survive edit and reload, list filter', async ({
  page,
}) => {
  await page.goto('/');
  await create(page, 'Zupa');

  await page.getByRole('button', { name: 'Ulubione' }).click();
  await expect(page.getByRole('button', { name: 'Ulubione' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('radio', { name: 'Oceń na 4 z 5' }).click();
  await expect(page.getByRole('radio', { name: 'Oceń na 4 z 5' })).toHaveAttribute('aria-checked', 'true');

  // Finish button only on the last step of cooking mode.
  await page.getByRole('link', { name: 'Tryb gotowania' }).click();
  await expect(page.getByRole('button', { name: 'Gotowe – ugotowane' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Gotowe – ugotowane' }).click();
  await expect(page.getByText('Zapisano: ugotowane dziś')).toBeVisible();
  await page.getByRole('link', { name: 'Wyjdź' }).click();
  await expect(page.getByTestId('last-cooked')).toHaveText('Ostatnio gotowane: dziś');

  // Editing the recipe must not drop the flags.
  await page.getByRole('link', { name: 'Edytuj' }).click();
  await page.getByLabel('Treść kroku 2', { exact: true }).fill('Ugotuj dokładnie');
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Zupa' })).toBeVisible();
  await expect(page.getByText('Ugotuj dokładnie')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ulubione' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('radio', { name: 'Oceń na 4 z 5' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('last-cooked')).toBeVisible();

  // A second, plain recipe; the list filter shows only the favourite.
  await create(page, 'Sałatka');
  await goViaMenu(page, 'Przepisy');
  await expect(page.getByRole('link', { name: 'Sałatka' })).toBeVisible();
  await page.getByRole('button', { name: 'Ulubione' }).click();
  await expect(page.getByRole('link', { name: 'Sałatka' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Zupa' })).toBeVisible();
  await page.getByLabel('Sortuj według').selectOption('rating');
  await expect(page.getByRole('link', { name: 'Zupa' })).toBeVisible();
});
