// The atlas scene graph: the plan's cards turned into a city, in world units.
//
// This module is the whole layout. It is pure — no DOM, no canvas, no WebGL, no
// Puzzle — so both renderers (atlas-iso.js, atlas-three.js) consume the SAME
// scene and cannot drift into showing two different cities. It is also why the
// layout is unit-testable in plain Node.
//
// WORLD SPACE. +x is east, +y is south, +z is up. One CELL is the module's unit
// of ground; a building occupies a footprint measured in cells and rises in the
// same units, so a renderer only needs a projection, never a scale negotiation.
//
// DETERMINISM IS A HARD REQUIREMENT, not a nicety. The entire value of a map is
// that the DB is where the DB was last time; a city that reshuffles between
// reloads is worse than no city. So: no Math.random, no force simulation, no
// modularity clustering, no iteration over unsorted object keys. Every ordering
// in here breaks ties on the handle, which is unique. Same plan in, byte-identical
// scene out — asserted by tests/atlas-scene.test.ts.
//
// NOTHING DERIVED IS STORED. This runs on load and its output is cached in the
// browser against the plan generation. It is never written back into a card.

import { shapeForType, TYPE_META } from './types.js';

/**
 * One ground cell, in world units.
 *
 * Sized so a building's footprint (~0.6 cells ≈ 50 units) is the same order as a
 * graph node's box. That is what lets both canvas views share ONE camera with one
 * set of zoom limits: pick a smaller cell and a comfortably-framed city needs a
 * scale the shared camera would clamp away.
 */
export const CELL = 80;

/** Gap between a district's edge and its buildings. */
const DISTRICT_PAD = CELL * 0.5;

/** Gap between districts — the gutter roads route through. */
const DISTRICT_GAP = CELL * 1.5;

/**
 * Height range, in cells. Even a "flat" card needs enough body to read as a
 * solid, and the ceiling is low on purpose: a footprint is ~0.62 cells, so 3
 * cells is already a tower. Taller than this and buildings become needles whose
 * silhouettes — the whole shape vocabulary — stop being legible.
 */
const MIN_HEIGHT = 0.35;
const MAX_HEIGHT = 3;

/**
 * Cards that are never buildings. A RELEASE is a milestone, not a place, and
 * PLAN-PROJECT is the city itself — drawing them would put a building in the
 * middle of the map that means "the map".
 */
const NOT_BUILDINGS = new Set(['RELEASE', 'PLAN']);

/**
 * Stable 32-bit string hash (FNV-1a). Used only for deterministic *tie-breaking*
 * and lane offsets — never for placement, so a handle rename shifts one road and
 * not the city.
 */
export function hash(text) {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0;
}

const byHandle = (a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0);

/**
 * Ordered `[[HANDLE]]` stops of a FLOW card's steps.
 *
 * Deliberately NOT markdown.js's `extractFlowSteps`: that one lexes with `marked`
 * to produce HTML for the card page, and pulling `marked` in here would cost this
 * module its purity and its Node-testability. This wants only the handles, in
 * order, from the first top-level ordered list — a different job with a much
 * smaller answer.
 *
 * Prose refs are aspirational (a `[[link]]` may point at a card nobody wrote
 * yet), so unknown handles are dropped by the caller, not here.
 */
export function flowStops(body) {
	const stops = [];
	const seen = new Set();
	for (const line of String(body ?? '').split('\n')) {
		// Top-level ordered item only: an indented one is a branch/edge case.
		if (!/^\d+[.)]\s/.test(line)) continue;
		for (const match of line.matchAll(/\[\[([A-Z][A-Z0-9-]*)\]\]/g)) {
			const handle = match[1];
			if (seen.has(handle)) continue;
			seen.add(handle);
			stops.push(handle);
		}
	}
	return stops;
}

/**
 * Repo paths a card binds to: its own `code_refs` plus every connected FILE
 * card's `path:`. Mirrors src/core/code.ts's boundPathsForCard, client-side —
 * the serve API ships the frontmatter this needs, so no round trip.
 */
