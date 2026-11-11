# Human checklist – setting the app up for Mum

For the person (you) doing the one-time setup. No programming needed except where a command is shown.
Tick the boxes as you go. Total time: about 45 minutes, plus the tests.

**Words used here**

- **Code repo** – `github.com/Sztub/MyRecipies`, where the app's code lives. It will also host the app (GitHub Pages).
- **Data repo** – a *new, private* GitHub repository that only holds the encrypted backups.
- **Token** – a long password-like text that lets the app write to the data repo, and nothing else.
- **Passphrase** – the secret words that encrypt the backups. Only you and Mum know it.

> ⚠️ Read before you start: **section 4 (final address)** decides where the app lives. Do it *before* Mum installs
> anything. Changing the address later means her installed icon and all recipes stored on that phone are lost
> (they can be restored from a backup, but only if one was made).

---

## 1. Create the private data repo

- [ ] 1.1 Sign in to GitHub. Click the **+** at the top right → **New repository**.
- [ ] 1.2 **Repository name:** `recipes-data` (any name is fine; remember it exactly).
- [ ] 1.3 Choose **Private**. (Never Public – even though the files are encrypted.)
- [ ] 1.4 Tick **Add a README file** (this creates the `main` branch; an empty repo does not work).
- [ ] 1.5 Click **Create repository**.
- [ ] 1.6 Write down: owner `Sztub` (or whichever account owns it), repository `recipes-data`, branch `main`.

## 2. Create the access token (only for that one repo)

- [ ] 2.1 Top right: your profile picture → **Settings**.
- [ ] 2.2 Left menu, at the very bottom: **Developer settings** → **Personal access tokens** → **Fine-grained tokens**.
- [ ] 2.3 Click **Generate new token**.
- [ ] 2.4 **Token name:** `recipes-app`.
- [ ] 2.5 **Expiration:** choose *Custom* and pick the longest allowed (up to 1 year). Put the date in your calendar
      (see 2.11).
- [ ] 2.6 **Resource owner:** your account.
- [ ] 2.7 **Repository access:** choose **Only select repositories** → pick **`recipes-data`**. Nothing else.
- [ ] 2.8 **Permissions** → **Repository permissions** → find **Contents** → set to **Read and write**.
      (*Metadata: Read-only* is added automatically. Leave everything else at "No access".)
- [ ] 2.9 Click **Generate token**. GitHub shows the token **once** (it starts with `github_pat_`). Copy it now.
- [ ] 2.10 Store it somewhere safe, e.g. a password manager. Don't email it, don't put it in the code repo or in chat.
- [ ] 2.11 **When it expires:** the app will say "Your GitHub token has expired". Nothing is lost. Repeat 2.1–2.10
      (or open the old token under *Fine-grained tokens* → **Regenerate token**), then on each device go to
      **Settings → GitHub backup**, paste the new token, press **Save** and **Test connection**. The passphrase
      stays the same.

## 3. Choose the passphrase and write it on paper

