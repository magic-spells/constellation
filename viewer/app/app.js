import { PuzzleApp } from '@magic-spells/puzzle';
import { hashRouter } from '@magic-spells/puzzle/router-modes';
import { enableMorph } from '@magic-spells/puzzle/morph';
import { adapter } from '@magic-spells/puzzle/adapter';
import { fetchPlans, loadDocs, loadPlan, loadPlans, loadSync, setActivePlan, startLive } from './lib/api.js';
import { planFromHash, routerBaseFor, scopeHash } from './lib/plans.js';
import { availablePlans } from './lib/workspaces.js';
import models from './models/index.js';
import routes from './routes.js';
import { boot as bootAppearance } from './lib/appearance.js';
import { bindI18n, installPseudoLocale } from './lib/i18n.js';
import { bindLocaleService } from './lib/locale.js';

// The pre-paint script in public/index.html has already painted the stored
// scheme + mode; boot() makes the appearance module agree with that paint.
bootAppearance();

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
	// Only plans the server can open count: an unavailable connected repo is a
	// disabled row in the switcher, never a place to route to.
	const openable = availablePlans(roster?.plans);
	const multi = openable.length > 1;

	// A deep link may name a plan by id OR by one of its aliases; either way the
	// canonical id is what the base is built from. An unknown name (a renamed
	// project, a stale bookmark) falls back to the roster's default rather than
	// 404ing the whole app.
	const wanted = typeof location === 'undefined' ? null : planFromHash(location.hash);
	const active = multi
		? (openable.find((p) => p.id === wanted || p.aliases?.includes(wanted))?.id ??
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
		// Keep the route: `#/api/API-TICKETS` becomes `#/p/<active>/api/API-TICKETS`,
		// so a link from before the repo had workspaces still opens its card.
		location.replace(`${location.pathname}${location.search}${scopeHash(location.hash, active)}`);
	}

	// Point the API client at this plan before anything fetches. `null` here is
	// the single-plan reading and leaves every URL unprefixed.
	setActivePlan(active);

	app = new PuzzleApp({
		target: '#app',
		routerMode: hashRouter(),
		// The base rides INSIDE the fragment in hash mode (`#/p/puzzle/api/X`),
		// and the router strips it on read and re-adds it on write. So this one
		// option plan-scopes all 20 routes, every `link()` href and every deep
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

	const mounting = app.mount();

	// TRANSLATIONS. Bound right after mount() starts: like the store, app.i18n
	// is created synchronously at the start of mount() and is undefined before
	// it. mount() awaits the locale table before the first data() runs, so
	// nothing translates unbound. Templates reach the service as t(); plain
	// modules translate through lib/i18n.js, and the language picker switches
	// through lib/locale.js — both take the same service here.
	bindI18n(app.i18n);
	bindLocaleService(app.i18n);

	// DEV ONLY: the pseudo-locale. `?pseudo=1` turns it on (remembered on this
	// device), `?pseudo=0` off. Every translated string renders accented, ~35%
	// longer and bracketed, so untranslated English and clipping stand out.
	// The hash router owns the fragment, so the flag rides in the query string:
	// `/?pseudo=1#/`.
	if (typeof __PUZZLE_DEV__ !== 'undefined' && __PUZZLE_DEV__) {
		try {
			const flag = new URLSearchParams(window.location.search).get('pseudo');
			if (flag === '1') localStorage.setItem('constellation:dev-pseudo', '1');
			if (flag === '0') localStorage.removeItem('constellation:dev-pseudo');
			if (localStorage.getItem('constellation:dev-pseudo') === '1') installPseudoLocale(app.i18n);
		} catch {
			/* storage unavailable — no pseudo-locale */
		}
	}

	await mounting;
	return app;
}

void boot();

// A live binding: `boot()` resolves after this module finishes evaluating, so a
// plain `export default app` would freeze the null.
export { app as default };
