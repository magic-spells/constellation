import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, loadPlan, patchCard } from '../../viewer/app/lib/api.js';

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
