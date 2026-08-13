// @vitest-environment jsdom
//
// Mount tests for the card list column (viewer/app/components/CardList.pzl),
// running on the pzlc vitest lane (tests/viewer/pzl-vitest-plugin.js).
//
// The store is a fake: CardList only ever reads `findMany('card')` and
// `findOne('plan', 'plan')` (directly and through planIndex), so those two plus
// the framework's tracking hooks are the whole contract — and a fresh fake per
// test keeps planIndex's per-store memo from leaking between cases.
import { describe, expect, it } from 'vitest';
import { mountView } from '@magic-spells/puzzle/testing';
import CardList from '../../viewer/app/components/CardList.pzl';

const CARDS = [
	{ handle: 'API-TICKETS', type: 'API', name: 'Tickets endpoint', status: 'built' },
	{ handle: 'API-USERS', type: 'API', name: 'Users endpoint', status: 'verified' },
	{ handle: 'DB-TICKETS', type: 'DB', name: 'Tickets table', status: '' },
];

function storeFake({ editable = true, generation = 1 } = {}) {
	const plan = { id: 'plan', generation, editable, connections: [] };
	return {
		findMany: () => CARDS,
		findOne: (type, id) =>
			type === 'plan' ? plan : CARDS.find((card) => card.handle === id),
		// PuzzleView wraps every data() run in the store's dependency tracking and
		// releases it on destroy; a static fake has no dependencies to track.
		withTracking: (view, run) => run(),
		unsubscribe: () => {},
	};
}

function mount(options = {}) {
	const { editable, props, ...rest } = options;
	return mountView(CardList, {
		store: storeFake({ editable }),
		props: { folder: 'api', activeHandle: null, ...props },
		...rest,
	});
}

describe('CardList', () => {
	it('lists only the folder’s cards, sorted by handle', async () => {
		const view = await mount();
		const handles = view
			.findAll('.clist-handle')
			.map((el) => el.textContent.trim());

		expect(handles).toEqual(['API-TICKETS', 'API-USERS']);
		view.destroy();
	});

	it('narrows the rows as the filter is typed, and restores them when cleared', async () => {
		const view = await mount();
		expect(view.findAll('.clist-row')).toHaveLength(2);

		await view.type('input', 'users');
		let handles = view.findAll('.clist-handle').map((el) => el.textContent.trim());
		expect(handles).toEqual(['API-USERS']);

		// Name matches too, case-insensitively.
		await view.type('input', 'TICKETS ENDPOINT');
		handles = view.findAll('.clist-handle').map((el) => el.textContent.trim());
		expect(handles).toEqual(['API-TICKETS']);

		await view.type('input', 'zzz');
		expect(view.findAll('.clist-row')).toHaveLength(0);
		expect(view.element.textContent).toContain('No matches');

		await view.type('input', '');
		expect(view.findAll('.clist-row')).toHaveLength(2);
		view.destroy();
	});

	it('hides the "+ new" row when the plan is not editable', async () => {
		const readonly = await mount({ editable: false });
		expect(readonly.find('.clist-new')).toBeFalsy();
		readonly.destroy();

		const writable = await mount({ editable: true });
		expect(writable.find('.clist-new')).toBeTruthy();
		expect(writable.find('.clist-new').textContent).toContain('api endpoint');
		writable.destroy();
	});

	it('calls @create with the folder’s type', async () => {
		const created = [];
		const view = await mount({ props: { create: (type) => created.push(type) } });

		await view.click('.clist-new');
		expect(created).toEqual(['API']);
		view.destroy();
	});

	it('marks the active row and links every row at its card', async () => {
		const view = await mount({ props: { activeHandle: 'API-USERS' } });
		const rows = view.findAll('.clist-row');

		expect(rows.map((row) => row.getAttribute('href'))).toEqual([
			'/card/API-TICKETS',
			'/card/API-USERS',
		]);
		expect(rows[0].className).not.toContain('is-active');
		expect(rows[1].className).toContain('is-active');
		expect(rows[1].getAttribute('aria-current')).toBe('page');
		view.destroy();
	});

	it('says so when the folder is not a card type', async () => {
		const view = await mount({ props: { folder: 'nope' } });
		expect(view.element.textContent).toContain('Unknown type: nope');
		expect(view.findAll('.clist-row')).toHaveLength(0);
		view.destroy();
	});
});
