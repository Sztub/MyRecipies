/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Set VITE_BASE=/MyRecipies/ when building for GitHub Pages.
const base = process.env.VITE_BASE ?? '/';

// `npm run dev:phone` (scripts/dev-phone.mjs) sets DEV_PHONE=1: HTTPS with a self-signed cert, reachable on the LAN.
// Plain `npm run dev` is unaffected.
const devPhone = process.env.DEV_PHONE === '1';

// Content-Security-Policy for the production build only (the dev server needs inline styles/HMR).
// Defence in depth for the GitHub token and the keys in IndexedDB: no inline or third-party scripts,
// and network access only to this origin and the GitHub API. frame-ancestors can't be set via <meta>.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "connect-src 'self' https://api.github.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'recipes-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  base,
  server: devPhone ? { host: true } : undefined,
  plugins: [
    react(),
    cspPlugin(),
    ...(devPhone ? [basicSsl()] : []),
    VitePWA({
      // User confirms updates via the banner (src/pwa); nothing activates silently.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Family Recipes',
        short_name: 'Recipes',
        description: 'Family recipes with encrypted backup',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#cdb98e',
        theme_color: '#5e2216',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache entries are revisioned by content hash; cacheId prefixes cache names.
        cacheId: 'recipes-v1',
        cleanupOutdatedCaches: true,
        navigateFallback: `${base}index.html`,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
