import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { injectModule } from './bundle';
import { createMockGitHub } from '../../test/mocks/github';
import { goViaMenu } from './menu';

export type MockGitHub = ReturnType<typeof createMockGitHub>;

export const FIXTURE_PHOTO = path.join(import.meta.dirname, 'fixtures', 'photo-2000x1200.jpg');
export const TMP_ROOT = path.join(import.meta.dirname, '.tmp');

/** Route https://api.github.com/** to the in-memory mock (adds CORS headers). */
export async function mockGitHub(page: Page, gh: MockGitHub) {
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const body = req.postDataBuffer();
    const request = new Request(req.url(), {
      method: req.method(),
      headers: req.headers(),
      ...(body && req.method() !== 'GET' && req.method() !== 'HEAD'
        ? { body: new Uint8Array(body) }
        : {}),
    });
    const res = await gh.handle(request);
    await route.fulfill({
      status: res.status,
      headers: {
        ...Object.fromEntries(res.headers.entries()),
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
      },
      body: Buffer.from(await res.arrayBuffer()),
    });
  });
}

/** Records everything a secret could leak into: console output and request URLs. */
export function watchLeaks(page: Page) {
  const seen: string[] = [];
  page.on('console', (m) => seen.push(`console:${m.text()}`));
  page.on('pageerror', (e) => seen.push(`pageerror:${e.message}`));
  page.on('request', (r) => seen.push(`url:${r.url()}`));
  return {
    expectNone(secrets: string[]) {
      for (const s of seen)
        for (const secret of secrets) expect(s, 'secret leaked').not.toContain(secret);
    },
  };
}

/** The share sheet would block downloads in the mobile emulation; force the download fallback. */
export async function disableWebShare(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
}

/** Settings → GitHub backup (#71 sub-screen). Ends on the summary shown after saving (#69). */
export async function configureGitHub(page: Page, token: string) {
  await page.goto('/settings/github');
  await page.getByLabel('Właściciel', { exact: true }).fill('octo');
  await page.getByLabel('Repozytorium', { exact: true }).fill('data');
  await page.getByLabel('Token dostępu', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByText('Zapisano.')).toBeVisible();
}

