# Family Recipes

A small installable web app (PWA) for keeping family recipes: categories, tags, ingredients with Polish units
(szklanka, łyżka, łyżeczka, szczypta…), numbered steps and photos. It works offline and keeps all data **on the
device**. An optional **encrypted backup** goes to a private GitHub repository, from where it can be restored on
the same or another device.

Features: two-way sync between devices with a conflict screen, QR setup of a second device, servings scaling,
step timers, favourites / rating / last cooked, search, cooking mode, Polish and English UI, and several visual
themes (Settings → Style). Setting things up for real (data repo, token, hosting) is described step by step in
**[docs/HUMAN-CHECKLIST.md](docs/HUMAN-CHECKLIST.md)**.

## Development

Needs Node 24 and npm.

```bash
npm ci            # install exactly what package-lock.json says
npm run dev       # dev server (Vite)
npm run dev:phone # HTTPS dev server on the LAN + QR code, for testing on a real phone
npm run check     # lint + typecheck + unit tests (must be green before every merge)
npm run e2e       # Playwright, Chromium + WebKit (also builds and previews the production app)
npm run build     # production build into dist/
npm run preview   # serve dist/ locally
```

Build for GitHub Pages (the app lives under a sub-path, so the base must be set):

```bash
VITE_BASE=/MyRecipies/ npm run build
```

(PowerShell: `$env:VITE_BASE='/MyRecipies/'; npm run build`. Git Bash on Windows rewrites `/MyRecipies/` into a Windows path: prefix the command with `MSYS_NO_PATHCONV=1`.) Without `VITE_BASE` the base is `/`.
e2e runs in Polish (the default language) on the production build; Chromium (Pixel 5) and WebKit (iPhone 13), 375–393 px wide, plus a few desktop-width checks. Use `goViaMenu()` from `tests/e2e/menu.ts` to navigate via the side menu and `injectModule()` from `tests/e2e/bundle.ts` instead of importing `/src/...`.
Port overrides for e2e: `PW_PORT` (dev server, default 4391) and `PW_PREVIEW_PORT` (production preview, default 4392).

