import { expect, type Page } from '@playwright/test';

/** Click a side-menu link; opens the drawer first when the toggle button is visible (narrow screens). */
export async function goViaMenu(page: Page, linkName: string): Promise<void> {
  await page.getByRole('heading', { level: 1 }).waitFor(); // app rendered, so the toggle visibility check is reliable
  // Match the toggle by what it controls, not its label ("Otwórz menu" / "Zamknij menu"): right after a previous
  // goViaMenu the drawer may still be open for a moment, and checking only "Otwórz menu" would skip opening it.
  const toggle = page.locator('button[aria-controls="side-menu"]');
  if (await toggle.isVisible()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false'); // the previous navigation has closed it
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  }
  await page
    .getByRole('navigation', { name: 'Nawigacja główna' })
    .getByRole('link', { name: linkName })
    .click();
}
