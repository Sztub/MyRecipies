import { expect, test } from '@playwright/test';
import { goViaMenu } from './menu';

// The production build carries a Content-Security-Policy <meta> (vite.config.ts → cspPlugin). Other specs
// bypass it (playwright.config.ts) because injectModule() adds inline scripts; this one enforces it.
test.use({ bypassCSP: false });

test('production build ships a CSP and the main screens load without violations', async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) violations.push(m.text());
  });

  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("connect-src 'self' https://api.github.com");

  for (const link of ['Nowy przepis', 'Kategorie i tagi', 'Synchronizacja', 'Ustawienia', 'Przepisy']) {
    await goViaMenu(page, link);
  }
  violations.push(...(await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])));
  expect(violations).toEqual([]);
});