- [ ] 3.1 Pick 5–6 random words (e.g. use the app's **Suggest a passphrase** button in Settings → Encryption), at
      least 8 characters. Avoid anything guessable like names and birthdays.
- [ ] 3.2 **Write it on paper**, exactly as typed (spelling, spaces, capitals), and keep it somewhere safe at home.
      Optionally a second copy with a trusted family member.
- [ ] 3.3 Understand this: **if the passphrase is lost, the cloud backup cannot be opened by anyone – not you, not
      GitHub, not the developer.** Recipes still on the phone are fine; only the backup becomes useless.
      There is no "forgot passphrase" button.
- [ ] 3.4 Do *not* save the passphrase in the same place as the token.

## 4. Choose the final app address (before Mum installs)

The app will be hosted for free by GitHub Pages at:

**`https://sztub.github.io/MyRecipies/`** (`<GitHub username in lowercase>.github.io/<code repo name>/`)

- [ ] 4.1 Decide: is this the address you want to keep forever? If you would rather have another repo name or your
      own domain, change it **now** (and set the same value as `VITE_BASE` in `.github/workflows/deploy.yml`, e.g.
      `/` for a custom domain).
- [ ] 4.2 Remember why: a phone stores the recipes **per address**. A different address = an empty app, and the old
      home-screen icon no longer opens the new one. After a change you would have to install again and restore
      from a backup.
- [ ] 4.3 **Security:** a phone keeps the app's data and keys per *origin* = `https://sztub.github.io`, the part
      before `/MyRecipies/`. Every other GitHub Pages site of this account (`sztub.github.io/<any repo>/`) is the same
      origin and its scripts could read the recipes and use the token and backup key. If this account has or may
      ever have another Pages site, use a custom (sub)domain for the app instead, e.g. `przepisy.example.pl`
      (repo Settings → Pages → Custom domain, tick *Enforce HTTPS*, set `VITE_BASE: /`).
- [ ] 4.4 Note: free GitHub accounts can only publish Pages from a **public** code repo. That is fine: the code
      contains no secrets and no recipes. (The *data* repo stays private.)

## 5. Publish the app (turn on GitHub Pages)

The deploy workflow is already in the code repo but **switched off** (it only runs when started by hand).

- [ ] 5.1 Make sure everything is on GitHub (the developer pushes `main`; the code is not pushed automatically).
- [ ] 5.2 In the code repo: **Settings** → **Pages** (left menu) → **Build and deployment** → **Source:**
      **GitHub Actions**.
- [ ] 5.3 Go to the **Actions** tab → **Deploy to GitHub Pages** → **Run workflow** → branch `main` → **Run workflow**.
      Wait for the green tick (a few minutes). The job also runs the tests; if it is red, open it and send the
      developer the error.
- [ ] 5.4 Open `https://sztub.github.io/MyRecipies/`. You should see the app. Try opening
      `https://sztub.github.io/MyRecipies/settings` directly – it should also work.
- [ ] 5.5 *(Optional, later)* To publish automatically on every change to `main`, edit
      `.github/workflows/deploy.yml` and follow the comment at the top (add a `push:` trigger).

## 6. First device setup (your own phone or PC)

Use the real address from step 5. Do this on your device first, not on Mum's.

- [ ] 6.1 Open the app. Add one or two test recipes **with a photo** (Recipes → add).
- [ ] 6.2 **Settings → GitHub backup:** Owner = `Sztub`, Repository = `recipes-data`, Branch = `main`,
      leave "Folder in repository" empty, paste the **token**. Press **Save**.
- [ ] 6.3 Press **Test connection**. Expected: "Connection works." If you see:
      - "token was rejected" → the token was copied wrongly or is expired;
      - "Repository not found" → owner/name typo, or the token wasn't given access to that repo;
      - "cannot write" → Contents permission is *Read-only*, change it to *Read and write*;
      - "Could not reach GitHub" → internet problem (or, if it persists on a good connection, tell the developer –
        this is the first time the app talks to the real GitHub).
- [ ] 6.4 **Settings → Encryption:** type the passphrase from the paper in both fields, press **Set up / unlock**.
      It takes a second or two. Expected: "Encryption set up. The key check was uploaded to your repository."
- [ ] 6.5 **Settings → This device:** give the device a name ("Anna's iPhone", "Mum's phone").
- [ ] 6.6 Open **Settings → Backup** → **Back up now**. Wait for "Backup finished."
- [ ] 6.7 On GitHub open the `recipes-data` repo. You should see `keycheck.json`, `devices/…` and `photos/…`.
      Open a `.enc` file: it must look like random letters, **no recipe titles or text**. If you can read a
      title, stop and tell the developer.
- [ ] 6.8 **Settings → Storage:** if it says "Not protected", press **Request protection** (on iPhone this works
      best once the app is installed to the home screen, see section 8).

## 7. Real backup → restore test (do not skip)

> ✅ **Done 2026-11-10:** connection test, backup to a real private repo and restore of a deleted recipe all worked.
> Repeat it only after changing the repo, token or passphrase.

A backup you have never restored is just a hope. Test with the test recipes from 6.1.

- [ ] 7.1 *Best:* restore on a second device or a fresh browser profile (section 9) and check what arrives.
- [ ] 7.2 *Or on the same device:* first **Settings → Backup → Backup file → Export** a safety file (plain JSON) and keep it.
      Then delete one test recipe, open **Settings → Backup → Show backups**, choose the newest backup and press
      **Restore – add missing items**. The deleted recipe (with its photo) should be back.
- [ ] 7.3 Check: titles, ingredients, steps, categories, tags and photos all there.
- [ ] 7.4 Check the failure message once: on a device, **Settings → Encryption → Forget key on this device**, then
      unlock with a typo → "Wrong passphrase". Then unlock with the right one.
- [ ] 7.5 *(Optional, technical)* Prove the backup is readable without the app: download a `.enc` file from the repo
      plus `keycheck.json` into one folder, put the passphrase in a text file **outside** the project, and run
      `npm run decrypt-backup -- <folder> --passphrase-file <path>` (needs Node ≥ 22.18 and `npm ci`). Delete the
      passphrase file afterwards.
- [ ] 7.6 Delete the test recipes (or keep them until Mum's real ones are in), then make a fresh backup.

## 8. Install on Mum's phone

Only after sections 4–7 are done.

**iPhone / iPad (must be Safari – other browsers can't install web apps properly):**

- [ ] 8.1 Open Safari and go to `https://sztub.github.io/MyRecipies/`.
- [ ] 8.2 Tap the **Share** button (square with an arrow; bottom centre, or top right on iPad).
- [ ] 8.3 Scroll down and tap **Add to Home Screen** (on newer iOS you may need **View More** first).
- [ ] 8.4 Keep the name "Recipes" (or rename), make sure **Open as Web App** is on if shown, tap **Add**.
- [ ] 8.5 From now on, **open the app from the home-screen icon**, not from Safari. (The icon app and Safari keep
      their data separately on iOS – set up the backup *inside the icon's app*.)
- [ ] 8.6 In the installed app do the settings of section 6 (6.2–6.5), or use the second-device route (section 9),
      which is the easiest way to get existing recipes onto her phone.

**Android (Chrome):** open the address → menu (⋮) → **Install app** (or **Add to Home screen**) → **Install**.

**Computer (Chrome/Edge):** the install icon in the address bar, or just bookmark it.

Tips for Mum: the app works without internet. Recipes and photos live on the phone; "Back up now" copies them to
GitHub. Recommend pressing it after adding recipes (e.g. once a week).

## 9. Second device setup

Second device = Mum's phone, your PC, a tablet…

- [ ] 9.1 Install/open the app as in section 8 (same address as the first device!).
- [ ] 9.2 *Easiest:* use the QR code, see **section 14**. Otherwise, quick way for the GitHub fields: on the first device **Settings → GitHub backup → Set up another device → Export
      settings** (a small file *without* token or passphrase), send it to the second device (e.g. a chat app to
      yourself), and **Import settings** there. Or just type owner / repo / branch by hand.
- [ ] 9.3 On the second device, paste the **token** (from your password manager), **Save**, **Test connection**.
- [ ] 9.4 **Settings → Encryption:** enter the **same passphrase** (from the paper). Because the repo already has
      `keycheck.json`, the app *unlocks* with it instead of creating a new one. Expected: "Unlocked using the
      existing passphrase." A wrong passphrase says "Wrong passphrase" and changes nothing.
- [ ] 9.5 Name this device (Settings → This device).
- [ ] 9.6 **Settings → Backup → Show backups** → choose the newest backup of the other device → **Restore – add missing
      items** (or *replace all data* if this device is empty or should become an exact copy).
- [ ] 9.7 Check recipes and photos arrived.
- [ ] 9.8 **Remember:** *Restore* is a one-off copy ("add missing items" never overwrites anything). To keep two
      devices up to date use **Synchronizacja** instead – see **section 13**.

## 10. Updating the app

- [ ] 10.1 *Developer:* merge changes into `main`, then run the deploy workflow again (Actions → **Deploy to
      GitHub Pages** → Run workflow), or it runs automatically if you enabled the push trigger (5.5).
- [ ] 10.2 *Mum:* the next time she opens the app (or brings it back to the front) with internet, a banner appears:
      **"A new version is available." → Reload**. Tapping **Reload** installs it. **Later** keeps the old version
      until next time.
- [ ] 10.3 If no banner shows after a few minutes: close the app completely (swipe it away) and open it again;
      the check runs on every start. Her recipes are never touched by updates.

## 11. Known limits of this first version (so nothing surprises you)

- **Sync is manual** (section 13): changes travel only when you press *Synchronizuj teraz* on both devices.
- **Old backups are pruned automatically.** After each backup the app keeps only the newest N backups of *this*
  device (Settings → Backup → "Ile kopii tego urządzenia zachować", default 20, 1-500); photos, `latest.enc`,
  `keycheck.json` and other devices are never touched. If pruning fails the backup still succeeded; it is retried
  next time. Never delete `keycheck.json` by hand.
- The **GitHub token is stored encrypted** on the device (with a device key that cannot be exported). That keeps it
  out of plain sight, but it is not protection against someone who can run code inside the app; revoke the token on
  GitHub if a device is lost.
- **Language:** the app starts in Polish; English is under Settings → Language. After switching, check that menu,
  recipe form and Settings → Backup all changed.
- **After a restart the key may be locked:** Settings → Backup then shows "Odblokuj kopie na tym urządzeniu"; type the
  passphrase there (no need to go to Settings → Encryption).
- A **lost passphrase** means the cloud backup is gone for good (3.3). Changing the passphrase is not supported yet.
- Plain, unencrypted **local export** files contain everything readable – treat them as private.
- The app icons are placeholders.
- Backup and restore on real GitHub were verified on 2026-11-10. Sync and QR setup are still untested on real
  phones (section 15) – please report anything odd (what you pressed and the message shown; never send the token or
  passphrase).

## 12. Testing on a phone (developer)

For trying unpublished changes on a real phone. Nothing here is needed for normal use of the app.

**Why HTTPS?** Browsers only enable the offline engine (service worker) and installing the app on secure
addresses. So the test server uses HTTPS with a self-signed certificate – the phone will warn about it once.

### 12.1 iPhone (or any phone) over Wi-Fi

- [ ] 12.1.1 PC and phone are on the **same Wi-Fi**. In a terminal in the project folder run `npm run dev:phone`.
- [ ] 12.1.2 The terminal prints an address like `https://192.168.1.13:5173/` and a **QR code**. Point the phone
      camera at the QR code and open the link (or type the address).
- [ ] 12.1.3 The phone says the connection is **not private**. Choose **Show details → visit this website**
      (Safari) or **Advanced → Proceed** (Chrome). This is expected for the self-signed certificate.
- [ ] 12.1.4 If the page never loads: Windows Firewall may block incoming connections for Node.js. When Windows
      asks "Allow Node.js on private networks?" choose **Allow**. Also check that the Wi-Fi is not a "guest" network
      (those often isolate devices from each other). The script changes no Windows settings itself.
- [ ] 12.1.5 Press **Ctrl+C** in the terminal to stop the server when done.

What does **not** work well this way:
- **Installing** the app to the Home Screen or a working **offline mode** – iPhone Safari refuses service workers
  on a self-signed certificate. Test install/offline on the published address (sections 8 and 10) instead.
- Data entered on the test address is **separate** from the published app (different address = different storage).
- Each time the PC's network address changes (new Wi-Fi, restart), the address and QR code change.

### 12.2 Android over USB (no Wi-Fi needed)

Chrome on the phone can open the PC's server as `localhost`, which counts as secure – so the service worker and
install work without any certificate warning.

- [ ] 12.2.1 On the phone: **Settings → About phone** → tap **Build number** 7 times (turns on developer options).
      Then **Settings → Developer options → USB debugging** → on.
- [ ] 12.2.2 Connect the phone to the PC with a USB cable. On the phone, accept **Allow USB debugging?**
      (tick "Always allow from this computer").
- [ ] 12.2.3 On the PC start the normal server: `npm run dev` (it listens on port 5173).
- [ ] 12.2.4 On the PC open Chrome and go to `chrome://inspect/#devices`. Your phone should be listed. Make sure
      **Discover USB devices** is ticked.
- [ ] 12.2.5 Click **Port forwarding…**, enter port `5173` and address `localhost:5173`, tick **Enable port
      forwarding**, click **Done**. The list shows a green dot when it works.
- [ ] 12.2.6 On the phone, open **Chrome** and go to `http://localhost:5173/`. The app appears.
- [ ] 12.2.7 Optional: under your phone in `chrome://inspect` click **inspect** to get the PC's developer tools
      (console, network) for the page on the phone.
- [ ] 12.2.8 If the phone isn't listed: try another USB cable (some only charge), set the USB mode to **File
      transfer**, and re-accept the debugging prompt. Windows may need the phone maker's USB driver.

## 13. Sync between two devices

Use this when you and Mum both change recipes and want both phones to show the same. Sync is **manual**: nothing
happens in the background. Both devices need: the same app address, the same data repo and token, the same
passphrase, and an internet connection.

**Before you start**

- [ ] 13.1 Both devices are set up (sections 6 and 9, or 14) and unlocked. In **Settings → This device** give each a
      different, recognisable name ("Mum's phone", "Anna's iPhone") – sync messages use these names.
- [ ] 13.2 On the device that has the recipes: menu → **Synchronizacja** → **Synchronizuj teraz**. Expected:
      "Synchronizacja zakończona." and, if no other device exists yet, "W repozytorium nie ma jeszcze innych urządzeń".
- [ ] 13.3 On the second device (still empty or nearly): menu → **Synchronizacja** → **Synchronizuj teraz**. Expected:
      "<name of first device>: N nowych". The recipes (and photos) appear in the list.
- [ ] 13.4 Back on the first device press **Synchronizuj teraz** once more, so it learns about the second.
      Expected: "<second device>: bez zmian".

**Normal use: the rule of thumb is "sync before and after you edit"**

- [ ] 13.5 *Different changes combine.* On device A mark a recipe as favourite (heart) and give it stars. On device B
      change a step of the same recipe. Press **Synchronizuj teraz** on A, then on B, then on A again. Expected: no
      conflict message; both devices show the heart, the stars **and** the changed step.
- [ ] 13.6 *Same change → conflict.* On A and B change the **title** of one recipe to two different texts. Sync A,
      then sync B. On B expect "1 wymaga Twojej decyzji" and a number badge next to **Synchronizacja** in the menu.
- [ ] 13.7 Open **Synchronizacja**. The card shows "Moja" and the other device's version side by side. Choose
      **Zostaw moją** (keep mine), **Weź ich** (take theirs) or **Edytuj** (pick per field or type a new text), then
      press **Synchronizuj teraz** on B and again on A. Expected: both show the same title, badge gone.
      *Nothing is lost while a conflict is open – your own version stays in use until you choose.*
- [ ] 13.8 *Delete vs edit.* Delete a recipe on A and change it on B, then sync both. Expected: a card showing
      "Usunięte" / "Zachowane" – you decide which one wins.
- [ ] 13.9 *Offline.* Turn on flight mode and press **Synchronizuj teraz**. Expected: "Nie można połączyć się z
      GitHubem… Nic na tym urządzeniu nie zostało zmienione."

**Things that can look odd (known, not bugs to report)**

- If you and Mum both press **Zostaw moją** on the same conflict, the two phones can stay different without a new
  warning; and if only one of you does, the other is asked once about the same recipe. Pick **Weź ich** on one of
  the phones to settle it without any more questions.
- A phone that syncs for the first time *after* the other one has already edited many recipes can show one conflict
  per edited recipe. Avoid it: set a new phone up (section 14) and press **Synchronizuj teraz** *before* editing
  anything on it.
- A device that uses a different passphrase is skipped ("używa innego hasła – pominięto").

## 14. Set up Mum's phone by QR

The QR code moves the GitHub settings **and the token** to the new phone so nobody has to type that long token. The
**passphrase is never in the QR** – Mum types it from the paper.

You need: your already-working device (section 6), Mum's phone with the app installed (section 8), the passphrase
on paper, both phones in your hands and an internet connection.

- [ ] 14.1 On **your** device: **Settings → Drugie urządzenie → Pokaż kod QR dla innego urządzenia**. A black-and-white
      QR code appears with a 10-character **kod jednorazowy** (one-time code) below it. Keep this window open.
- [ ] 14.2 On **Mum's phone**, open the app **from its home-screen icon**, then **Settings → Drugie urządzenie →
      Zeskanuj z innego urządzenia → Skanuj kod QR**. Allow the camera when asked, and point it at the QR code
      (hold the phone about 20-30 cm from the screen; turn the screen brightness up).
- [ ] 14.3 Expected: "Kod QR odczytany. Teraz wpisz kod jednorazowy." Type the 10 characters from your screen and
      press **Połącz**. Expected: "Ustawienia zapisane na tym urządzeniu."
- [ ] 14.4 The last step appears: "wpisz hasło z kartki". Type the passphrase from the paper and unlock. Expected: "To
      urządzenie jest odblokowane i gotowe do tworzenia kopii."
- [ ] 14.5 Give the phone a name (Settings → This device), then menu → **Synchronizacja** → **Synchronizuj teraz**.
      Mum's phone should now show your recipes. (See section 13 for what to expect afterwards.)
- [ ] 14.6 Close the QR window on your device (the next one gets a new code). If it was open for more than about an hour the
      new phone will refuse it ("Ta konfiguracja wygasła") – just open a fresh QR.
- [ ] 14.7 **If the camera does not work** (permission refused, no camera, or the code won't scan): on your device
      tap **Brak aparatu? Użyj tekstu** and send the text to Mum's phone in a chat app. On her phone paste it into
      "Tekst konfiguracji" and continue at 14.3. Anyone who has that text *and* the 10-character code can read the
      token – also later, closing the window does not change that – so never send the code through the same
      chat (read it out), and delete the chat message afterwards.
- [ ] 14.8 Messages you might see: "Błędny kod" = a typo in the 10 characters; "To nie jest prawidłowy tekst
      konfiguracji" = the QR was scanned only partly or the pasted text is cut off – scan/copy again.

## 15. Still needs a real phone (nobody has checked these yet)

Everything below passed only in automated tests with a fake GitHub and fake camera. Please try each once and tell the
developer what happened (what you pressed, what the screen said – never the token or the passphrase).

Already verified by a human: **backup and restore against a real GitHub repo (2026-11-10)**; **15.1-15.4 and 15.6 on a real phone (2026-11-11)** – timer is silent while the phone is locked (accepted).

- [x] 15.1 **QR scan with an iPhone camera** (Safari and the home-screen app): section 14.2 – does the camera open,
      does it read the code from a laptop/PC screen?
- [x] 15.2 **Sync between two real devices**: sections 13.2-13.8 with two real phones (or phone + PC).
- [x] 15.3 **Step timer alarm**: in cooking mode start a timer of 1 minute (edit a step to say "1 min" if needed),
      then lock the phone or switch to another app. Does it ring / vibrate / show a notification while the app is
      open, and what happens when it is in the background? (iPhone has no vibration for web apps; Android Chrome may
      refuse notifications. Alarms are only reliable while the app is open.)
- [x] 15.4 **Cooking mode:** swiping left/right changes steps; the screen stays on for several minutes without
      touching it (wake lock), and comes back on after switching apps.
- [ ] 15.5 *(still open 2026-11-11 – photo sync needs more testing)* **Photos on iPhone:** add a photo from the camera and from the library (including a HEIC photo), reload the
      app, then back up and restore: the photo must still be there.
- [x] 15.6 **Servings and favourites on a phone:** the − / + buttons, the heart and the stars are easy to hit with a
      thumb and the recipe text stays readable.

## 16. Newer changes to try on a phone

- [ ] 16.1 **Delete a recipe** from the bottom of a long recipe: after **Usuń** the question "Usunąć ten przepis?"
      appears in the middle of the screen straight away (no scrolling). **Anuluj**, a tap outside it, or Escape
      closes it without deleting.
- [ ] 16.2 **Settings home** shows language and style at the top, then **Kopie i synchronizacja** with four
      entries: Kopia w GitHubie, Szyfrowanie, Kopia zapasowa, Drugie urządzenie. Each shows a short status
      (e.g. "Skonfigurowano", "Odblokowane", "Ostatnia kopia: …"). **Wróć** in the header goes back to Settings.
     
- [ ] 16.3 **Kopia zapasowa is gone from the side menu**; it is under Settings now (the old address still works).
- [ ] 16.4 **Settings → Kopia w GitHubie** on a set-up phone shows a summary (repository, branch, folder, "token
      zapisany (ukryty)") and **Edytuj** / **Sprawdź połączenie** instead of the open form. **Edytuj → Anuluj**
      changes nothing.

## Quick reference

| Thing | Value |
|---|---|
| App address | `https://sztub.github.io/MyRecipies/` |
| Data repo | private, e.g. `Sztub/recipes-data`, branch `main` |
| Token | fine-grained, only the data repo, Contents: Read and write, expires on: ________ |
| Passphrase | on paper, kept at: ________ |
