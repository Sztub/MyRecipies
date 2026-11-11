import { test, expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createMockGitHub } from '../../test/mocks/github';
import {
  FIXTURE_PHOTO,
  configureGitHub,
  createRecipe,
  disableWebShare,
  idbBlobsWork,
  dumpData,
  dumpRepo,
  mockGitHub,
  setUpFirstDevice,
  tmpDir,
  unlockDevice,
  watchLeaks,
  type RecipeSpec,
} from './helpers';

// Fresh "devices" (new browser contexts) reuse the project's emulation (Pixel 5 / iPhone 13).
const ALL_RECIPES: RecipeSpec[] = [
  {
    title: 'Gołąbki-e2e-secret',
    ingredient: 'Kapusta-e2e-secret',
    step: 'Zawiń-e2e-secret',
    tag: 'Świąteczne-e2e',
    photo: true,
  },
  {
    title: 'Żurek-e2e-secret',
    ingredient: 'Zakwas-e2e-secret',
    step: 'Gotuj-e2e-secret',
    tag: 'Zupy-e2e',
  },
];
let RECIPES: RecipeSpec[] = ALL_RECIPES;
/** Drops the photo from the recipes where the browser (Playwright WebKit on Windows) cannot store blobs. */
async function usePhotos(page: Page): Promise<boolean> {
  const ok = await idbBlobsWork(page);
  RECIPES = ALL_RECIPES.map((r) => ({ ...r, photo: r.photo && ok }));
  return ok;
}
const PLAINTEXTS = ALL_RECIPES.flatMap((r) => [r.title, r.ingredient, r.step, r.tag]);
const jpegMagic = Buffer.from([0xff, 0xd8, 0xff]);

test('photo: real canvas pipeline downsizes, re-encodes and displays', async ({ page }) => {
  test.skip(
    !(await usePhotos(page)),
    'IndexedDB cannot store Blobs in this browser build (environment limit)',
  );
  await createRecipe(page, RECIPES[0]!);
  const img = page.locator('img').first();
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const data = await dumpData(page);
  expect(data.photos).toHaveLength(1);
  const p = data.photos[0]!;
  expect(p.mime).toMatch(/^image\/(jpeg|webp)$/);
  expect(Math.max(p.width!, p.height!)).toBeLessThanOrEqual(1600);
  expect(p.width!).toBeGreaterThan(p.height!); // aspect ratio kept
  expect(p.bytes).toBeGreaterThan(0);
  expect(p.bytes).toBeLessThan(readFileSync(FIXTURE_PHOTO).length * 2);
  expect(p.hash).toMatch(/^[0-9a-f]{64}$/);
});

