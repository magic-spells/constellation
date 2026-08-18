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

export async function loadPlan(store) {
	const payload = await request('/api/plan');
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
	const sync = await request('/api/sync');
	store.upsert('plan', { id: 'plan', sync });
	return sync;
}

/**
 * The compiled document. Kept on the plan singleton rather than fetched by the
 * /docs view, so the TOC (which lives in AppShell, not in the view) reads it
 * from the same store subscription and the SSE reload below refreshes both.
 */
export async function loadDocs(store) {
	const docs = await request('/api/docs');
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
	const atlasConfig = await request('/api/atlas-config');
	store.upsert('plan', { id: 'plan', atlasConfig });
	return atlasConfig;
}

export async function loadAtlasMetrics(store) {
	const atlasMetrics = await request('/api/atlas-metrics');
	store.upsert('plan', { id: 'plan', atlasMetrics });
	return atlasMetrics;
}

export async function saveAtlasConfig(store, config) {
	const atlasConfig = await request('/api/atlas-config', {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(config),
	});
	store.upsert('plan', { id: 'plan', atlasConfig });
	return atlasConfig;
}

export function startLive(store) {
	const events = new EventSource('/events');
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
	return write(store, `/api/card/${encodeURIComponent(handle)}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ ...patch, if_mtime: ifMtime }),
	});
}

export function createCard(store, payload) {
	return write(store, '/api/cards', {
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
	const body = await request('/api/sync-point', { method: 'POST' });
	store.upsert('plan', { id: 'plan', sync: body.sync });
	return body;
}

export function deleteCard(store, handle) {
	return write(store, `/api/card/${encodeURIComponent(handle)}`, {
		method: 'DELETE',
	});
}
