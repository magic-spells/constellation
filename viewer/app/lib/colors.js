/**
 * Shared hex-color math. Extracted verbatim from the old Svelte
 * `ConstellationView.svelte` so the canvas graph and the mermaid tinting in
 * `markdown.js` agree on how colors are parsed, blended and measured.
 */

/** Parse `#rgb` / `#rrggbb` into `[r, g, b]`; null if unparseable. */
export function parseHex(color) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const hex =
    m[1].length === 3
      ? m[1]
          .split('')
          .map((c) => c + c)
          .join('')
      : m[1];
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** Clamp + round an `[r, g, b]` triple back into `#rrggbb`. */
export const toHex = (rgb) =>
  `#${rgb
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** Scale a color toward black by `factor` (0 = black, 1 = unchanged). */
export function darken(color, factor = 0.28, fallback = '#111') {
  const p = parseHex(color);
  return p ? toHex(p.map((v) => v * factor)) : fallback;
}

/** Blend two hex colours; `t` is the weight of `b` (0 = a, 1 = b). */
export function mix(a, b, t, fallback = '#888') {
  const pa = parseHex(a);
  const pb = parseHex(b);
  return pa && pb ? toHex(pa.map((v, i) => v + (pb[i] - v) * t)) : fallback;
}

/** Perceived luminance 0–1, used to decide light vs dark theme. */
export function luminance(color) {
  const p = parseHex(color);
  return p ? (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255 : 0;
}

/** Pull a resolved CSS custom property off `:root`. */
export function cssVar(name, fallback = '') {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
