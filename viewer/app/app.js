import { PuzzleApp } from '@magic-spells/puzzle';
import { hashRouter } from '@magic-spells/puzzle/router-modes';
import { enableMorph } from '@magic-spells/puzzle/morph';
import { adapter } from '@magic-spells/puzzle/adapter';
import { loadDocs, loadPlan, loadSync, startLive } from './lib/api.js';
import models from './models/index.js';
import routes from './routes.js';

// Hash routing keeps every URL bookmarkable (`#/api/API-TICKETS`) without
// asking the server for a deep-link rewrite — its static contract stays a
// non-issue. Older `#/card/HANDLE` links still resolve; see routes.js.
let stopLive = null;

const app = new PuzzleApp({
	target: '#app',
	routerMode: hashRouter(),
	// D157: store.upsert/request live behind the opt-in adapter capability.
	adapter,
	routes,
	models,
	async beforeMount(app) {
		if (typeof document === 'undefined') return;
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

export default app;
