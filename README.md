# Family Recipes

A small installable web app (PWA) for keeping family recipes: categories, tags, ingredients with Polish units
(szklanka, łyżka, łyżeczka, szczypta…), numbered steps and photos. It works offline and keeps all data **on the
device**. An optional **encrypted backup** goes to a private GitHub repository, from where it can be restored on
the same or another device.

Features: two-way sync between devices with a conflict screen, QR setup of a second device, servings scaling,
step timers, favourites / rating / last cooked, search, cooking mode, Polish and English UI, and several visual
themes (Settings → Style). See [Setting it up](#setting-it-up) for the data repo, token and hosting.

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

**Testing on a phone.** `npm run dev:phone` serves HTTPS with a self-signed certificate on the LAN and prints a
QR code (the phone warns about the certificate once; allow Node.js through the Windows firewall if asked). Install
and offline mode don't work over a self-signed certificate on iPhone – test those on the published address. On
Android, `npm run dev` plus USB debugging and port forwarding in `chrome://inspect` (port 5173) opens the app as
`localhost`, where install and offline work.

Conventions (also in [CLAUDE.md](CLAUDE.md)): all UI strings via `t()`, colours/spacing only via theme tokens,
no secrets in code/logs/URLs, mobile first, touch targets ≥ 44 px.

## Setting it up

1. **Data repo.** Create a **private** GitHub repository for the backups (e.g. `recipes-data`) with a README, so
   the `main` branch exists.
2. **Token.** GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*: only that one
   repository, **Contents: Read and write**, nothing else, with an expiry. When it expires the app says so; generate
   a new one and paste it in Settings → GitHub on each device.
3. **Passphrase.** Use Settings → Encryption → *Suggest* (7 random words) and write it on paper. A lost passphrase
   means the cloud backup cannot be opened by anyone.
4. **Address.** Pick the final address *before* anyone installs the app: a phone keeps its data per address, so
   moving later means backup → install again → restore. Read *Origin = trust boundary* in [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md#security-model) first.
5. **Publish.** Free accounts can publish Pages only from a public code repo (it holds no secrets or recipes). In
   the code repo: Settings → Pages → Source: *GitHub Actions*, then Actions → *Deploy to GitHub Pages* → *Run
   workflow*. `VITE_BASE` in `.github/workflows/deploy.yml` must match the address (`/<repo name>/`, or `/` for
   a custom domain).
6. **First device.** Open the app, fill in Settings → GitHub (owner, repo, branch, token) → *Test connection*, set
   up the passphrase, make a backup, and try a restore once before relying on it.
7. **More devices.** Install the app (Safari → Share → *Add to Home Screen*; Chrome → *Install app*), then Settings →
   *Drugie urządzenie* on the first device shows a QR code to scan. The passphrase is typed in by hand.

## Security in short

- Recipes live on the device. The GitHub backup is encrypted on the device (AES-256-GCM, key from your passphrase);
  GitHub only sees file names, sizes and dates.
- The passphrase is never stored or sent. Lose it and the cloud backup can't be opened – by anyone.
- The GitHub token is limited to one private repo and stored encrypted on the device.
- Browsers share storage per address: don't host other GitHub Pages sites on the same account (or use a custom
  domain).

Details – code layout, backup format, security model, sync, QR setup – are in
**[docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)**.

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
- **Old backups are pruned only per device** (keep last N, see [Backup retention](docs/HOW-IT-WORKS.md#backup-retention)); nothing is ever deleted from other devices.
- No change-passphrase function (a new passphrase would mean re-uploading everything).
- Placeholder icons. Sample recipes exist only in the dev server (Settings, dev builds).

