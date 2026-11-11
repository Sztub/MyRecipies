# Style proposals

Three standalone HTML files (no build, no JS libraries; only Google Fonts). Open directly in a browser.
Each shows: recipe list, recipe detail (Polish units), edit form (with an error field), settings, toasts.
Light/dark follows the system; the **Light/Dark** button in the header overrides it.
All use the theme token names from `src/theme/tokens.css` and ≥ 44 px touch targets; base text is 18–20 px.

| | 1 – Warm kitchen | 2 – Clean modern | 3 – Recipe card |
|---|---|---|---|
| Mood | Cosy, cream + terracotta | Neutral, minimal, one green | Paper index card, ruled lines |
| Headings | Lora (serif) | Inter bold | Caveat (handwritten) |
| Body | Source Sans 3, 20 px | Inter, 20 px | Merriweather (serif), 18 px |
| Primary | `#b4512f` terracotta | `#1f7a4d` green | `#2f5d8a` blue ink |
| Shape | Rounded (16 px cards) | Tight (12 px), flat, no shadows | Square-ish, hard offset shadows |
| Tags | Gold pills | Outlined neutral | Rotated stamp-style outlines |
| Pros | Friendly, very readable | Cleanest, most "app-like" | Most personal, fits a family cookbook |
| Cons | Slightly generic | Least character | Handwriting font is less legible for long text, so only used for headings; ruled-line background is busier |

## Porting to `src/theme/themes/`
1. In the proposal's `<style>`, the `:root{…}` block holds shared tokens (fonts, radii, spacing) plus the **light** colours; the `@media (prefers-color-scheme:dark)` block holds the **dark** colours.
2. Create `src/theme/themes/<name>.css`: put shared + light tokens under `[data-theme="<name>"]`, and the dark values under `[data-theme="<name>"][data-mode="dark"]` (and a `prefers-color-scheme` media query if no explicit mode is set).
3. Move the Google Fonts `<link>` into `index.html` (or self-host the fonts for offline PWA use).
4. Per-theme extras at the bottom of each file (the `extra` rules: paper lines, rotated tags, flat header) are component styling, not tokens. Port them only if wanted, as theme-scoped rules in the CSS modules.
5. Fonts load from Google, so offline the fallbacks (Georgia / system-ui) apply; the app itself self-hosts its fonts.
