// Colour for the atlas, resolved once per draw from CSS custom properties.
//
// The renderers never read the DOM: they are handed a palette object and ask it
// for colours. That keeps them testable and means the whole app's theming — two
// axes, `data-scheme` × `data-theme` — reaches the city for free.
//
// TWO LOOKS, ONE ENGINE. The `warm` scheme paints the drafting-paper map: hatched
// faces, ink outlines, no fills to speak of. Every other scheme paints the lit
// city: tinted solids, no hatching. That is a palette decision, not a second
// renderer, which is exactly why the reference images that look like different
// products are one code path here.

import { cssColor, darken, luminance, mix } from './colors.js';

/**
 * Build the palette for the current theme.
 *
 * @param types  the card types present, so per-type tokens resolve once
 * @param opts.drafting  draw as ink-on-ground with hatched faces (the Flat
 *   engine) rather than as solids (the Lit engine)
 *
 * `drafting` follows the ENGINE, not the scheme. It used to key off `warm`,
 * which meant the two engine buttons produced nearly identical pictures in every
 * other scheme — the switch looked broken because the only difference left was
 * shading subtlety. Tying it to the button is what makes the choice mean
 * something wherever you are.
 */
export function atlasPalette(types = []) {
	// Kept as a flag rather than a branch: the flat map wants map-ish flat fills,
	// which is what `false` selects below.
	const paper = false;

	const page = cssColor('--color-page', '#111');
	const ink = cssColor('--color-ink', '#eee');
	const muted = cssColor('--color-muted', '#888');
	const border = cssColor('--color-border', '#444');
	const brand = cssColor('--color-brand', '#cc785c');
	const light = luminance(page) > 0.5;

	const typeColor = {};
	for (const type of types) typeColor[type] = cssColor(`--t-${type}`, brand);

	const tokenCache = new Map();
	const token = (name) => {
		if (!name) return null;
		if (!tokenCache.has(name)) tokenCache.set(name, cssColor(name, brand));
		return tokenCache.get(name);
	};

	/**
	 * Face shading. One base colour, three faces: the top catches the light, the
	 * two sides fall away. On paper the fills nearly vanish and the hatch carries
	 * the form instead.
	 */
	const faces = (base) =>
		paper
			? {
					top: mix(base, page, 0.86),
					left: mix(base, page, 0.78),
					right: mix(base, page, 0.82),
				}
			: light
				? {
						top: mix(base, '#ffffff', 0.55),
						left: mix(base, '#ffffff', 0.2),
						right: mix(base, '#ffffff', 0.36),
					}
				: {
						top: mix(base, '#ffffff', 0.24),
						left: darken(base, 0.52),
						right: darken(base, 0.3),
					};

	return {
		paper,
		light,
		hatch: paper,
		hatchColor: mix(ink, page, 0.45),

		grid: mix(border, page, paper ? 0.45 : 0.6),
		edge: mix(muted, page, 0.3),
		scaffold: cssColor('--color-danger', '#e0635d'),
		routeDot: paper ? ink : cssColor('--t-FLOW', brand),
		routeCasing: page,

		districtFont: '700 11px ui-monospace, SFMono-Regular, Menlo, monospace',
		buildingFont: '600 10px ui-monospace, SFMono-Regular, Menlo, monospace',
		// Literal stacks: a canvas font shorthand is not CSS and does not resolve
		// var(), so a `var(--font-sans)` here would silently fall back to serif.
		summaryFont: "400 11px 'Inter Variable', Inter, system-ui, sans-serif",

		/**
		 * A building's three faces plus its outline. `tone` from the lens wins over
		 * the type colour, so the drift lens can paint a card red without the
		 * renderer knowing what drift is.
		 */
		building(building, state = {}) {
			const base = token(building.tone) ?? typeColor[building.type] ?? brand;
			const shaded = faces(base);
			const outline = paper
				? mix(ink, page, 0.25)
				: state.hovered || state.selected
					? brand
					: null;
			return {
				...shaded,
				outline: state.selected ? brand : outline,
				floorLine: paper ? mix(ink, page, 0.5) : mix(base, page, 0.55),
			};
		},

		/** District plate: a feature reads as a place, a type group as a holding pen. */
		district(district) {
			const base = district.kind === 'feature' ? brand : muted;
			return {
				fill: mix(base, page, paper ? 0.94 : 0.9),
				line: mix(base, page, paper ? 0.55 : 0.6),
			};
		},

		districtLabel(district) {
			return district.kind === 'feature' ? mix(ink, page, 0.15) : muted;
		},

		districtSummary() {
			return mix(muted, page, 0.25);
		},

		// FLOW's own type colour, so a road is recognisably the same thing as the
		// FLOW card it came from wherever you meet it in the app.
		route(route, active) {
			const base = cssColor('--t-FLOW', brand);
			return active ? base : mix(base, page, 0.45);
		},

		// ── Street map ──────────────────────────────────────────────────────────
		// A street is two strokes: a darker casing and a lighter surface. That pair
		// is what makes a line read as a road rather than as a connector.
		streetCasing: mix(page, ink, light ? 0.22 : 0.14),
		streetArrow: mix(page, ink, light ? 0.55 : 0.5),

		street(route, active) {
			const base = cssColor('--t-FLOW', brand);
			return active ? mix(base, page, 0.25) : mix(base, page, 0.6);
		},

		/** Label on a building square. Dark on light fills, light on dark ones. */
		buildingLabel(building) {
			const base = token(building.tone) ?? typeColor[building.type] ?? brand;
			const fill = faces(base).top;
			return luminance(fill) > 0.5 ? mix(ink, fill, 0.15) : mix('#ffffff', fill, 0.2);
		},
	};
}
