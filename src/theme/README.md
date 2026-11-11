# Theme infrastructure

- `tokens.css` – token contract + default theme (light; dark via `prefers-color-scheme`, overridable with `data-mode`).
- `themes/<name>.css` – extra themes, scoped by `:root[data-theme='<name>']`.
- `themes.ts` – theme registry (`THEMES`), preference parsing, `applyPreference` (sets `data-theme` / `data-mode` on `<html>`).
- `useTheme()` – `{ themes, modes, theme, mode, setTheme, setMode }`; changes apply immediately and persist.
- `initTheme()` – called in `main.tsx` before render (no flash of wrong theme).
- `storage.ts` – `ThemeStorage` interface (sync `load`/`save`); default = `localStorage` key `recipes.theme`.

`data-mode`: absent = follow system, `light` / `dark` = forced.

## Wiring persistence to settings (T08)
Keep localStorage as the synchronous source (no flash on load) and mirror it into Dexie: after `initTheme()`,
read `settings.get('theme')`; if it differs, call `setPreference(value)` (exported from `src/theme`). To write
through, call `initTheme({ load: localStorageThemeStorage.load, save: p => { localStorageThemeStorage.save(p); void settings.set('theme', p); } })`
from `main.tsx`.

## How to add a theme from a style proposal (`design/proposals/*.html`)
1. Create `src/theme/themes/<name>.css`.
2. From the proposal's `<style>`: the `:root{…}` block (fonts, radii, spacing, **light** colours) goes under
   `:root[data-theme='<name>']`; the `@media (prefers-color-scheme:dark)` colours go in
   `@media (prefers-color-scheme: dark) { :root[data-theme='<name>']:not([data-mode='light']) {…} }` **and** under
   `:root[data-theme='<name>'][data-mode='dark']`. See `themes/warm.css` for the exact shape.
3. Add `@import './themes/<name>.css';` to `tokens.css` (the default dark palette only applies to the default
   theme, so no `:not()` is needed).
4. Register it in `THEMES` (`themes.ts`) and add a `theme.<name>` string to `src/i18n/en.ts`.
5. Self-host the fonts: `npm i @fontsource/<font>` and import only the `latin` + `latin-ext` weight files in `fonts.css`.
6. Decorations go in `themes/<name>.decor.css` (see below), imported in `tokens.css` after the theme.
7. Update the theme-list assertion in `useTheme.test.tsx`.

## Decorations (textures, frames, ornaments)
Themes decorate the app without touching CSS modules, through three layers:

1. **Decor tokens** (defaults in `tokens.css`, all `none`): `--texture-bg` (body + cooking mode),
   `--texture-surface` (cards, panels, menu, recipe page), `--gradient-primary` (primary buttons), `--gold`
   (metallic gradient), `--gold-line`, `--header-bg`. Set them in the theme's token block (light and dark).
2. **`[data-ui]` hooks** – stable attributes on key elements, styled from `<name>.decor.css` under
   `:root[data-theme='<name>']`: `app-header`, `app-title`, `sheet` (recipe page), `sheet-title`, `sheet-meta`,
   `sheet-actions`, `section-heading`, `prose` (recipe notes), `photo` (wrapper `<div>` around each recipe photo
   on the detail page – lets a theme add `::before`/`::after`, e.g. tape, which an `<img>` can't have),
   `cooking`, `cooking-step`, `cooking-counter`.
   Add a new hook where a theme needs one; never target hashed module class names.
3. **Ornaments** (`Ornaments.tsx`): `<PageCorners />`, `<Crest />` and `<Sprig />` (botanical sprig, drawn in
   `currentColor` with `--color-accent` berries) render `[data-ornament]` SVGs that are hidden
   by `global.css`; a decor file shows/positions them. Symbols live in `<OrnamentDefs />` (mounted in `App`), so add
   new ornaments there as `<symbol id="orn-…">`.

Theme-local custom properties (not part of the contract) are fine inside a theme's token block, prefixed with
the theme id (`--notes-line`, `--notes-margin`) or clearly scoped (`--header-text` in zielnik).

`ksiazka.decor.css` is the reference example; `notes.decor.css` (ruled paper, spiral, highlighter, taped photo,
chalkboard dark mode) and `zielnik.decor.css` (sprig, ruled italic headings, arched photo) are two more. Experiment first in `design/style-lab.html` (no build needed).