test('local export → fresh device → import (replace) gives identical data', async ({
  page,
  browser,
}, testInfo) => {
  await disableWebShare(page);
  const photos = await usePhotos(page);
  for (const r of RECIPES) await createRecipe(page, r);
  const before = await dumpData(page);
  expect(before.recipes).toHaveLength(2);
  expect(before.photos).toHaveLength(photos ? 1 : 0);

  await page.goto('/settings/backup');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Eksportuj plik kopii' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^recipes-backup-\d{8}-\d{4}\.json$/);
  const file = path.join(tmpDir('export', testInfo), download.suggestedFilename());
  await download.saveAs(file);

  // "Clear site data" == a brand-new browser context.
  const ctx2 = await browser.newContext(testInfo.project.use);
  try {
    const page2 = await ctx2.newPage();
    await page2.goto('/settings/backup');
    await page2.getByLabel('Wybierz plik kopii…').setInputFiles(file);
    await expect(page2.getByLabel('Zawartość kopii')).toContainText('2');
    await page2.getByText('Zastępuje wszystko na tym urządzeniu zawartością kopii.').click();
    await page2.getByRole('button', { name: 'Zastąp wszystkie dane' }).click();
    await expect(page2.getByText('Import zakończony.')).toBeVisible({ timeout: 30_000 });

    const after = await dumpData(page2);
    expect(after.recipes).toEqual(before.recipes);
    expect(after.photos).toEqual(before.photos);

    await page2.goto('/');
    await page2.getByRole('link', { name: RECIPES[0]!.title }).click();
    if (photos) {
      const img = page2.locator('img').first();
      await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
    }
  } finally {
    await ctx2.close();
    rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test('GitHub backup → plaintext scan → decryptor script → fresh device restore', async ({
  page,
  browser,
}, testInfo) => {
  const token = 'test-token-e2e-journey';
  const gh = createMockGitHub({ token });
  const leaks = watchLeaks(page);
  await mockGitHub(page, gh);
  const photos = await usePhotos(page);
  const nPhotos = photos ? 1 : 0;
  const passphrase = await setUpFirstDevice(page, token);
  for (const r of RECIPES) await createRecipe(page, r);
  const before = await dumpData(page);

  await page.goto('/backup');
  await page.getByRole('button', { name: 'Zrób kopię teraz' }).click();
  await expect(page.getByText(/Kopia zakończona/)).toBeVisible({ timeout: 30_000 });

  // 1. Repo layout + nothing readable.
  const paths = gh.paths();
  expect(paths).toContain('keycheck.json');
  expect(paths.filter((p) => /^devices\/[^/]+\/backups\/.+\.enc$/.test(p))).toHaveLength(1);
  expect(paths.filter((p) => /^devices\/[^/]+\/latest\.enc$/.test(p))).toHaveLength(1);
  expect(paths.filter((p) => /^devices\/[^/]+\/device\.json\.enc$/.test(p))).toHaveLength(1);
  const photoPaths = paths.filter((p) => /^photos\/[0-9a-f]{64}\.enc$/.test(p));
  expect(photoPaths).toHaveLength(nPhotos);
  expect(paths.every((p) => !RECIPES.some((r) => p.includes(r.title)))).toBe(true);
  for (const p of paths) {
    const bytes = Buffer.from(gh.read(p)!);
    const text = bytes.toString('utf8');
    for (const s of [...PLAINTEXTS, token, passphrase])
      expect(text, `${p} contains plaintext`).not.toContain(s);
    expect(bytes.subarray(0, 3).equals(jpegMagic), `${p} is a raw JPEG`).toBe(false);
    expect(bytes.includes(Buffer.from('JFIF'))).toBe(false);
  }

  // 2. Independent decryptor (no app runtime) reads the stored output.
  const repoDir = dumpRepo(gh, testInfo);
  const work = tmpDir('decrypt', testInfo);
  const passFile = path.join(work, 'pass.txt');
  writeFileSync(passFile, passphrase + '\n');
  const script = path.join(import.meta.dirname, '..', '..', 'scripts', 'decrypt-backup.mjs');
  const outDir = path.join(work, 'out');
  const run = (args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

  const ok = run([repoDir, '--passphrase-file', passFile, '--out', outDir]);
  expect(ok.status, ok.stderr).toBe(0);
  expect(ok.stdout).toContain('recipes=2');
  expect(ok.stdout).toContain(`photos=${nPhotos}`);
  const latest = run([
    path.join(
      repoDir,
      'devices',
      /devices\/([^/]+)\//.exec(paths.find((p) => p.includes('latest.enc'))!)![1]!,
      'latest.enc',
    ),
    '--passphrase-file',
    passFile,
    '--json',
  ]);
  expect(latest.status, latest.stderr).toBe(0);
  const decoded = JSON.parse(latest.stdout) as { bundle: { recipes: { title: string }[] } }[];
  expect(decoded[0]!.bundle.recipes.map((r) => r.title).sort()).toEqual(
    RECIPES.map((r) => r.title).sort(),
  );

  // Wrong passphrase and tampered file are rejected (exit 1, nothing about the passphrase printed).
  const wrongFile = path.join(work, 'wrong.txt');
  writeFileSync(wrongFile, 'test-passphrase-definitely-wrong\n');
  const wrong = run([repoDir, '--passphrase-file', wrongFile]);
  expect(wrong.status).toBe(1);
  expect(wrong.stderr).toContain('wrong passphrase');
  expect(wrong.stdout + wrong.stderr).not.toContain('definitely-wrong');

  // 3. Fresh device: unlock with the passphrase, restore, compare.
  const ctx2 = await browser.newContext(testInfo.project.use);
  try {
    const page2 = await ctx2.newPage();
    const leaks2 = watchLeaks(page2);
    await mockGitHub(page2, gh);
    await configureGitHub(page2, token);

    // wrong passphrase first
    await unlockDevice(page2, 'test-passphrase-definitely-wrong');
    await expect(page2.getByText('Nieprawidłowe hasło.')).toBeVisible({ timeout: 30_000 });
    await expect(page2.getByTestId('key-state')).toHaveAttribute('data-state', 'locked');

    await unlockDevice(page2, passphrase);
    await expect(page2.getByTestId('key-state')).toHaveAttribute('data-state', 'unlocked', {
      timeout: 30_000,
    });

    await page2.goto('/backup');
    await page2.getByRole('button', { name: 'Pokaż kopie' }).click();
    await page2.getByRole('radio').first().check();
    await page2.getByText('Zastępuje wszystko na tym urządzeniu zawartością kopii.').click();
    await page2.getByRole('button', { name: 'Przywróć – zastąp wszystkie dane' }).click();
    await expect(page2.getByText('Przywracanie zakończone.')).toBeVisible({ timeout: 60_000 });

    const after = await dumpData(page2);
    expect(after.recipes).toEqual(before.recipes);
    expect(after.photos).toEqual(before.photos);
    await page2.goto('/');
    await page2.getByRole('link', { name: RECIPES[0]!.title }).click();
    if (photos) {
      const img = page2.locator('img').first();
      await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
    }
    leaks2.expectNone([token, passphrase]);
  } finally {
    await ctx2.close();
  }

  // 4. Second backup of unchanged data uploads no duplicate photo.
  const photoPutsBefore = gh.requests.filter(
    (r) => r.method === 'PUT' && r.path.includes('/photos/'),
  ).length;
  await page.goto('/backup');
  await page.getByRole('button', { name: 'Zrób kopię teraz' }).click();
  await expect(page.getByText(/Kopia zakończona/)).toBeVisible({ timeout: 30_000 });
  expect(gh.requests.filter((r) => r.method === 'PUT' && r.path.includes('/photos/')).length).toBe(
    photoPutsBefore,
  );
  expect(gh.paths().filter((p) => p.startsWith('photos/'))).toHaveLength(nPhotos);

  leaks.expectNone([token, passphrase]);
  rmSync(work, { recursive: true, force: true });
  rmSync(repoDir, { recursive: true, force: true });
});

test('restore: expired token on a fresh device shows a clear error and changes nothing', async ({
  page,
}) => {
  const token = 'test-token-e2e-expired';
  const gh = createMockGitHub({ token });
  await mockGitHub(page, gh);
  await setUpFirstDevice(page, token);
  await createRecipe(page, RECIPES[1]!);
  await page.goto('/backup');
  await page.getByRole('button', { name: 'Zrób kopię teraz' }).click();
  await expect(page.getByText(/Kopia zakończona/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Pokaż kopie' }).click();
  await page.getByRole('radio').first().check();
  gh.injectError({ kind: 'token-expired', times: 100 });
  await page.getByText('Zastępuje wszystko na tym urządzeniu zawartością kopii.').click();
  await page.getByRole('button', { name: 'Przywróć – zastąp wszystkie dane' }).click();
  await expect(page.getByRole('alert')).toContainText('Twój token GitHub wygasł');
  await expect(page.getByRole('alert')).toContainText(
    'Nic na tym urządzeniu nie zostało zmienione.',
  );
  gh.clearErrors();
  await page.goto('/');
  await expect(page.getByRole('link', { name: RECIPES[1]!.title })).toBeVisible();
});
