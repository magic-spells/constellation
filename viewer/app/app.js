import { PuzzleApp } from '@magic-spells/puzzle';
import { loadPlan, loadSync, startLive } from './lib/api.js';
import models from './models/index.js';
import routes from './routes.js';

// Hash routing keeps every URL bookmarkable (`#/api/API-TICKETS`) without
// asking the server for a deep-link rewrite — its static contract stays a
// non-issue. Older `#/card/HANDLE` links still resolve; see routes.js.
let stopLive = null;

const app = new PuzzleApp({
	target: '#app',
	routerMode: 'hash',
	routes,
	models,
	async beforeMount(app) {
		if (typeof document === 'undefined') return;
		await Promise.all([loadPlan(app.store), loadSync(app.store)]).catch(() => {});
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

app.mount();

export default app;
