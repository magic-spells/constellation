import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ApiError,
	createCard,
	deleteCard,
	fetchPlans,
	loadPlan,
	loadPlans,
	patchCard,
	setActivePlan,
	setSyncPoint,
} from '../../viewer/app/lib/api.js';

const cards = [
	{
		handle: 'API-ALPHA',
		type: 'API',
		kind: 'http',
		name: 'Alpha',
		status: 'built',
		relPath: 'api/API-ALPHA.md',
		mtime: 10,
		frontmatter: { name: 'Alpha' },
		body: 'Alpha body',
	},
	{
		handle: 'DB-BETA',
		type: 'DB',
		kind: 'sqlite',
		name: 'Beta',
		status: 'planned',
		relPath: 'db/DB-BETA.md',
		mtime: 20,
		frontmatter: { name: 'Beta' },
		body: 'Beta body',
	},
];

function response(body, { status = 200 } = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: vi.fn().mockResolvedValue(body),
	};
}

function planPayload(overrides = {}) {
	return {
		editable: true,
		cards,
		connections: [{ a: 'API-ALPHA', b: 'DB-BETA' }],
		errors: [],
		warnings: [],
		...overrides,
	};
}

function storeFake(overrides = {}) {
	return {
		upsert: vi.fn(),
		findMany: vi.fn(() => []),
		findOne: vi.fn(() => null),
		...overrides,
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
	vi.stubGlobal('fetch', vi.fn());
});

// The API prefix is module state, so a test that scopes the client to a plan
// has to hand it back — otherwise the next test inherits '/api/p/alpha'.
afterEach(() => {
	setActivePlan(null);
});

