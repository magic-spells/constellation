// Atlas lenses — the two independent channels a city has for saying something
// about a card: how TALL a building is, and what COLOUR it is.
//
// Keeping them separate is the point. Colour stays type-coded in most lenses so
// you never lose track of what a thing is, while height carries the question you
// asked. The exception is `status`, the default, where colour is the answer and
// height is flat — arriving on a map that is all one height reads as "here is
// the shape of the plan" rather than "here is a chart".
//
// Pure: no DOM, no colour resolution (the renderer owns CSS custom properties).
// Everything here answers in numbers and token NAMES.

/**
 * Cells of height for a lens that isn't measuring height.
 *
 * A footprint is ~0.62 cells, so this is very close to a cube — a flat city
 * reads as a city rather than a bar chart, which is the point of `status` being
 * the default. Matches atlas-scene's clamp so a lens can't produce a spike.
 */
const FLAT = 0.8;

export const LENSES = [
	{
		id: 'status',
		label: 'Status',
		hint: 'Colour by status: — where each card is in its life.',
	},
	{
		id: 'degree',
		label: 'Connections',
		hint: 'Height by how many cards connect. Hubs are towers.',
	},
	{
		id: 'drift',
		label: 'Drift',
		hint: 'Bound code that moved since the card was verified. Scaffolded = drifted.',
	},
	{
		id: 'recency',
		label: 'Recency',
		hint: 'Height by how recently the card changed. Tall = fresh.',
	},
	{
		id: 'size',
		label: 'Code size',
		hint: 'Height by lines of bound code. Needs FILE bindings.',
	},
];

const LENS_IDS = new Set(LENSES.map((l) => l.id));

/** A known lens id, or the default. Guards a stale URL or a typo in atlas.json. */
export function normalizeLens(value) {
	return LENS_IDS.has(value) ? value : 'status';
}

/**
 * Status → colour token. Deliberately the SAME vocabulary the status chips use
 * (see status.js): planned is muted, building warns, built is brand, verified is
 * success. A card must not change colour just because you are looking at it on a
 * map instead of in a list.
 */
const STATUS_TOKEN = {
	verified: '--color-success',
	built: '--color-brand',
	building: '--color-warning',
	planned: '--color-muted',
};

/**
 * Compress an unbounded count into 0..1 without letting one outlier flatten
 * everything else. Log scale: the difference between 1 and 5 connections matters
 * far more than between 60 and 64, and a linear scale renders the former as no
 * difference at all.
 */
export function normalizeLog(value, max) {
	if (!(value > 0) || !(max > 0)) return 0;
	return Math.log1p(value) / Math.log1p(max);
}

/**
 * 0..1 → cells, across the range a building may occupy.
 *
 * Deliberately squat: the tallest building is only ~3.5x its own footprint.
 * A wider range turns every measuring lens into a field of needles, where the
 * silhouettes that tell you what a card IS stop being readable — and the shape
 * vocabulary is the thing that makes this a map instead of a chart.
 */
export function heightFromUnit(unit) {
	return 0.45 + unit * 1.75;
}

/**
 * Build the per-card height function the scene builder takes, plus the colour
 * resolver the renderer takes.
 *
 * @param {string} lens
 * @param {object} ctx
 *   degree   Map<handle, number>
 *   stale    Map<handle, {changed_files: string[]}>  per-card drift, from /api/sync
 *   metrics  Map<handle, {lines: number}>            bound code size, from /api/atlas-metrics
 *   now      number — the clock, injected so tests are not time-dependent
 */
export function lensModel(lens, ctx = {}) {
	const id = normalizeLens(lens);
	const degree = ctx.degree ?? new Map();
	const stale = ctx.stale ?? new Map();
	const metrics = ctx.metrics ?? new Map();
	const now = ctx.now ?? Date.now();

	const maxDegree = Math.max(0, ...degree.values());
	const maxLines = Math.max(0, ...[...metrics.values()].map((m) => m?.lines ?? 0));
	// A month is the window where "recent" still means something on a plan.
	const RECENCY_WINDOW = 30 * 24 * 60 * 60 * 1000;

	const height = (card) => {
		switch (id) {
			case 'degree':
				return heightFromUnit(normalizeLog(degree.get(card.handle) ?? 0, maxDegree));
			case 'size':
				return heightFromUnit(normalizeLog(metrics.get(card.handle)?.lines ?? 0, maxLines));
			case 'recency': {
				const age = now - (card.mtime ?? 0);
				return heightFromUnit(Math.max(0, 1 - age / RECENCY_WINDOW));
			}
			case 'drift':
				// Drifted buildings stand taller so the eye finds them first; the
				// renderer also draws them scaffolded, which is the actual signal.
				return stale.has(card.handle) ? heightFromUnit(0.8) : FLAT;
			default:
				return FLAT;
		}
	};

	const tone = (card) => {
		switch (id) {
			case 'drift':
				return stale.has(card.handle) ? '--color-danger' : null;
			case 'status':
				return STATUS_TOKEN[card.status] ?? null;
			default:
				return null;
		}
	};

	/** True when the renderer should draw this building as scaffolded/unsound. */
	const scaffolded = (card) => id === 'drift' && stale.has(card.handle);

	return { id, height, tone, scaffolded };
}
