import { activePlanId, apiBaseFor, eventsUrlFor, setActivePlanId } from './plans.js';

// Where this page's API lives. Two module constants rather than a prefix
// threaded through every call site: the plan is fixed for the life of the page
// (app.js decides it before the app is constructed, because the router base is
// fixed at construction), so the paths below read exactly as they did in the
// single-plan client with one interpolation at the front.
//
// The DEFAULTS ARE the single-plan URLs, so a viewer served by an older API —
// or one that simply never calls `setActivePlan` — behaves as it always did.
let API = '/api';
let EVENTS = '/events';

/**
 * Scope every subsequent request to a plan. `null` restores the unprefixed
 * routes, which a multi-plan server still serves as "the default plan". Called
 * once during boot, before anything fetches.
 */
export function setActivePlan(id) {
	setActivePlanId(id);
	const active = activePlanId();
	API = apiBaseFor(active);
	EVENTS = eventsUrlFor(active);
}

/**
 * The plan-scoped URL for an API suffix — for the callers that BUILD a URL
 * rather than fetch one (StyleTokens' `@font-face` src), which are the only
 * ones that need `API` from outside this module.
 */
export function apiUrl(suffix = '') {
	return `${API}${suffix}`;
}

export class ApiError extends Error {
	constructor(code, message, status) {
		super(message);
		this.name = 'ApiError';
		this.code = code;
		this.status = status;
	}
}

async function parseBody(response) {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

async function request(url, init) {
	const response = init === undefined ? await fetch(url) : await fetch(url, init);
	const body = await parseBody(response);

	if (!response.ok) {
		const code = body?.error?.code ?? `HTTP_${response.status}`;
		const message = body?.error?.message ?? `Request failed with status ${response.status}`;
		throw new ApiError(code, message, response.status);
	}

	return body;
}

/**
 * The roster of plans this server is serving.
 *
 * UNPREFIXED ON PURPOSE — `/api/plans` is GLOBAL, not per-plan: it is the
 * question "what is here", asked before we know which plan we are. It is also
 * the ONE request that happens before `setActivePlan`, so it must not read
 * `API` (which is still the default at that point anyway).
 *
 * A single-plan server returns `{ multi: false, plans: [one] }`; an older one
 * 404s, and the caller treats the rejection as "single plan" (see app.js).
 */
export function fetchPlans() {
	return request('/api/plans');
}

/**
 * Put the roster on the plan singleton so the topbar switcher can render it.
 *
 * `activePlan` is the plan we are ACTUALLY scoped to, not the roster's default:
 * a deep link into a non-default plan resolves before this runs (app.js calls
 * `setActivePlan` first), and the switcher's check mark has to sit on the plan
 * whose cards are on screen. It falls back to the roster default for the
 * base-less single-plan case, where nothing is scoped and the switcher is
 * hidden anyway.
 */
export function loadPlans(store, payload) {
	const plans = Array.isArray(payload?.plans) ? payload.plans : [];
	store.upsert('plan', {
		id: 'plan',
		activePlan: activePlanId() ?? payload?.default ?? '',
		plans,
		multi: payload?.multi === true,
	});
	return plans;
}

export async function loadPlan(store) {
	const payload = await request(`${API}/plan`);
	const handles = new Set();

	for (const card of payload.cards) {
		handles.add(card.handle);
		store.upsert('card', card);
	}

	for (const card of store.findMany('card')) {
		if (!handles.has(card.handle)) card.destroy();
	}

	const previous = store.findOne('plan', 'plan');
	store.upsert('plan', {
		id: 'plan',
		editable: payload.editable,
		repoUrl: payload.repo_url || '',
		errors: payload.errors,
		warnings: payload.warnings,
		connections: payload.connections,
		generation: (previous?.generation ?? 0) + 1,
	});

	return payload;
}

export async function loadSync(store) {
	const sync = await request(`${API}/sync`);
	store.upsert('plan', { id: 'plan', sync });
	return sync;
}

/**
 * The compiled document. Kept on the plan singleton rather than fetched by the
 * /docs view, so the TOC (which lives in AppShell, not in the view) reads it
 * from the same store subscription and the SSE reload below refreshes both.
 */
export async function loadDocs(store) {
	const docs = await request(`${API}/docs`);
	store.upsert('plan', { id: 'plan', docs });
	return docs;
}

/**
 * Atlas layout config and bound-code sizes. Both are atlas-only and neither is
 * cheap enough to ride on /api/plan — the metrics route stats the repo — so the
 * atlas view fetches them when it opens rather than the app loading them for
 * every reader who never visits it.
 */
export async function loadAtlasConfig(store) {
	const atlasConfig = await request(`${API}/atlas-config`);
	store.upsert('plan', { id: 'plan', atlasConfig });
	return atlasConfig;
}

export async function loadAtlasMetrics(store) {
	const atlasMetrics = await request(`${API}/atlas-metrics`);
	store.upsert('plan', { id: 'plan', atlasMetrics });
	return atlasMetrics;
}

export async function saveAtlasConfig(store, config) {
	const atlasConfig = await request(`${API}/atlas-config`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(config),
	});
	store.upsert('plan', { id: 'plan', atlasConfig });
	return atlasConfig;
}

export function startLive(store) {
	const events = new EventSource(EVENTS);
	let reloadTimer = null;

	events.onmessage = (event) => {
		if (event.data !== 'change') return;
		if (reloadTimer !== null) clearTimeout(reloadTimer);
		reloadTimer = setTimeout(() => {
			reloadTimer = null;
			void loadPlan(store).catch(() => {});
			void loadDocs(store).catch(() => {});
		}, 100);
	};

	const syncTimer = setInterval(() => {
		void loadSync(store).catch(() => {});
	}, 20_000);

	return () => {
		if (reloadTimer !== null) clearTimeout(reloadTimer);
		clearInterval(syncTimer);
		events.close();
	};
}

async function write(store, url, init) {
	const body = await request(url, init);
	await loadPlan(store);
	return body;
}

export function patchCard(store, handle, patch, ifMtime) {
	return write(store, `${API}/card/${encodeURIComponent(handle)}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ ...patch, if_mtime: ifMtime }),
	});
}

export function createCard(store, payload) {
	return write(store, `${API}/cards`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(payload),
	});
}

/**
 * Stamp the sync marker at HEAD — the `set_sync_point` write, from the UI.
 * The response carries the recomputed status, so the store's sync payload is
 * replaced directly rather than waiting for the next 20s poll (the whole health
 * strip changes: the marker is what gives claim cards a drift baseline).
 * No `loadPlan` — this writes .sync.json, not a card.
 */
export async function setSyncPoint(store) {
	const body = await request(`${API}/sync-point`, { method: 'POST' });
	store.upsert('plan', { id: 'plan', sync: body.sync });
	return body;
}

export function deleteCard(store, handle) {
	return write(store, `${API}/card/${encodeURIComponent(handle)}`, {
		method: 'DELETE',
	});
}