export function boundPaths(card, neighbors, byHandleMap) {
	const paths = [];
	const push = (value, symbol) => {
		const path = String(value ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
		if (path) paths.push({ path, symbol: symbol ?? null });
	};

	if (card.type === 'FILE') push(card.frontmatter?.path);
	for (const ref of card.frontmatter?.code_refs ?? []) {
		const text = String(ref);
		const colon = text.lastIndexOf(':');
		// `path:symbol` — but a bare Windows-ish `C:/x` has no symbol, so only
		// split when the tail looks like an identifier rather than a path.
		if (colon > 0 && !text.slice(colon + 1).includes('/')) {
			push(text.slice(0, colon), text.slice(colon + 1));
		} else {
			push(text);
		}
	}
	for (const handle of neighbors.get(card.handle) ?? []) {
		const other = byHandleMap.get(handle);
		if (other?.type === 'FILE') push(other.frontmatter?.path);
	}

	const unique = new Map();
	for (const entry of paths) {
		const key = `${entry.path}:${entry.symbol ?? ''}`;
		if (!unique.has(key)) unique.set(key, entry);
	}
	return [...unique.values()];
}

/** `## Section` headings of a card body, in document order. */
export function bodySections(body) {
	const out = [];
	for (const line of String(body ?? '').split('\n')) {
		const match = /^##\s+(.+?)\s*$/.exec(line);
		if (match) out.push(match[1]);
	}
	return out;
}

/**
 * The floors inside a building — the thing that makes a card a place with parts
 * rather than a solid block. Priority order matters: bound code is the most
 * concrete statement of what a card IS, so it wins over prose structure.
 *
 *   file    — a connected FILE card's path, or this card's own
 *   symbol  — a `code_refs: [path:symbol]` entry, i.e. a function
 *   section — a `##` heading, when the card binds no code at all
 *
 * Capped: past a dozen floors a tower is a texture, not information.
 */
const MAX_FLOORS = 12;

export function buildingFloors(card, paths, sections) {
	const floors = [];
	for (const entry of paths) {
		floors.push({
			label: entry.symbol ?? entry.path.split('/').pop(),
			detail: entry.path,
			source: entry.symbol ? 'symbol' : 'file',
		});
	}
	// Sections only describe a card that binds no code; otherwise a card would
	// grow floors for its own prose headings and the tower would stop meaning code.
	if (floors.length === 0) {
		for (const name of sections) {
			floors.push({ label: name, detail: null, source: 'section' });
		}
	}
	return floors.slice(0, MAX_FLOORS);
}

/**
 * District assignment. A FEATURE's district is the cards it connects to.
 *
 * Districts are NOT a partition of the graph — a card can be connected to
 * several FEATUREs, or (usually) none — so this resolves both cases explicitly
 * rather than pretending the data is cleaner than it is:
 *
 *   - several  → the SMALLEST claiming feature wins. A card named by a focused
 *                three-card feature belongs to it more than to a sprawling one;
 *                handle order breaks a size tie so the answer is stable.
 *   - none     → a district per card type. Dull but honest, and it keeps the
 *                unclaimed half of a young plan legible instead of dumping it
 *                in one "misc" heap.
 */
export function assignDistricts(cards, neighbors) {
	const features = cards.filter((c) => c.type === 'FEATURE').sort(byHandle);
	const claims = new Map();

	for (const feature of features) {
		const members = [...(neighbors.get(feature.handle) ?? [])].sort();
		for (const handle of members) {
			if (!claims.has(handle)) claims.set(handle, []);
			claims.get(handle).push({ feature: feature.handle, size: members.length });
		}
	}

	const districts = new Map();
	const ensure = (id, label, summary, kind) => {
		if (!districts.has(id)) districts.set(id, { id, label, summary, kind, cards: [] });
		return districts.get(id);
	};

	for (const card of [...cards].sort(byHandle)) {
		if (NOT_BUILDINGS.has(card.type)) continue;
		// A FEATURE is the district header, not a building inside it.
		if (card.type === 'FEATURE') continue;

		const claimed = claims.get(card.handle) ?? [];
		if (claimed.length > 0) {
			const best = [...claimed].sort(
				(a, b) => a.size - b.size || (a.feature < b.feature ? -1 : 1),
			)[0];
			const feature = cards.find((c) => c.handle === best.feature);
			ensure(
				best.feature,
				feature?.name || best.feature,
				featureSummary(feature),
				'feature',
			).cards.push(card.handle);
			continue;
		}

		const label = TYPE_META[card.type]?.label ?? card.type;
		ensure(`type:${card.type}`, label, null, 'type').cards.push(card.handle);
	}

	return [...districts.values()];
}

/** First prose sentence of a FEATURE card — the district's one-line description. */
function featureSummary(card) {
	if (!card) return null;
	for (const line of String(card.body ?? '').split('\n')) {
		const text = line.trim();
		if (!text || text.startsWith('#') || text.startsWith('>') || text.startsWith('|')) continue;
		const sentence = /^(.+?[.!?])(\s|$)/.exec(text);
		const summary = (sentence ? sentence[1] : text).replace(/\[\[|\]\]/g, '');
		return summary.length > 140 ? `${summary.slice(0, 137)}…` : summary;
	}
	return null;
}

/** Grid dimensions that hold `n` items in the squarest rectangle. */
export function gridFor(n) {
	if (n <= 0) return { cols: 1, rows: 1 };
	const cols = Math.ceil(Math.sqrt(n));
	return { cols, rows: Math.ceil(n / cols) };
}

/**
 * Shelf-pack districts left to right, wrapping at a target width, tallest-first
 * within a row so rows stay flush. Deterministic: input order is preserved for
 * equal sizes, and the caller has already sorted.
 */
export function packDistricts(districts, targetWidth) {
	let x = 0;
	let y = 0;
	let rowHeight = 0;

	for (const district of districts) {
		if (x > 0 && x + district.w > targetWidth) {
			x = 0;
			y += rowHeight + DISTRICT_GAP;
			rowHeight = 0;
		}
		district.x = x;
		district.y = y;
		x += district.w + DISTRICT_GAP;
		rowHeight = Math.max(rowHeight, district.h);
	}
	return districts;
}

/**
 * Orthogonal ground route between two points, as the reference maps draw them:
 * out of the source, along a shared lane, into the target. Never diagonal.
 *
 * The lane is offset by a hash of the pair so parallel routes between the same
 * two districts do not stack into one thick line — deterministic, so a route
 * stays put across reloads.
 */
export function routeBetween(from, to, key, gutterY = null) {
	const lane = ((hash(key) % 5) - 2) * (CELL * 0.12);

	if (Math.abs(from.x - to.x) < 0.001) return [from, to];
	if (Math.abs(from.y - to.y) < 0.001) return [from, to];

	// Travel along a GUTTER when the caller knows one — the gap between district
	// plates. Without it a road runs straight under the buildings between its two
	// ends and is invisible, which is how this first read on screen.
	const midY = (gutterY ?? (from.y + to.y) / 2) + lane;

	return [
		from,
		{ x: from.x, y: midY },
		{ x: to.x, y: midY },
		to,
	];
}

/**
 * The gutter lane a road should take between two districts: just outside the
 * source plate, on the side facing the target. Same district → between the two
 * points, which is the old behaviour and correct for a short hop.
 */
export function gutterBetween(fromDistrict, toDistrict, from, to) {
	if (!fromDistrict || !toDistrict) return null;
	if (fromDistrict === toDistrict) return null;
	const downward = to.y > from.y;
	return downward
		? fromDistrict.y + fromDistrict.h + DISTRICT_GAP / 2
		: fromDistrict.y - DISTRICT_GAP / 2;
}

/**
 * Build the scene.
 *
 * @param {object} input
 *   cards        array of {handle, type, name, status, mtime, frontmatter, body}
 *   connections  flat [{a, b}] edge list
 *   neighbors    Map<handle, Set<handle>|handle[]>
 *   height       (card, ctx) => number in cells; defaults to a flat city
 *   hide         Set<handle> to leave out
 *   pin          Map<handle, [col, row]> authored placement
 *   shape        Map<handle, string> authored silhouette override
 */
export function buildScene(input) {
	const {
		cards = [],
		connections = [],
		neighbors = new Map(),
		height = null,
		hide = new Set(),
		pin = new Map(),
		shape = new Map(),
		districtOrder = [],
	} = input;

	const visible = cards.filter((c) => !hide.has(c.handle));
	const byHandleMap = new Map(visible.map((c) => [c.handle, c]));

	// ── Districts ────────────────────────────────────────────────────────────
	const districts = assignDistricts(visible, neighbors);
	// Authored order first (atlas.json `districts`), then biggest, so the eye
	// lands on the substantial parts of the system. Feature districts outrank
	// type districts at equal size because a named feature is a stronger
	// statement than "these share a prefix".
	const authored = new Map(districtOrder.map((id, i) => [id, i]));
	const rank = (d) => authored.get(d.id) ?? Number.MAX_SAFE_INTEGER;
	districts.sort(
		(a, b) =>
			rank(a) - rank(b) ||
			b.cards.length - a.cards.length ||
			(a.kind === b.kind ? 0 : a.kind === 'feature' ? -1 : 1) ||
			(a.id < b.id ? -1 : 1),
	);

	for (const district of districts) {
		const { cols, rows } = gridFor(district.cards.length);
		district.cols = cols;
		district.rows = rows;
		// `pad` is published so a caller dropping a dragged building can convert
		// a world point back to the cell it landed on without re-deriving it.
		district.pad = DISTRICT_PAD;
		district.w = cols * CELL + DISTRICT_PAD * 2;
		district.h = rows * CELL + DISTRICT_PAD * 2;
	}

	const totalArea = districts.reduce((sum, d) => sum + d.w * d.h, 0);
	// Aim for a landscape block: the viewport is wider than it is tall, and an
	// isometric projection widens whatever it is given.
	packDistricts(districts, Math.max(CELL * 4, Math.sqrt(totalArea) * 1.6));

	// ── Buildings ────────────────────────────────────────────────────────────
	const buildings = [];
	const position = new Map();
	// Which plate a card stands on — used only to pick a road's gutter lane, so
	// it stays out of the scene the renderers see.
	const homeDistrict = new Map();

	for (const district of districts) {
		const members = district.cards
			.map((handle) => byHandleMap.get(handle))
			.filter(Boolean);

		const heightFor = (card) =>
			clampHeight(height ? height(card) : 1.4);

		// Ordered by HANDLE, never by height. Sorting by height would move every
		// building whenever the lens changed — the city rearranging under you is
		// exactly the spatial-memory failure this module exists to prevent, and it
		// also makes a lens change a full re-layout instead of a recolour.
		const ordered = [...members].sort(byHandle);

		ordered.forEach((card, index) => {
			const pinned = pin.get(card.handle);
			const col = pinned ? pinned[0] : index % district.cols;
			const row = pinned ? pinned[1] : Math.floor(index / district.cols);

			const x = district.x + DISTRICT_PAD + col * CELL + CELL / 2;
			const y = district.y + DISTRICT_PAD + row * CELL + CELL / 2;

			const silhouette = shape.get(card.handle) ?? shapeForType(card.type);
			const paths = boundPaths(card, neighbors, byHandleMap);
			const floors = buildingFloors(card, paths, bodySections(card.body));

			const building = {
				handle: card.handle,
				type: card.type,
				name: card.name || card.handle,
				status: card.status ?? null,
				district: district.id,
				shape: silhouette,
				x,
				y,
				footprint: footprintFor(silhouette),
				height: heightFor(card),
				floors,
				paths: paths.map((p) => p.path),
				pinned: Boolean(pinned),
			};
			buildings.push(building);
			position.set(card.handle, { x, y });
			homeDistrict.set(card.handle, district);
		});
	}

	// ── Roads: FLOW cards become named routes through the city ───────────────
	const routes = [];
	for (const card of visible.filter((c) => c.type === 'FLOW').sort(byHandle)) {
		const stops = flowStops(card.body).filter((handle) => position.has(handle));
		if (stops.length < 2) continue;

		const points = [];
		for (let i = 0; i < stops.length - 1; i++) {
			const from = position.get(stops[i]);
			const to = position.get(stops[i + 1]);
			const leg = routeBetween(
				from,
				to,
				`${card.handle}:${i}`,
				gutterBetween(
					homeDistrict.get(stops[i]),
					homeDistrict.get(stops[i + 1]),
					from,
					to,
				),
			);
			// Drop the duplicated joint between consecutive legs.
			points.push(...(i === 0 ? leg : leg.slice(1)));
		}

		routes.push({
			id: card.handle,
			label: card.name || card.handle,
			flow: card.handle,
			stops,
			points,
		});
	}

	// ── Edges: every structural connection, routed but not necessarily drawn ──
	// The graph view learned that painting 150+ edges at once is a hairball, so
	// the renderer decides when these appear (hover, focus). Routing them here
	// keeps that decision cheap.
	const edges = [];
	for (const { a, b } of connections) {
		if (!position.has(a) || !position.has(b)) continue;
		edges.push({
			a,
			b,
			points: routeBetween(
				position.get(a),
				position.get(b),
				`${a}|${b}`,
				gutterBetween(
					homeDistrict.get(a),
					homeDistrict.get(b),
					position.get(a),
					position.get(b),
				),
			),
		});
	}

	return {
		cell: CELL,
		bounds: boundsOf(districts),
		districts,
		buildings,
		routes,
		edges,
	};
}

function clampHeight(value) {
	if (!Number.isFinite(value)) return MIN_HEIGHT;
	return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, value));
}

/**
 * Ground footprint per silhouette, in cells. A monument is wide and low; a
 * plate is the ground itself; a beacon is a thin mast.
 */
function footprintFor(silhouette) {
	switch (silhouette) {
		case 'monument':
			return { w: 0.82, d: 0.82 };
		case 'plate':
			return { w: 0.86, d: 0.86 };
		case 'beacon':
		case 'figure':
			return { w: 0.3, d: 0.3 };
		case 'cylinder':
			return { w: 0.62, d: 0.62 };
		case 'portal':
			return { w: 0.74, d: 0.5 };
		case 'scaffold':
			return { w: 0.7, d: 0.7 };
		case 'offmap':
			return { w: 0.6, d: 0.6 };
		default:
			return { w: 0.62, d: 0.62 };
	}
}

function boundsOf(districts) {
	if (districts.length === 0) return { minX: 0, minY: 0, maxX: CELL, maxY: CELL };
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const d of districts) {
		minX = Math.min(minX, d.x);
		minY = Math.min(minY, d.y);
		maxX = Math.max(maxX, d.x + d.w);
		maxY = Math.max(maxY, d.y + d.h);
	}
	return { minX, minY, maxX, maxY };
}
