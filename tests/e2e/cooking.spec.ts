import { test, expect } from '@playwright/test';
import { goViaMenu } from './menu';

test('cooking mode: open, step through, exit', async ({ page }) => {
  await page.goto('/');
  await goViaMenu(page, 'Nowy przepis');
  await page.getByLabel('Tytuł', { exact: true }).fill('Zupa');
  await page.getByLabel('Składnik 1', { exact: true }).fill('Marchew');
  await page.getByRole('button', { name: 'Dodaj krok' }).click();
  await page.getByLabel('Treść kroku 1', { exact: true }).fill('Pokrój');
  await page.getByLabel('Treść kroku 2', { exact: true }).fill('Ugotuj');
  await page.getByRole('button', { name: 'Zapisz' }).click();

  await page.getByRole('link', { name: 'Tryb gotowania' }).click();
  await expect(page.getByText('Krok 1 z 2')).toBeVisible();
  await expect(page.getByText('Pokrój')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Zupa' })).toBeVisible();
  await page.getByRole('button', { name: 'Składniki' }).click();
  await expect(page.getByText('Marchew')).toBeVisible();
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByText('Ugotuj')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dalej' })).toBeDisabled();
  await page.getByRole('link', { name: 'Wyjdź' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Zupa' })).toBeVisible();
});

test('servings stepper scales ingredients on detail page and in cooking mode', async ({ page }) => {
  await page.goto('/');
  await goViaMenu(page, 'Nowy przepis');
  await page.getByLabel('Tytuł', { exact: true }).fill('Ciasto');
  await page.getByLabel('Porcje', { exact: true }).fill('2');
  await page.getByLabel('Składnik 1', { exact: true }).fill('mąka');
  await page.getByLabel('Ilość 1', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Dodaj krok' }).click();
  await page.getByLabel('Treść kroku 1', { exact: true }).fill('Wymieszaj');
  await page.getByRole('button', { name: 'Zapisz' }).click();

  await page.getByRole('button', { name: 'Więcej porcji' }).click();
  await page.getByRole('button', { name: 'Więcej porcji' }).click();
  await expect(page.getByText('200 mąka')).toBeVisible();
  await page.getByRole('link', { name: 'Tryb gotowania' }).click();
  await page.getByRole('button', { name: 'Składniki' }).click();
  await expect(page.getByText('100 mąka')).toBeVisible();
  await page.getByRole('button', { name: 'Więcej porcji' }).click();
  await expect(page.getByText('150 mąka')).toBeVisible();
});

test('step timer: start in cooking mode, stays across steps and reload', async ({ page }) => {
  await page.goto('/');
  await goViaMenu(page, 'Nowy przepis');
  await page.getByLabel('Tytuł', { exact: true }).fill('Sernik');
  await page.getByLabel('Składnik 1', { exact: true }).fill('ser');
  await page.getByRole('button', { name: 'Dodaj krok' }).click();
  await page.getByLabel('Treść kroku 1', { exact: true }).fill('Piecz 40 min w 180 °C');
  await page.getByLabel('Treść kroku 2', { exact: true }).fill('Ostudź');
  await page.getByRole('button', { name: 'Zapisz' }).click();

  await page.getByRole('link', { name: 'Tryb gotowania' }).click();
  await page.getByRole('button', { name: 'Włącz minutnik: 40 min' }).click();
  const clock = page.getByTestId('timer-clock');
  await expect(clock).toHaveText(/^(40:00|39:5\d)$/);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByText('Ostudź')).toBeVisible();
  await expect(clock).toHaveText(/^39:\d\d$/);

  await page.reload();
  await expect(page.getByTestId('timer-clock')).toHaveText(/^39:\d\d$/);
  await page.getByRole('button', { name: 'Anuluj minutnik: Sernik' }).click();
  await expect(page.getByTestId('timer-clock')).toHaveCount(0);
});
