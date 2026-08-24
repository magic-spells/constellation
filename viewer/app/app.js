import { PuzzleApp } from '@magic-spells/puzzle';
import { hashRouter } from '@magic-spells/puzzle/router-modes';
import { enableMorph } from '@magic-spells/puzzle/morph';
import { adapter } from '@magic-spells/puzzle/adapter';
import { fetchPlans, loadDocs, loadPlan, loadPlans, loadSync, setActivePlan, startLive } from './lib/api.js';
import { planFromHash, routerBaseFor } from './lib/plans.js';
import models from './models/index.js';
import routes from './routes.js';

// Hash routing keeps every URL bookmarkable (`#/api/API-TICKETS`) without
// asking the server for a deep-link rewrite — its static contract stays a
// non-issue. Older `#/card/HANDLE` links still resolve; see routes.js.
let stopLive = null;
let app = null;

/**
 * Boot, in an order that is load-bearing.
 *
 * The server may be serving one plan or several, and which plan THIS page is
 * scoped to is decided by the router base — which Puzzle fixes at Router
 * construction and never re-reads. So the roster has to be in hand BEFORE
 * `new PuzzleApp(...)` runs, which is the whole reason this is an async
 * function rather than the flat module body it used to be. (An async function
 * called with `void`, not top-level await: the latter would make this module
 * — and therefore the entry bundle — block on a network round trip.)
 *
 * Everything degrades to today's behavior when the roster is missing: a server
 * without `/api/plans` (or a static export with no server at all) rejects, we
 * fall through with `active = null`, and every base and prefix stays base-less
 * — byte-for-byte the single-plan client.
 */
async function boot() {
	// Guarded because a non-browser context has no fetch and no plan to pick;
	// it also skips straight to the base-less app, which is what it wants.
	const roster = typeof document === 'undefined' ? null : await fetchPlans().catch(() => null);

	// One plan is not "multi" even from a multi-plan server: there is nothing to
	// switch between, so the page keeps the unprefixed URLs a single-plan server
	// would have served and no switcher appears.
	const multi = (roster?.plans?.length ?? 0) > 1;

	// A deep link may name a plan by id OR by one of its aliases; either way the
	// canonical id is what the base is built from. An unknown name (a renamed
	// project, a stale bookmark) falls back to the roster's default rather than
	// 404ing the whole app.
	const wanted = typeof location === 'undefined' ? null : planFromHash(location.hash);
	const active = multi
		? (roster.plans.find((p) => p.id === wanted || p.aliases?.includes(wanted))?.id ??
			roster.default)
		: null;

	// Canonicalize the URL before the router ever reads it. Two cases land here:
	// a base-less `#/api/X` arriving at a multi-plan server, and an alias or an
	// unknown id that resolved to something else. The router's hash mode treats
	// a fragment outside its base as "not a route" (puzzle D51), so leaving it
	// alone would show an empty app.
	//
	// `replace`, not `assign`: the un-scoped URL was never a place the user
	// visited, so it must not become a history entry they can press Back into
	// and get bounced out of again.
	if (multi && wanted !== active) {
		location.replace(`${location.pathname}${location.search}#/p/${active}/`);
	}

	// Point the API client at this plan before anything fetches. `null` here is
	// the single-plan reading and leaves every URL unprefixed.
	setActivePlan(active);

	app = new PuzzleApp({
		target: '#app',
		routerMode: hashRouter(),
		// The base rides INSIDE the fragment in hash mode (`#/p/puzzle/api/X`),
		// and the router strips it on read and re-adds it on write. So this one
		// option plan-scopes all 20 routes, every `| link` href and every deep
		// link, and routes.js / hrefForHandle stay base-free and untouched.
		routerBase: routerBaseFor(active),
		// D157: store.upsert/request live behind the opt-in adapter capability.
		adapter,
		routes,
		models,
		async beforeMount(app) {
			if (typeof document === 'undefined') return;
			// The roster first, so the topbar switcher has its list on the very
			// first render rather than popping in after the plan payload lands.
			if (roster) loadPlans(app.store, roster);
			await Promise.all([loadPlan(app.store), loadSync(app.store), loadDocs(app.store)]).catch((e) => console.error('[viewer] plan hydration failed:', e));
		},
		mounted(app) {
			if (typeof document === 'undefined') return;
			stopLive = startLive(app.store);
		},
		beforeUnmount() {
			stopLive?.();
			stopLive = null;
		},
	});

	// Shared-element morphs (puzzle D55). Elements sharing a `data-puzzle-morph`
	// value are paired by the router on every swap: the board's Kanban cards and
	// the preview dialog they open, so far. Inert everywhere else — a route with no
	// morph attributes in it swaps exactly as before.
	//
	// The two legs are tuned SEPARATELY (morph-engine ≥0.2.0's `hide` bag — sparse
	// overrides that fall back to the top-level values for anything they omit).
	// Opening is the leg you watch, so it keeps the engine's springy default with
	// friction only nudged up.
	//
	// Closing is unhurried by design — a card flying home is not something you wait
	// on, and a fast exit reads as a flinch. So the out leg sits barely above the in
	// leg on both knobs rather than racing: attraction buys speed and PAYS in
	// overshoot, friction spends it, and the two move TOGETHER. Raise attraction
	// alone and the bounce comes back; raise friction alone and it goes mushy.
	enableMorph(app, {
		attraction: 0.1,
		friction: 0.36,
		hide: { attraction: 0.12, friction: 0.39 },
	});

	app.mount();
	return app;
}

void boot();

// A live binding: `boot()` resolves after this module finishes evaluating, so a
// plain `export default app` would freeze the null.
export { app as default };
