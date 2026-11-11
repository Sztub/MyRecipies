import { build } from 'vite';
import path from 'node:path';
import type { Page } from '@playwright/test';

// The e2e suite runs against the production build, which has no `/src/...` module URLs.
// For specs that need to call app modules directly, bundle the module on demand into an IIFE
// and inject it into the page; it is exposed as `window[globalName]`.
const cache = new Map<string, Promise<string>>();

function bundle(entry: string, globalName: string): Promise<string> {
  const key = `${entry}::${globalName}`;
  let code = cache.get(key);
  if (!code) {
    code = build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: {
          entry: path.resolve(import.meta.dirname, '../..', entry),
          name: globalName,
          formats: ['iife'],
        },
      },
    }).then((out) => {
      const results = Array.isArray(out) ? out : [out];
      const first = 'output' in results[0]! ? results[0].output[0] : undefined;
      if (!first || first.type !== 'chunk') throw new Error(`bundling ${entry} failed`);
      return first.code;
    });
    cache.set(key, code);
  }
  return code;
}

/** Inject `entry` (path relative to the repo root) into the page as `window[globalName]`. */
export async function injectModule(page: Page, entry: string, globalName: string) {
  await page.addScriptTag({ content: await bundle(entry, globalName) });
}
