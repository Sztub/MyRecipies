import { test, expect } from '@playwright/test';
import { createMockGitHub } from '../../test/mocks/github';
import { mockGitHub, setUpFirstDevice, watchLeaks } from './helpers';

// T44: set up a second device from the first one via the copy/paste fallback of the pairing QR.
const TOKEN = 'test-token-e2e-pairing-0123456789';

test('second device gets GitHub settings + token by pairing text and one-time code', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const gh = createMockGitHub({ token: TOKEN, owner: 'octo', repo: 'data' });

  // ---- first device ----
  const leaks1 = watchLeaks(page);
  await mockGitHub(page, gh);
  const passphrase = await setUpFirstDevice(page, TOKEN);
  await page.goto('/settings/backup');
  const keepLast = page.getByLabel('Ile kopii tego urządzenia zachować', { exact: true });
  await keepLast.fill('12');
  await keepLast.blur();
  await page.goto('/settings/pairing');

  await page.getByRole('button', { name: 'Pokaż kod QR dla innego urządzenia' }).click();
  const sendDialog = page.getByRole('dialog', { name: 'Kod QR dla innego urządzenia' });
  await expect(sendDialog.getByTestId('pairing-qr').locator('svg path')).toBeAttached({
    timeout: 30_000,
  });
  const code = (await sendDialog.getByTestId('pairing-code').textContent()) ?? '';
  expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  await sendDialog.getByText('Brak aparatu? Użyj tekstu').click();
  const pairingText = await sendDialog
    .getByLabel('Tekst konfiguracji', { exact: true })
    .inputValue();
  expect(pairingText.startsWith('recipes-pair:1:')).toBe(true);
  expect(pairingText).not.toContain(TOKEN);
  expect(pairingText).not.toContain(passphrase);

  // ---- second device (fresh browser context = empty IndexedDB) ----
  const ctx2 = await browser.newContext(testInfo.project.use);
  const page2 = await ctx2.newPage();
  const leaks2 = watchLeaks(page2);
  await mockGitHub(page2, gh);
  await page2.goto('/settings/pairing');
  await page2.getByRole('button', { name: 'Zeskanuj z innego urządzenia' }).click();
  const recvDialog = page2.getByRole('dialog', { name: 'Zeskanuj z innego urządzenia' });
  await recvDialog.getByLabel('Tekst konfiguracji (jeśli nie możesz zeskanować)').fill(pairingText);

  // Wrong code first: nothing is saved.
  await recvDialog.getByLabel('Kod jednorazowy z drugiego urządzenia').fill('AAAAA-AAAAA');
  await recvDialog.getByRole('button', { name: 'Połącz' }).click();
  await expect(recvDialog.getByRole('alert')).toContainText('Błędny kod', { timeout: 30_000 });

  await recvDialog.getByLabel('Kod jednorazowy z drugiego urządzenia').fill(code.toLowerCase());
  await recvDialog.getByRole('button', { name: 'Połącz' }).click();
  await expect(recvDialog.getByText('Ustawienia zapisane na tym urządzeniu.')).toBeVisible({
    timeout: 30_000,
  });

  // Passphrase prompt (typed from the paper – never part of the payload).
  await recvDialog.getByLabel('Hasło do kopii', { exact: true }).fill(passphrase);
  await recvDialog.getByRole('button', { name: 'Odblokuj' }).click();
  await expect(
    recvDialog.getByText('To urządzenie jest odblokowane i gotowe do tworzenia kopii.'),
  ).toBeVisible({
    timeout: 30_000,
  });
  await recvDialog.getByRole('button', { name: 'Zamknij', exact: true }).click();
  await expect(recvDialog).toBeHidden();

  // What arrived is stored: GitHub summary (#69), keep-last on Backup, key on Encryption.
  await page2.goto('/settings/github');
  await expect(page2.getByTestId('github-summary')).toContainText('octo/data');
  await page2.getByRole('button', { name: 'Edytuj' }).click();
  await expect(page2.getByLabel('Właściciel', { exact: true })).toHaveValue('octo');
  await expect(page2.getByLabel('Repozytorium', { exact: true })).toHaveValue('data');
  await expect(page2.getByLabel('Token dostępu', { exact: true })).toHaveValue(TOKEN);
  await page2.goto('/settings/backup');
  await expect(page2.getByLabel('Ile kopii tego urządzenia zachować', { exact: true })).toHaveValue(
    '12',
  );
  await page2.goto('/settings/encryption');
  await expect(page2.getByTestId('key-state')).toHaveAttribute('data-state', 'unlocked');

  // Closing the sender dialog discards the code.
  await page.getByRole('button', { name: 'Zamknij', exact: true }).click();
  await expect(page.getByTestId('pairing-code')).toHaveCount(0);

  leaks1.expectNone([TOKEN, passphrase]);
  leaks2.expectNone([TOKEN, passphrase]);
  await ctx2.close();
});