/** First device: settings + new random passphrase. Returns the passphrase (never log or commit it). */
export async function setUpFirstDevice(page: Page, token: string): Promise<string> {
  await configureGitHub(page, token);
  await page.goto('/settings/encryption');
  await page.getByRole('button', { name: 'Zaproponuj hasło' }).click();
  const passphrase = await page.getByLabel('Hasło', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Skonfiguruj / odblokuj' }).click();
  await expect(page.getByTestId('key-state')).toHaveAttribute('data-state', 'unlocked', {
    timeout: 30_000,
  });
  return passphrase;
}

/** Settings → Encryption: type the passphrase and unlock (opens the sub-screen first if needed). */
export async function unlockDevice(page: Page, passphrase: string) {
  if (!page.url().endsWith('/settings/encryption')) await page.goto('/settings/encryption');
  await page.getByLabel('Hasło', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Skonfiguruj / odblokuj' }).click();
}

export interface RecipeSpec {
  title: string;
  ingredient: string;
  step: string;
  tag: string;
  photo?: boolean;
}

export async function createRecipe(page: Page, r: RecipeSpec) {
  await page.goto('/');
  await goViaMenu(page, 'Nowy przepis');
  await page.getByLabel('Tytuł', { exact: true }).fill(r.title);
  await page.getByLabel('Składnik 1', { exact: true }).fill(r.ingredient);
  await page.getByLabel('Ilość 1', { exact: true }).fill('3');
  await page.getByLabel('Jednostka 1', { exact: true }).selectOption('szklanka');
  await page.getByLabel('Treść kroku 1', { exact: true }).fill(r.step);
  await page.getByLabel('Nowy tag', { exact: true }).fill(r.tag);
  await page.getByRole('button', { name: 'Dodaj tag' }).click();
  if (r.photo) {
    // The recipe-level picker is the last one on the form (step pickers come before it).
    await page.getByTestId('photo-gallery').last().setInputFiles(FIXTURE_PHOTO);
    await expect(page.getByRole('button', { name: 'Usuń zdjęcie' })).toHaveCount(1, {
      timeout: 15_000,
    });
  }
  await page.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByRole('heading', { level: 2, name: r.title })).toBeVisible();
}

/** Snapshot of live app data straight from IndexedDB (bundles the db module into the page), normalised for comparison. */
export async function dumpData(page: Page) {
  await page.goto('/');
  await injectModule(page, 'src/db/index.ts', 'AppDb');
  return page.evaluate(async () => {
    const mod = (window as unknown as { AppDb: typeof import('../../src/db') }).AppDb;
    const recipes = await mod.recipes.list();
    const tags = await mod.tags.list();
    const tagName = new Map(tags.map((t) => [t.id, t.name]));
    const photoRows = [];
    for (const r of recipes) {
      for (const h of r.photoHashes) {
        const p = await mod.photos.get(h);
        photoRows.push({
          hash: h,
          mime: p?.mime,
          size: p?.size,
          width: p?.width,
          height: p?.height,
          bytes: p?.blob.size,
        });
      }
    }
    return {
      recipes: recipes
        .map((r) => ({ ...r, tagNames: r.tagIds.map((id) => tagName.get(id)).sort() }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      photos: photoRows.sort((a, b) => a.hash.localeCompare(b.hash)),
    };
  });
}

/** Write every file of the mocked repo to a fresh temp dir (gitignored) and return its path. */
export function dumpRepo(gh: MockGitHub, testInfo: TestInfo): string {
  const dir = path.join(
    TMP_ROOT,
    `repo-${testInfo.project.name}-${testInfo.workerIndex}-${testInfo.parallelIndex}`,
  );
  rmSync(dir, { recursive: true, force: true });
  for (const p of gh.paths()) {
    const file = path.join(dir, p);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, gh.read(p) ?? new Uint8Array());
  }
  return dir;
}

export function tmpDir(name: string, testInfo: TestInfo): string {
  const dir = path.join(
    TMP_ROOT,
    `${name}-${testInfo.project.name}-${testInfo.workerIndex}-${testInfo.parallelIndex}`,
  );
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Playwright's WebKit build on Windows cannot store any Blob in IndexedDB ("Error preparing Blob/File
 * data"), even a hand-made one. Real iOS/macOS Safari can. Photo journeys probe this and skip/degrade
 * instead of reporting a false app failure.
 */
export async function idbBlobsWork(page: Page): Promise<boolean> {
  await page.goto('/');
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const q = indexedDB.open('e2e-blob-probe', 1);
        q.onupgradeneeded = () => q.result.createObjectStore('s');
        q.onerror = () => resolve(false);
        q.onsuccess = () => {
          const db = q.result;
          const done = (ok: boolean) => {
            db.close();
            indexedDB.deleteDatabase('e2e-blob-probe');
            resolve(ok);
          };
          try {
            const tx = db.transaction('s', 'readwrite');
            tx.objectStore('s').put(new Blob([new Uint8Array(64)], { type: 'image/jpeg' }), 'k');
            tx.oncomplete = () => done(true);
            tx.onerror = () => done(false);
            tx.onabort = () => done(false);
          } catch {
            done(false);
          }
        };
      }),
  );
}

export async function setDeviceName(page: Page, name: string) {
  // Saved on change (async IndexedDB write) while the page also loads the old value – retry until a
  // reload shows it, so the name is really stored before the next step.
  await expect(async () => {
    await page.goto('/settings');
    await expect(page.getByTestId('screen-status-crypto')).not.toBeEmpty();
    await page.getByLabel('Nazwa urządzenia', { exact: true }).fill(name);
    await page.reload();
    await expect(page.getByLabel('Nazwa urządzenia', { exact: true })).toHaveValue(name, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

export async function syncNow(page: Page) {
  await page.goto('/');
  await goViaMenu(page, 'Synchronizacja');
  await page.getByRole('button', { name: 'Synchronizuj teraz' }).click();
  await expect(page.getByTestId('sync-summary')).toContainText('Synchronizacja zakończona.', {
    timeout: 30_000,
  });
}
