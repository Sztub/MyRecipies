import { defineConfig, devices } from '@playwright/test';

// Fixed non-default ports; parallel workers override with PW_PREVIEW_PORT so they don't collide.
// PW_PORT is still honoured as a fallback so existing invocations keep working.
const PREVIEW_PORT = Number(process.env.PW_PREVIEW_PORT ?? process.env.PW_PORT ?? 4392);
// All projects run against the production build (`vite build` + `vite preview`), never the dev server.
const BASE_URL = `http://localhost:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  // The build ships a CSP without inline scripts; injectModule() (tests/e2e/bundle.ts) adds an inline
  // <script>, so specs bypass it. csp.spec.ts turns this off to check the policy itself.
  use: { bypassCSP: true },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /offline\.spec\.ts/,
      use: { ...devices['Pixel 5'], baseURL: BASE_URL, serviceWorkers: 'block' },
    },
    {
      name: 'webkit',
      testIgnore: /offline\.spec\.ts/,
      use: { ...devices['iPhone 13'], baseURL: BASE_URL, serviceWorkers: 'block' },
    },
    {
      name: 'offline-chromium',
      testMatch: /offline\.spec\.ts/,
      use: { ...devices['Pixel 5'], baseURL: BASE_URL },
    },
    {
      name: 'offline-webkit',
      testMatch: /offline\.spec\.ts/,
      use: { ...devices['iPhone 13'], baseURL: BASE_URL },
    },
  ],
});
