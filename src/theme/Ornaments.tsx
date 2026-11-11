/**
 * Decorative SVG ornaments for themes. They are always in the DOM but hidden (global.css: [data-ornament]);
 * a theme's *.decor.css shows and positions the ones it wants. Purely decorative: aria-hidden.
 * <OrnamentDefs /> holds the shared symbols and is mounted once at the app root.
 */

/** Shared SVG symbols (gold gradient, corner fleuron, crest). Not display:none – that would break the gradient. */
export function OrnamentDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="orn-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8a6a22" />
          <stop offset=".45" stopColor="#f0d688" />
          <stop offset=".65" stopColor="#b08d3c" />
          <stop offset="1" stopColor="#e9cf7a" />
        </linearGradient>
      </defs>
      <symbol id="orn-fleuron" viewBox="0 0 56 56">
        <g fill="none" stroke="url(#orn-gold)" strokeWidth="2" strokeLinecap="round">
          <path d="M6 50 V14 Q6 6 14 6 H50" />
          <path d="M12 44 V20 Q12 12 20 12 H44" strokeWidth="1" />
          <path d="M14 6 C 22 14, 30 6, 26 2" />
          <path d="M6 14 C 14 22, 6 30, 2 26" />
          <path d="M20 20 C 28 18, 30 26, 24 28 C 20 29, 19 24, 23 23" />
        </g>
        <circle cx="6" cy="6" r="3.5" fill="url(#orn-gold)" />
      </symbol>
      <symbol id="orn-crest" viewBox="0 0 100 100">
        <g fill="none" stroke="url(#orn-gold)" strokeWidth="2.2" strokeLinecap="round">
          <path d="M50 92 C 22 86, 10 62, 16 34" />
          <path d="M50 92 C 78 86, 90 62, 84 34" />
          <g fill="url(#orn-gold)" stroke="none">
            <ellipse cx="17" cy="44" rx="3.5" ry="7" transform="rotate(-20 17 44)" />
            <ellipse cx="20" cy="58" rx="3.5" ry="7" transform="rotate(-40 20 58)" />
            <ellipse cx="28" cy="71" rx="3.5" ry="7" transform="rotate(-60 28 71)" />
            <ellipse cx="39" cy="82" rx="3.5" ry="7" transform="rotate(-75 39 82)" />
            <ellipse cx="83" cy="44" rx="3.5" ry="7" transform="rotate(20 83 44)" />
            <ellipse cx="80" cy="58" rx="3.5" ry="7" transform="rotate(40 80 58)" />
            <ellipse cx="72" cy="71" rx="3.5" ry="7" transform="rotate(60 72 71)" />
            <ellipse cx="61" cy="82" rx="3.5" ry="7" transform="rotate(75 61 82)" />
          </g>
          <path d="M32 22 H68 V48 C68 62, 58 70, 50 74 C42 70, 32 62, 32 48 Z" strokeWidth="2.5" />
          <path d="M36 26 H64 V48 C64 59, 56 66, 50 69 C44 66, 36 59, 36 48 Z" strokeWidth="1" />
          <path d="M41 60 L59 32" />
          <ellipse cx="60.5" cy="29.5" rx="3" ry="4.5" transform="rotate(33 60.5 29.5)" />
          <path d="M59 60 L44 37" />
          <path d="M44 37 C 38 30, 40 25, 43 26 C 46 27, 47 33, 44 37 M44 37 C 40 32, 42 29, 43 29" />
          <path d="M40 16 L44 10 L50 15 L56 10 L60 16" />
        </g>
      </symbol>
      <symbol id="orn-sprig" viewBox="0 0 170 200">
        <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M160 10 C 120 50, 95 110, 70 190" />
          <path
            d="M140 38 C 120 30, 105 36, 98 48 C 112 54, 130 50, 140 38 Z"
            fill="currentColor"
            fillOpacity=".12"
          />
          <path
            d="M128 60 C 140 74, 150 80, 164 78 C 160 64, 146 56, 128 60 Z"
            fill="currentColor"
            fillOpacity=".12"
          />
          <path
            d="M112 90 C 92 82, 78 90, 72 102 C 88 108, 104 104, 112 90 Z"
            fill="currentColor"
            fillOpacity=".12"
          />
          <path
            d="M102 116 C 114 132, 126 138, 140 136 C 136 122, 120 112, 102 116 Z"
            fill="currentColor"
            fillOpacity=".12"
          />
          <path
            d="M88 148 C 70 142, 56 150, 52 162 C 66 166, 82 162, 88 148 Z"
            fill="currentColor"
            fillOpacity=".12"
          />
          <path
            d="M140 38 L 98 48 M128 60 L164 78 M112 90 L72 102 M102 116 L140 136 M88 148 L52 162"
            strokeWidth=".8"
          />
        </g>
        <g fill="var(--color-accent)">
          <circle cx="160" cy="10" r="4" />
          <circle cx="152" cy="6" r="3" />
          <circle cx="166" cy="18" r="3" />
        </g>
      </symbol>
    </svg>
  );
}

const CORNERS = ['corner-tl', 'corner-tr', 'corner-bl', 'corner-br'] as const;

/** Four corner fleurons; place inside a positioned [data-ui='sheet']. */
export function PageCorners() {
  return (
    <>
      {CORNERS.map((c) => (
        <svg key={c} data-ornament={c} viewBox="0 0 56 56" aria-hidden="true" focusable="false">
          <use href="#orn-fleuron" />
        </svg>
      ))}
    </>
  );
}

/** Crest above a page title. */
export function Crest() {
  return (
    <svg data-ornament="crest" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <use href="#orn-crest" />
    </svg>
  );
}

/** Botanical sprig (stroke = currentColor, berries = --color-accent); place inside a positioned [data-ui='sheet']. */
export function Sprig() {
  return (
    <svg data-ornament="sprig" viewBox="0 0 170 200" aria-hidden="true" focusable="false">
      <use href="#orn-sprig" />
    </svg>
  );
}
