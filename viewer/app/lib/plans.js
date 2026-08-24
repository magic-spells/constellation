/**
 * Plan addressing — the whole "which plan am I looking at" story, in one place.
 *
 * A Constellation server can serve ONE plan (the classic shape: `/api/plan`,
 * `/events`, hashes like `#/api/API-TICKETS`) or SEVERAL, discovered by scanning
 * a root for `constellation/` folders. Multi-plan serving keeps every
 * single-plan route working — unprefixed means "the default plan" — and adds a
 * per-plan prefix beside it:
 *
 *   viewer URL   #/p/<id>/api/API-TICKETS     (router base '/p/<id>')
 *   API          /api/p/<id>/plan             (base '/api/p/<id>')
 *   live stream  /api/p/<id>/events
 *
 * The functions below are the ONLY place those three shapes are spelled out.
 * They are pure so they can be unit-tested without a browser, a store or the
 * `.pzl` toolchain (tests/viewer/plans.test.js).
 *
 * WHY A ROUTER BASE AND NOT ROUTE CHANGES. Puzzle's router takes a `base` that
 * it strips on read and re-adds on write, and in hash mode the base rides
 * INSIDE the fragment (`#/p/puzzle/api/X`). Everything the app touches —
 * `router.push('/api/X')`, `this.route.pathname`, `this.route.params`, the
 * `| link` formatter — stays base-free, so setting `routerBase` once at
 * PuzzleApp construction plan-scopes every route, every href and every deep
 * link without a single change to routes.js or `hrefForHandle`.
 *
 * THE MODULE-LEVEL ACTIVE ID exists for the one href in the app that is
 * hand-encoded rather than routed: `printHref` in lib/docs.js builds a string
 * for `window.open`, so it has no router to ask. Threading a plan id through
 * its callers would change three signatures to carry a value that is fixed for
 * the life of the page; a module constant set once during boot says the same
 * thing without the ceremony.
 */

/**
 * `#/p/<id>` optionally followed by a path, a query or nothing at all — the
 * three fragment shapes the router's hash mode accepts for a base (an exact
 * match, `base + '?'`, `base + '/'`). The id is NOT decoded: `routerBaseFor`
 * pastes it back verbatim, so the two stay inverses of each other.
 */
const PLAN_FRAGMENT = /^#\/p\/([^/?#]+)(?:[/?].*)?$/;

/**
 * The plan id a viewer URL fragment names, or `null` for the base-less
 * (single-plan / default-plan) form.
 *
 *   '#/p/puzzle/api/API-TICKETS' → 'puzzle'
 *   '#/p/puzzle'                 → 'puzzle'
 *   '#/api/API-TICKETS'          → null
 *   '' / '#'                     → null
 */
export function planFromHash(hash) {
	const match = PLAN_FRAGMENT.exec(String(hash ?? ''));
	return match ? match[1] : null;
}

/** The Puzzle `routerBase` for a plan; `''` (no base) for the default plan. */
export function routerBaseFor(id) {
	return id ? `/p/${id}` : '';
}

/** The API prefix for a plan; the unprefixed `/api` for the default plan. */
export function apiBaseFor(id) {
	return id ? `/api/p/${id}` : '/api';
}

/**
 * The SSE endpoint for a plan. Note the asymmetry with `apiBaseFor`: the
 * default plan's stream is `/events`, a TOP-LEVEL route rather than one under
 * `/api` — that is the single-plan URL and it does not move.
 */
export function eventsUrlFor(id) {
	return id ? `/api/p/${id}/events` : '/events';
}

// Set once during boot (app.js), read by printHref. `null` — the default — is
// the single-plan/default-plan reading, so nothing that never calls the setter
// changes behavior.
let activeId = null;

/** Pin the plan this page is scoped to. Falsy ids normalize to `null`. */
export function setActivePlanId(id) {
	activeId = id || null;
}

/** The plan this page is scoped to, or `null` for the default plan. */
export function activePlanId() {
	return activeId;
}