describe('viewer API client', () => {
	it('loadPlan upserts every card and the plan singleton with bumped generation', async () => {
		fetch.mockResolvedValue(response(planPayload()));
		const store = storeFake({
			findOne: vi.fn(() => ({ id: 'plan', generation: 4 })),
		});

		await loadPlan(store);

		expect(fetch).toHaveBeenCalledWith('/api/plan');
		expect(store.upsert).toHaveBeenNthCalledWith(1, 'card', cards[0]);
		expect(store.upsert).toHaveBeenNthCalledWith(2, 'card', cards[1]);
		expect(store.upsert).toHaveBeenNthCalledWith(
			3,
			'plan',
			expect.objectContaining({
				id: 'plan',
				editable: true,
				connections: [{ a: 'API-ALPHA', b: 'DB-BETA' }],
				errors: [],
				warnings: [],
				generation: 5,
			}),
		);
	});

	it('loadPlan destroys records whose handle vanished from the payload', async () => {
		fetch.mockResolvedValue(response(planPayload({ cards: [cards[0]] })));
		const stale = { handle: 'DB-STALE', destroy: vi.fn() };
		const retained = { handle: 'API-ALPHA', destroy: vi.fn() };
		const store = storeFake({
			findMany: vi.fn(() => [retained, stale]),
		});

		await loadPlan(store);

		expect(retained.destroy).not.toHaveBeenCalled();
		expect(stale.destroy).toHaveBeenCalledOnce();
	});

	it('patchCard sends if_mtime and returns body on 200', async () => {
		const success = { card: cards[0], issues: [] };
		fetch
			.mockResolvedValueOnce(response(success))
			.mockResolvedValueOnce(response(planPayload()));
		const store = storeFake();

		await expect(
			patchCard(store, 'API-ALPHA/ONE', { name: 'Renamed' }, 1234),
		).resolves.toEqual(success);
		expect(fetch).toHaveBeenNthCalledWith(1, '/api/card/API-ALPHA%2FONE', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'Renamed', if_mtime: 1234 }),
		});
		expect(fetch).toHaveBeenNthCalledWith(2, '/api/plan');
	});

	it('patchCard throws ApiError with code STALE on 409', async () => {
		fetch.mockResolvedValue(
			response(
				{ error: { code: 'STALE', message: 'API-ALPHA changed on disk' } },
				{ status: 409 },
			),
		);
		const store = storeFake();

		const error = await patchCard(store, 'API-ALPHA', { name: 'Renamed' }, 1234).catch(
			(reason) => reason,
		);

		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({
			code: 'STALE',
			message: 'API-ALPHA changed on disk',
			status: 409,
		});
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

// Multi-plan serving. `setActivePlan` moves every request under
// `/api/p/<id>/…`; passing `null` puts them back on the unprefixed routes,
// which is both the single-plan client and what an older server still answers.
describe('viewer API client, plan-scoped', () => {
	const roster = {
		multi: true,
		default: 'root',
		scan_root: '/code',
		plans: [
			{ id: 'root', aliases: [], name: 'Root', code_path: '/code', cards: 12, default: true },
			{ id: 'alpha', aliases: ['a'], name: 'Alpha', code_path: '/code/alpha', cards: 7 },
		],
	};

	it('fetchPlans hits the UNPREFIXED /api/plans — the roster is global', async () => {
		fetch.mockResolvedValue(response(roster));
		setActivePlan('alpha');

		await expect(fetchPlans()).resolves.toEqual(roster);
		expect(fetch).toHaveBeenCalledWith('/api/plans');
	});

	it('loadPlans puts the roster and the ACTIVE plan on the plan singleton', () => {
		setActivePlan('alpha');
		const store = storeFake();

		loadPlans(store, roster);

		expect(store.upsert).toHaveBeenCalledWith('plan', {
			id: 'plan',
			activePlan: 'alpha',
			plans: roster.plans,
			multi: true,
		});
	});

	it('loadPlans falls back to the roster default when nothing is scoped', () => {
		const store = storeFake();

		loadPlans(store, roster);

		expect(store.upsert).toHaveBeenCalledWith(
			'plan',
			expect.objectContaining({ activePlan: 'root' }),
		);
	});

	it('loadPlan reads the active plan prefix', async () => {
		fetch.mockResolvedValue(response(planPayload()));
		setActivePlan('alpha');

		await loadPlan(storeFake());

		expect(fetch).toHaveBeenCalledWith('/api/p/alpha/plan');
	});

	it('patchCard writes and re-reads under the active plan prefix', async () => {
		fetch
			.mockResolvedValueOnce(response({ card: cards[0], issues: [] }))
			.mockResolvedValueOnce(response(planPayload()));
		setActivePlan('alpha');

		await patchCard(storeFake(), 'API-ALPHA', { name: 'Renamed' }, 1234);

		expect(fetch).toHaveBeenNthCalledWith(
			1,
			'/api/p/alpha/card/API-ALPHA',
			expect.objectContaining({ method: 'PATCH' }),
		);
		expect(fetch).toHaveBeenNthCalledWith(2, '/api/p/alpha/plan');
	});

	it('createCard posts under the active plan prefix', async () => {
		fetch
			.mockResolvedValueOnce(response({ card: cards[0] }))
			.mockResolvedValueOnce(response(planPayload()));
		setActivePlan('alpha');

		await createCard(storeFake(), { type: 'API', name: 'New' });

		expect(fetch).toHaveBeenNthCalledWith(
			1,
			'/api/p/alpha/cards',
			expect.objectContaining({ method: 'POST' }),
		);
	});

	it('deleteCard deletes under the active plan prefix', async () => {
		fetch
			.mockResolvedValueOnce(response({ deleted: true }))
			.mockResolvedValueOnce(response(planPayload()));
		setActivePlan('alpha');

		await deleteCard(storeFake(), 'API-ALPHA');

		expect(fetch).toHaveBeenNthCalledWith(1, '/api/p/alpha/card/API-ALPHA', {
			method: 'DELETE',
		});
	});

	it('setSyncPoint stamps under the active plan prefix', async () => {
		fetch.mockResolvedValue(response({ sync: { clean: true } }));
		setActivePlan('alpha');

		await setSyncPoint(storeFake());

		expect(fetch).toHaveBeenCalledWith('/api/p/alpha/sync-point', { method: 'POST' });
	});

	it('setActivePlan(null) restores the unprefixed single-plan routes', async () => {
		fetch.mockResolvedValue(response(planPayload()));
		setActivePlan('alpha');
		setActivePlan(null);

		await loadPlan(storeFake());
		await setSyncPoint(storeFake());

		expect(fetch).toHaveBeenNthCalledWith(1, '/api/plan');
		expect(fetch).toHaveBeenNthCalledWith(2, '/api/sync-point', { method: 'POST' });
	});
});
