/**
 * The viewer's icon set — Lucide-style 24×24 stroke paths, inlined.
 *
 * Why paths and not a package: the viewer ships as static assets with no CDN
 * reachable, and an icon font/sprite for a dozen glyphs is more machinery than
 * the whole dashboard. Each icon is an array of `{ k, d }` (a key and a path
 * `d`) so <Icon> can render multi-path glyphs from one `{#for}`.
 *
 * They are stroke icons on `currentColor`: colour comes from the surrounding
 * text colour, so the same glyph reads correctly in every tone and both themes.
 * Keep them geometrically simple — most render at 14–16px.
 */

const p = (...ds) => ds.map((d, k) => ({ k, d }));

export const ICONS = {
	/* state */
	check: p('M20 6 9 17l-5-5'),
	'check-circle': p('M21.801 10A10 10 0 1 1 17 3.335', 'm9 11 3 3L22 4'),
	alert: p(
		'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
		'M12 9v4',
		'M12 17h.01',
	),
	circle: p('M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'),
	pencil: p(
		'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497Z',
		'm15 5 4 4',
	),
	shield: p(
		'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z',
		'm9 12 2 2 4-4',
	),

	/* counts */
	layers: p(
		'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z',
		'm6.08 9.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59',
		'm6.08 14.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59',
	),
	link: p(
		'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
		'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
	),

	/* activity */
	commit: p('M12 3v6', 'M12 15v6', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'),
	file: p(
		'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z',
		'M14 2v4a2 2 0 0 0 2 2h4',
		'M16 13H8',
		'M16 17H8',
	),
	history: p('M3 3v5h5', 'M3.05 13A9 9 0 1 0 6 5.3L3 8', 'M12 7v5l3 2'),
	note: p(
		'M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2Z',
		'M15 21v-4a2 2 0 0 1 2-2h4',
	),

	/* releases + change kinds */
	tag: p(
		'M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42Z',
		'M8 8h.01',
	),
	sparkle: p(
		'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594Z',
	),
	wrench: p(
		'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z',
	),
	box: p(
		'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z',
		'm3.3 7 8.7 5 8.7-5',
		'M12 22V12',
	),

	/* drift */
	pulse: p(
		'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2',
	),
	target: p(
		'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
		'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
		'M12.5 12h-1',
	),
};

/** Icon + tone per sync state — the health strip's glyph and colour in one. */
export const STATE_ICON = {
	'in-sync': { icon: 'check-circle', tone: 'good' },
	drifted: { icon: 'alert', tone: 'warn' },
	dirty: { icon: 'pencil', tone: 'brand' },
	'never-synced': { icon: 'circle', tone: 'muted' },
	'no-git': { icon: '', tone: '' },
};

/** Icon per FEATURE `change:` group, in the release rollup. */
export const CHANGE_ICON = {
	breaking: 'alert',
	feature: 'sparkle',
	fix: 'wrench',
	chore: 'box',
};

/** Look an icon up by name, tolerating an unknown one (renders nothing). */
export function iconPaths(name) {
	return ICONS[name] ?? [];
}
