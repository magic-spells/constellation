import { describe, expect, it, vi } from 'vitest';
import { planIndex } from '../../viewer/app/lib/plan-index.js';

function storeFake({ cards, plan }) {
	return {
		findMany: vi.fn(() => cards),
		findOne: vi.fn(() => plan),
	};
}

describe('planIndex', () => {
	it('builds undirected neighbors from connections', () => {
		const cards = [
			{ handle: 'API-A', type: 'API' },
			{ handle: 'DB-B', type: 'DB' },
		];
		const connections = [{ a: 'API-A', b: 'DB-B' }];
		const store = storeFake({
			cards,
			plan: { id: 'plan', generation: 1, connections },
		});

		const index = planIndex(store);

		expect(index.byHandle.get('API-A')).toBe(cards[0]);
		expect(index.byType.get('DB')).toEqual([cards[1]]);
		expect(index.neighbors.get('API-A')).toEqual(['DB-B']);
		expect(index.neighbors.get('DB-B')).toEqual(['API-A']);
		expect(index.connections).toBe(connections);
	});

	it('memoizes on generation', () => {
		const plan = { id: 'plan', generation: 3, connections: [] };
		const store = storeFake({
			cards: [{ handle: 'PLAN-PROJECT', type: 'PLAN' }],
			plan,
		});

		const first = planIndex(store);
		const second = planIndex(store);
		plan.generation = 4;
		const third = planIndex(store);

		expect(second).toBe(first);
		expect(third).not.toBe(first);
		expect(third.projectCard?.handle).toBe('PLAN-PROJECT');
	});

	it('returns an empty index before the plan singleton lands', () => {
		const store = storeFake({ cards: [], plan: undefined });

		const index = planIndex(store);

		expect(index.byHandle.size).toBe(0);
		expect(index.connections).toEqual([]);
		expect(index.projectCard).toBeNull();
	});
});