Phone testing (iPhone over Wi-Fi, Android over USB) is described in
[docs/HUMAN-CHECKLIST.md](docs/HUMAN-CHECKLIST.md#12-testing-on-a-phone-developer).

Conventions (also in [CLAUDE.md](CLAUDE.md)): all UI strings via `t()`, colours/spacing only via theme tokens,
no secrets in code/logs/URLs, mobile first, touch targets ≥ 44 px.

## Architecture

Vite + React 18 + strict TypeScript, React Router, Dexie (IndexedDB), `zod`, `vite-plugin-pwa` (Workbox).

```
src/app/            routing, layout (header, side menu: drawer below 900 px, permanent above)
src/i18n/           t(), pl.ts (default) and en.ts; every string goes through t(); language in localStorage `recipes.lang`
src/domain/         types, units, settings keys, search, servings scaling (scale.ts), timer parsing (durations.ts)
src/db/             Dexie schema + repositories (recipes, categories, tags, photos, settings, kv)
src/features/       recipes (list, search, editor, detail, favourites), cooking mode, timers, photos, settings,
                    backup, sync (runSync + conflict screen), pairing (QR setup of a second device)
src/lib/sync/       sync engine: pure 3-way merge (mergeSnapshot), applyMerge, conflict store; github.ts = transport
src/lib/image/      photo pipeline: downscale to 1600 px, WebP/JPEG, EXIF stripped, SHA-256
src/lib/backup/     backup bundle (build/parse/import) + github-backup.ts (encrypted backup/restore)
src/lib/crypto/     passphrase → key, AES-GCM, key storage (Web Crypto only)
src/lib/github/     small GitHub Contents-API client
src/pwa/            service worker registration, update banner, persistent-storage request
src/theme/          tokens.css, themes/*.css, useTheme() (see src/theme/README.md)
tests/e2e/          Playwright;  test/mocks/github  in-memory fake GitHub used by tests
design/proposals/   three standalone style proposals
scripts/            helper scripts, e.g. decrypt-backup.mjs (see below)
```

**Data model.** Everything has a UUID, `createdAt`/`updatedAt`, `deviceId` and a `rev` counter. Deletes are soft
(`deleted: true`, "tombstones"); they are what lets a deletion travel to other devices. Recipes also carry optional
`favourite`, `rating` (1-5) and `lastCookedAt` (local day, `YYYY-MM-DD`); old backups without them still load.

**Offline / updates.** After the first visit the whole app is cached by a service worker. When a new version is
published, a banner "A new version is available – Reload" appears (checked at start, when the app comes to the
foreground, and hourly). The app also asks the browser for persistent storage (status shown in Settings → Storage).

## Backup format

There are two kinds of backup.

**Local export (plain JSON, not encrypted).** Settings → Local backup → export gives
`recipes-backup-YYYYMMDD-HHmm.json` including photos (base64). Import offers *add missing items* (never
overwrites) or *replace all data* (makes an automatic safety copy first).

**GitHub backup (encrypted).** The bundle (`format: "recipes-backup"`, `version: 1`: recipes, categories, tags
including tombstones, photo metadata) is encrypted on the device and uploaded to the private data repository:

```
keycheck.json                                 plain: salt + iteration count + a small encrypted check value
devices/<deviceId>/backups/<timestamp>.enc    encrypted bundle, one per backup (e.g. 2026-11-09T12-34-56-789Z.enc)
devices/<deviceId>/latest.enc                 copy of the newest backup
devices/<deviceId>/device.json.enc            encrypted { name, lastBackupAt }
photos/<hmac>.enc                             encrypted photo, uploaded once (file name = HMAC of the photo hash)
```

Every `.enc` file is UTF-8 JSON `{ "v": 2, "alg": "AES-256-GCM", "iv": "<base64>", "ct": "<base64>" }`.
`v: 2` uses the file's path (relative to the base folder) as AES-GCM additional data
(`recipes/file/v2:devices/<id>/latest.enc`), so a file moved or copied to another path – e.g. an old backup put
over `latest.enc` – fails to decrypt. Files from older versions are `v: 1` (no additional data) and still read.
Sync also skips a peer whose `latest.enc` carries another device's ID, or is older than the newest one already
merged from that peer (shown as "older than one already synced"), so an old copy can't undo later edits.
Photos are stored once and shared by all backups and devices. If the data repository has a base folder configured
in Settings, all paths above are inside that folder.

`scripts/decrypt-backup.mjs` is an independent Node script that decrypts a downloaded backup with your passphrase
and validates it with the same schema – proof that the data can be read without the app. Needs Node ≥ 22.18 and
`npm ci` (it imports `zod`):

```bash
npm run decrypt-backup -- <file|dir> --passphrase-file <path> [--keycheck <keycheck.json>] [--out <dir>] [--json]
```

`keycheck.json` is looked up next to the file / in the directory (or its parents) unless `--keycheck` is given.
With `--out`, the decrypted bundle JSON and photos (sha256-verified) are written to that folder. Keep the passphrase
file outside the repository and delete it afterwards.

## Security model

- **Passphrase → key:** PBKDF2-SHA256, 600 000 iterations, random 16-byte salt → HKDF → two keys (AES-256-GCM for
  data, HMAC-SHA256 for photo file names). A fresh random IV per file. The passphrase is never stored or sent.
- **Key on the device:** kept as a *non-extractable* `CryptoKey` in IndexedDB (separate database `recipes-crypto`),
  so a new backup does not need the passphrase again. "Forget key" in Settings removes it.
- **What GitHub sees:** file names, sizes and timestamps (so roughly how many backups and photos exist); **not** titles,
  ingredients, photos or names (photo file names are HMACs, so photo hashes do not leak). Use a *private* repo anyway.
- **Lost passphrase = lost cloud backup.** There is no recovery. Local data on devices is unaffected.
- **GitHub token:** fine-grained, one repository, Contents read/write only, with an expiry. Stored in the device's
  IndexedDB **encrypted at rest** with a separate non-extractable device key (database `recipes-device-key`,
  stored as `dk1:` + envelope; a plain token from an older version is migrated on first read). This protects
  against casual inspection of the stored data only: code running in the app's own origin can still use the
  key. The token is excluded from the exported settings file, masked in the UI, never logged or put in a URL.
  Keep the token's scope minimal.
- **Origin = trust boundary.** Browsers isolate storage per *origin* (scheme + host + port), not per path. On
  `https://<user>.github.io/MyRecipies/` the origin is `https://<user>.github.io`, which is shared with **every other
  GitHub Pages project site of that account**: a script on any of them can read the recipes and *use* the stored
  keys (non-extractable only stops copying them out), so it can decrypt the token and the backups. Host the app on
  its own origin (custom domain or subdomain, docs/HUMAN-CHECKLIST.md section 4) unless this account publishes no
  other Pages sites, now or later.
- **Content-Security-Policy:** the production build carries a CSP `<meta>` (vite.config.ts): scripts only from the
  app itself, network only to the app and `https://api.github.com`, no plugins/`<base>` changes. It limits what an
  injected script could load or where it could send data; it does not help against another app on the same origin.
- **One key per repo, never a second one.** Settings → Encryption creates `keycheck.json` only when the repo has
  none *and* no backups (`devices/`, `photos/`), only after the passphrase is typed twice, and with a create-only
  upload (a key check written meanwhile by another device is never overwritten). A GitHub error while looking for
  it is an error, not "no key yet". Passphrase fields are hidden (`type="password"`) unless "Show" or "Suggest" is
  pressed.
- **One repo operation at a time:** backup, restore and sync share a lock (Web Locks API, so also across tabs);
  a second one waits. A write that reached GitHub but answered with an error is detected on the retry (the file
  already holds the same bytes) and counts as done.
- **CI:** the Pages workflow pins every action to a commit SHA; Dependabot proposes updates as PRs.
- **Local data is not encrypted** on the device (like any normal website data).
- Secrets never belong in code, tests, logs or commits (test tokens look like `test-token-…`).

## Sync between devices

Menu → **Synchronizacja** → **Synchronizuj teraz**. It is manual (nothing runs in the background) and needs the
GitHub settings plus the unlocked passphrase on the device.

How it works: every device already writes its full state to `devices/<deviceId>/latest.enc` in the data repo (see
Backup format) and only ever writes its *own* folder, so GitHub never reports write conflicts. A sync (`runSync()`)
reads every *other* device's `latest.enc`, merges it into the local data in one database transaction, downloads
missing photos, and then makes a normal backup of the merged result so the others can pick it up on their next sync.
If GitHub cannot be reached nothing is changed.

Merge rules (3-way, no clocks): for each peer the app remembers the last version of every record it saw from it (the
*base*, table `syncBase`). Per record and per field (ingredients, steps, tags and photos each count as one field):

- only the other device changed it → take theirs; only this device changed it → keep mine;
- both changed *different* fields → combine (e.g. a favourite set on one phone and a steps edit on the other);
- both changed the *same* field differently → **conflict**; a delete on one side and an edit on the other is a
  conflict too, so nothing is lost silently;
- a record only one side has is added.

A conflict (table `syncConflicts`) leaves the local version active and shows a badge on the menu entry. The conflict
screen shows both versions side by side with **Zostaw moją** (keep mine), **Weź ich** (take theirs) and **Edytuj**
(pick per field or type a new value). After choosing, press *Synchronizuj teraz* again so the other device sees the
result.

## Setting up a second device by QR

Settings → **Drugie urządzenie** on a configured device → **Pokaż kod QR dla innego urządzenia** shows a QR code and a
one-time 10-character code. On the new device: Settings → **Zeskanuj z innego urządzenia**, scan, type the code. The QR
text is `recipes-pair:1:` + an AES-GCM envelope encrypted with a key derived (PBKDF2, fresh salt) from that code; it
carries the GitHub owner/repo/branch/folder, the token, UI language and retention settings. The code is never stored
and a new one is made each time the dialog opens; the receiving app refuses payloads older than one hour. That
expiry is a usability guard, **not** a security boundary: anyone who keeps a copy of the QR/text can try to guess
the code offline for as long as the token is valid. The 10-character code (~2^49.5, PBKDF2 600 000 iterations)
makes that very expensive, but never send the pairing text over a channel others can read, and give the token a
short expiry. **The passphrase is
never part of it** – it is typed from the paper afterwards. Without a camera, "Brak aparatu? Użyj tekstu" gives the
same payload as text to paste. The QR is always black on white (it contains a token, so no theming).

## Cooking helpers

- **Servings scaling:** when a recipe has servings, − / + on the detail page and in cooking mode scales the
  amounts (teaspoon/tablespoon/glass to ¼ below 1 else ½, pieces to ½, g/ml whole numbers, kg/l 2 decimals, never 0;
  pinch, to taste and "other" stay as they are). It is a view only and is not saved.
- **Step timers:** durations in step text ("40 min", "1 h 30 min", "1,5 godziny", "10-15 min" = upper bound) become
  tappable chips. Running timers show in a bar on every page, survive a reload (the end time is stored) and alarm
  with sound, vibration and a notification where the browser allows it; several can run at once.
- **Favourites, rating, last cooked:** heart and 1-5 stars on the detail page, "Gotowe – ugotowane" on the last
  cooking step (or "Ugotowane dziś"); the list can filter favourites and sort by last cooked or rating. All of it
  syncs like any other field.

## Language

The UI is Polish by default; English can be chosen in Settings → Language (stored in localStorage `recipes.lang`,
applied on reload). Default categories are stored as i18n keys and shown in the current language. The generated
passphrase word list (2048 words, PL or EN) follows the same choice.

## Settings layout

`/settings` holds the everyday choices (language, style) on top, then links to sub-screens, then this device and
storage. Sub-screens have a header back link to `/settings`:

| Route | Contents |
|---|---|
| `/settings/github` | GitHub connection: summary + **Edit** once saved, test connection; settings file (export/import) |
| `/settings/encryption` | passphrase setup / unlock / forget key |
| `/settings/backup` | GitHub backup + restore, retention, sync shortcut, local backup file. `/backup` redirects here |
| `/settings/pairing` | QR / text setup of a second device |

## Backup retention

After every GitHub backup the app deletes this device's oldest `devices/<id>/backups/*.enc` files beyond the
**keep last N** setting (Settings → Backup, default 20, range 1-500; "keep one per day" is next to it). The newest backup, `latest.enc`, photos,
`keycheck.json` and other devices' files are never deleted. If deleting fails the backup itself still succeeds
and pruning is retried after the next one. When the key is locked, the Backup screen asks for the passphrase
inline.

## Known limits

- **Sync is manual** (press the button; no background sync) and works only for devices that use the same data repo
  and the same passphrase. A device using a different passphrase is skipped with a message.
- **Two people resolving the same conflict in opposite ways.** If both devices choose "Zostaw moją", they can end up
  different without a new conflict; if one device chooses "Zostaw moją", the other is asked once about the same
  record. "Weź ich" settles it silently.
- **First sync of a long-separated device.** A device has no base for a peer until its first sync. If the peer
  already edited records this device also has, each differing record becomes a conflict. Best practice: set a new
  device up by QR and let it sync *before* editing anything.
- **Timers:** alarms only ring while the app is open; Android Chrome may refuse notifications (sound/vibration are
  the fallback). Number words ("dwie godziny"), days and "1:30" are not detected.
- Rating and favourite are not editable in the recipe form and not searchable; the conflict screen shows them as
  plain true/false and numbers.
- **Not yet checked on real devices:** QR scan with an iPhone camera, sync between two real phones, timer alarm
  sound/vibration/notification, cooking-mode swipe and wake lock, photos on iPhone. See the checklist.
- **Old backups are pruned only per device** (keep last N, see above); nothing is ever deleted from other devices.
- No change-passphrase function (a new passphrase would mean re-uploading everything).
- Backup and restore were verified by the human against a real private GitHub repo on 2026-11-10; sync and QR pairing
  have only been tested against the mock so far.
- Placeholder icons. Sample recipes exist only in the dev server (Settings, dev builds).

