// @vitest-environment jsdom
//
// Mount tests for the ⌘K palette (viewer/app/components/CommandPalette.pzl),
// running on the pzlc vitest lane (tests/viewer/pzl-vitest-plugin.js).
//
// The palette is controlled — AppShell owns `open` and the hotkey — so these
// mount it already open and assert the three things it is responsible for: what
// goes in the list, what typing narrows it to, and what activating a row does.
//
// Three jsdom accommodations: <dialog> has no showModal()/close() there (see
// installDialogFake), the Command piece plays an enter animation
// (installFakeAnimate — jsdom has no Web Animations), and the router is a fake
// whose push() records instead of navigating.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeAnimate, mountView } from '@magic-spells/puzzle/testing';
import CommandPalette from '../../viewer/app/components/CommandPalette.pzl';

const CARDS = [
	{ handle: 'API-TICKETS', type: 'API', name: 'Tickets endpoint' },
	{ handle: 'API-USERS', type: 'API', name: 'Users endpoint' },
	{ handle: 'DB-TICKETS', type: 'DB', name: 'Tickets table' },
];

function storeFake() {
	const plan = { id: 'plan', generation: 1, editable: true, connections: [] };
	return {
		findMany: () => CARDS,
		findOne: (type, id) =>
			type === 'plan' ? plan : CARDS.find((card) => card.handle === id),
		withTracking: (view, run) => run(),
		unsubscribe: () => {},
	};
}

function routerFake(pushed) {
	return {
		current: null,
		push: async (path) => {
			pushed.push(path);
		},
		replace: async () => {},
		go: async () => {},
		back: async () => {},
		forward: async () => {},
		url: (path) => path,
		setMorphHandler: () => {},
	};
}

// jsdom ships <dialog> as an element but implements none of its behaviour, so
// Command's showModal() throws and the mount is torn down. The attribute is all
// Command reads back (`dialog.open` reflects it), so reflecting it is enough.
function installDialogFake() {
	const proto = window.HTMLDialogElement.prototype;
	if (typeof proto.showModal === 'function') return () => {};
	proto.showModal = function showModal() {
		this.setAttribute('open', '');
	};
	proto.close = function close() {
		this.removeAttribute('open');
		this.dispatchEvent(new Event('close'));
	};
	return () => {
		delete proto.showModal;
		delete proto.close;
	};
}

let animate;
let uninstallDialog;

beforeEach(() => {
	animate = installFakeAnimate();
	uninstallDialog = installDialogFake();
});

afterEach(() => {
	animate.uninstall();
	uninstallDialog();
	delete document.documentElement.dataset.scheme;
});

async function mount(props = {}) {
	const pushed = [];
	const closes = [];
	const view = await mountView(CommandPalette, {
		store: storeFake(),
		router: routerFake(pushed),
		props: { open: true, close: () => closes.push(true), ...props },
	});
	return { view, pushed, closes };
}

// A row is "<label>" or "<label> <hint>" — two sibling spans with no whitespace
// between them, so read the spans rather than the row's textContent.
const options = (view) =>
	view.findAll('[role="option"]').map((el) =>
		[...el.querySelectorAll('span')]
			.map((span) => span.textContent.trim())
			.filter(Boolean)
			.join(' '),
	);

const groups = (view) =>
	view.findAll('[role="presentation"]').map((el) => el.textContent.trim());

describe('CommandPalette', () => {
	it('lists every card under its type heading, plus pages and schemes', async () => {
		const { view } = await mount();

		// "Go to", not "Pages" — that name belongs to the PAGE type's own group.
		expect(groups(view)).toEqual(['Go to', 'API endpoints', 'Database', 'Scheme']);
		expect(options(view)).toEqual([
			'Overview',
			'Constellation',
			'Tickets endpoint API-TICKETS',
			'Users endpoint API-USERS',
			'Tickets table DB-TICKETS',
			'Observatory Active',
			'Default',
			'Warm',
			'Void',
			'Dim',
		]);
		view.destroy();
	});

	it('filters to the matching cards as the query is typed', async () => {
		const { view } = await mount();

		await view.type('input', 'users');
		expect(options(view)).toEqual(['Users endpoint API-USERS']);

		// The handle matches too, even when the name says nothing of the sort.
		await view.type('input', 'db-tick');
		expect(options(view)).toEqual(['Tickets table DB-TICKETS']);

		// Case-insensitive on the name.
		await view.type('input', 'TICKETS ENDPOINT');
		expect(options(view)).toEqual(['Tickets endpoint API-TICKETS']);

		await view.type('input', 'zzz');
		expect(options(view)).toHaveLength(0);
		expect(view.element.textContent).toContain('Nothing matches that.');

		await view.type('input', '');
		expect(options(view)).toHaveLength(10);
		view.destroy();
	});

	it('navigates to the card and asks to close when a card row is chosen', async () => {
		const { view, pushed, closes } = await mount();

		await view.type('input', 'users');
		await view.click('[role="option"]');

		expect(pushed).toEqual(['/api/API-USERS']);
		expect(closes).toHaveLength(1);
		view.destroy();
	});

	it('navigates to a page row', async () => {
		const { view, pushed } = await mount();

		await view.type('input', 'constellation');
		await view.click('[role="option"]');

		expect(pushed).toEqual(['/constellation']);
		view.destroy();
	});

	it('switches the scheme live when a scheme row is chosen', async () => {
		const { view, pushed } = await mount();

		await view.type('input', 'warm');
		await view.click('[role="option"]');

		expect(document.documentElement.dataset.scheme).toBe('warm');
		expect(pushed).toEqual([]);
		view.destroy();
	});

	it('asks the parent to close on Escape (the dialog’s cancel event)', async () => {
		const { view, closes } = await mount();

		view.find('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
		expect(closes).toHaveLength(1);
		view.destroy();
	});

	it('hides the Features and Style guide rows when the plan has no such cards', async () => {
		const { view } = await mount();
		const labels = options(view);

		expect(labels).not.toContain('Features');
		expect(labels).not.toContain('Style guide');
		view.destroy();
	});
});
