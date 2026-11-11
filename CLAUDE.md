# Recipes PWA

Vite + React 18 + TS PWA for family recipes with encrypted GitHub backup and two-way sync. docs/HOW-IT-WORKS.md explains how the features work (Architecture, Backup format, Security model).

## Conventions

- npm run check = lint && typecheck && test. npm run e2e = Playwright. Both must pass before every commit to main.
- No any without a comment. Pure logic gets unit tests; UI gets at least one test per screen.
- User-facing strings only via t() (src/i18n). Colours/spacing only via theme tokens (src/theme/tokens.css).
- Secrets (token, passphrase) never in code, URLs, console.*, test snapshots, or committed files. Test tokens look like test-token-...
- Mobile first (375 px), must also work on desktop. Touch targets >= 44 px.
- Line endings LF. Commit locally; never push without human approval.

## Where things live

- `src/db` – Dexie: `recipes`/`categories`/`tags` repos (`save` bumps `rev`, `softDelete` = tombstone, `putRaw` for import), `photos`, `settings`, `getDeviceId()`.
- `src/domain` – types, units, `search.ts`, `scale.ts` (servings), `durations.ts` (timer parsing). Pure, unit-tested.
- `src/i18n` – `t(key, {count})`, `pl.ts` (default) + `en.ts` must have the same keys; `categoryName()`, `unitLabel()`, `getLanguage()`.
- `src/lib/crypto` – passphrase key (PBKDF2 → AES-GCM, non-extractable, IndexedDB); `src/lib/github` – Contents API client with retry.
- `src/lib/backup` – bundle build/parse/import (`schema.ts` = zod), `github-backup.ts` = backup/restore/prune per device.
- `src/lib/sync` – pure 3-way merge (`mergeSnapshot`) + `syncPeer`/`applyMerge`/`listConflicts`/`resolveConflict`; `github.ts` transport.
- `src/features/*` – screens: recipes, photos, search, cooking, timers, sync (`runSync()`, conflict screen), pairing (QR), backup, settings.

## Rules that bite

- GitHub token: always via `getGitHubConfig()`; never read `settings.githubToken` (it is encrypted at rest, `dk1:` prefix).
- New Recipe field: add it to `src/domain/types.ts` **and** the bundle zod schema (`src/lib/backup/schema.ts`, optional so old
  backups parse) **and** a `sync.field.<name>` label in `FIELD_KEYS` (`src/features/sync/ConflictList.tsx`).
- `recipes.save()` replaces the whole record: a screen that edits only some fields must re-read the stored record and keep
  the rest (see `recipeFlags.ts` / `updateFlags`), or the missing fields are wiped and the wipe then syncs to other devices.
- Settings is a home page + sub-screens (`/settings/github|encryption|backup|pairing`, Run 4); Backup is not in the side
  menu (`/backup` redirects to `/settings/backup`). Sub-screen back links come from `backTarget()` in `Layout.tsx`.
  A saved GitHub config shows a summary (`data-testid="github-summary"`) – press **Edytuj** to get the form.
- Cooking mode (`/recipes/:id/cook`) is outside `Layout`: anything global (e.g. `TimerBar`) must be mounted there too.
- Step text renders through `<StepText>` (timer chips); ingredients through `formatIngredient()` (`src/features/recipes`).
- e2e runs on the production build: navigate with `goViaMenu()` (`tests/e2e/menu.ts`), never import `/src/…` – use
  `injectModule()` (`tests/e2e/bundle.ts`); GitHub is mocked (`test/mocks/github`). UI text in e2e is Polish.
- To run a single spec: `npx playwright test <spec> --workers=1` (ports via `PW_PORT`/`PW_PREVIEW_PORT`).
- Stop running dev servers before `npm ci` (Windows locks native files in `node_modules`).
