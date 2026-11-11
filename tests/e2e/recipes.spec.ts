import { test, expect } from '@playwright/test';
import { goViaMenu } from './menu';

test('create → edit → delete a recipe', async ({ page }) => {
  await page.goto('/');
  await goViaMenu(page, 'Nowy przepis');

  // Validation first
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByText('Wpisz tytuł.')).toBeVisible();

  await page.getByLabel('Tytuł', { exact: true }).fill('Pierogi ruskie');
  await page.getByLabel('Kategoria', { exact: true }).selectOption({ label: 'Dania główne' });
  await page.getByLabel('Składnik 1', { exact: true }).fill('Flour');
  await page.getByLabel('Ilość 1', { exact: true }).fill('2');
  await page.getByLabel('Jednostka 1', { exact: true }).selectOption('szklanka');
  await page.getByRole('button', { name: 'Dodaj krok' }).click();
  await page.getByLabel('Treść kroku 1', { exact: true }).fill('Make dough');
  await page.getByLabel('Treść kroku 2', { exact: true }).fill('Fill and boil');
  await page.getByLabel('Nowy tag', { exact: true }).fill('Festive');
  await page.getByRole('button', { name: 'Dodaj tag' }).click();
  await page.getByRole('button', { name: 'Zapisz' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Pierogi ruskie' })).toBeVisible();
  await expect(page.getByText('2 szklanki Flour')).toBeVisible();
  await expect(page.getByText('Fill and boil')).toBeVisible();

  // Edit
  await page.getByRole('link', { name: 'Edytuj' }).click();
  await page.getByLabel('Tytuł', { exact: true }).fill('Pierogi z mięsem');
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Pierogi z mięsem' })).toBeVisible();

  // Appears in list
  await page.getByRole('link', { name: 'Wróć', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Pierogi z mięsem' })).toBeVisible();

  // Delete
  await page.getByRole('link', { name: 'Pierogi z mięsem' }).click();
  await page.getByRole('button', { name: 'Usuń' }).click();
  // #70: the confirmation is on screen straight away, no scrolling needed.
  await expect(page.getByRole('alertdialog', { name: 'Usunąć ten przepis?' })).toBeInViewport();
  await page.getByRole('button', { name: 'Tak, usuń' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Przepisy' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pierogi z mięsem' })).toHaveCount(0);
});
