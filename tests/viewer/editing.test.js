// @vitest-environment jsdom
//
// Mount tests for the editing flows (Task 10): Editable, StatusSelect,
// CreateCardDialog, DeleteCardDialog, and the affordance gate on CardPage.
//
// lib/api.js is mocked so nothing touches the network — the contract under test
// is which write helper a component calls and with what. `importOriginal` keeps
// the real ApiError class, because lib/edit.js branches on `instanceof` to pick
// the toast (and CreateCardDialog needs a real 409 to render inline).
//
// Two jsdom accommodations, both documented in palette.test.js: <dialog> has no
// showModal()/close() there, and there is no Web Animations API for the
// dialogs' enter/exit tweens.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeAnimate, mountView, settled } from '@magic-spells/puzzle/testing';

vi.mock('../../viewer/app/lib/api.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		loadPlan: vi.fn(async () => ({})),
		patchCard: vi.fn(async () => ({ card: null, issues: [] })),
		createCard: vi.fn(async () => ({ card: null, issues: [] })),
		deleteCard: vi.fn(async () => ({ deleted: 'API-TICKETS', referenced_by: [] })),
	};
});

const api = await import('../../viewer/app/lib/api.js');
const { default: CardPage } = await import('../../viewer/app/views/CardPage.pzl');
const { default: CreateCardDialog } = await import(
	'../../viewer/app/components/CreateCardDialog.pzl'
);
const { default: DeleteCardDialog } = await import(
	'../../viewer/app/components/DeleteCardDialog.pzl'
);
const { default: Editable } = await import('../../viewer/app/components/Editable.pzl');
const { default: StatusSelect } = await import('../../viewer/app/components/StatusSelect.pzl');
const { default: models } = await import('../../viewer/app/models/index.js');

const CARDS = [
	{
		handle: 'API-TICKETS',
		type: 'API',
		name: 'Tickets endpoint',
		status: 'building',
		relPath: 'api/API-TICKETS.md',
		mtime: 1700,
		frontmatter: {
			name: 'Tickets endpoint',
			status: 'building',
			connections: ['DB-TICKETS'],
			path: 'src/api.ts',
			methods: ['GET', 'POST'],
		},
		body: 'How tickets are served.',
	},
	{
		handle: 'DOC-ORPHAN',
		type: 'DOC',
		name: 'Nothing links here',
		relPath: 'doc/DOC-ORPHAN.md',
		mtime: 1900,
		frontmatter: {},
		body: '',
	},
	{
		handle: 'DB-TICKETS',
		type: 'DB',
		name: 'Tickets table',
		relPath: 'db/DB-TICKETS.md',
		mtime: 1800,
		frontmatter: {},
		body: '',
	},
];

function storeFake({ editable = true } = {}) {
	const plan = {
		id: 'plan',
		generation: 1,
		editable,
		connections: [{ a: 'API-TICKETS', b: 'DB-TICKETS' }],
	};
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

async function mountCard(editable) {
	const view = await mountView(CardPage, {
		store: storeFake({ editable }),
		router: routerFake([]),
		params: { handle: 'api-tickets' },
		route: { params: { handle: 'api-tickets' } },
		models,
	});
	await settled();
	return view;
}

/** Click an element the way a user would (view.click only takes selectors). */
async function press(element) {
	element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
	await settled();
}

async function typeInto(field, text) {
	field.value = text;
	field.dispatchEvent(new window.Event('input', { bubbles: true }));
	await settled();
}

// jsdom ships <dialog> as an element but implements none of its behaviour.
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

function key(element, init) {
	element.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, ...init }));
}

let animate;
let uninstallDialog;

beforeEach(() => {
	animate = installFakeAnimate();
	uninstallDialog = installDialogFake();
	vi.clearAllMocks();
});

afterEach(() => {
	animate.uninstall();
	uninstallDialog();
});

describe('Editable', () => {
	const mount = (options = {}) => {
		const { editable, saved = [], props, ...rest } = options;
		return mountView(Editable, {
			store: storeFake({ editable }),
			props: { value: 'Tickets endpoint', save: (next) => saved.push(next), ...props },
			...rest,
		});
	};

	it('renders inert text with no affordance when the plan is read-only', async () => {
		const view = await mount({ editable: false });

		const target = view.find('.editable-static');
		expect(target).toBeTruthy();
		expect(view.find('.editable')).toBeFalsy();
		expect(target.getAttribute('role')).toBe(null);
		expect(target.getAttribute('tabindex')).toBe(null);

		await view.click('.editable-static');
		expect(view.find('input')).toBeFalsy();

		view.destroy();
	});

	it('opens an input on click, seeded with the current value', async () => {
		const view = await mount();

		expect(view.find('.editable').getAttribute('role')).toBe('button');
		await view.click('.editable');

		const input = view.find('input.inline-edit');
		expect(input).toBeTruthy();
		expect(input.value).toBe('Tickets endpoint');

		view.destroy();
	});

	it('commits the edited text on meta-Enter', async () => {
		const saved = [];
		const view = await mount({ saved });

		await view.click('.editable');
		const input = view.find('input.inline-edit');
		input.value = 'Renamed endpoint';
		input.dispatchEvent(new window.Event('input', { bubbles: true }));
		key(input, { key: 'Enter', metaKey: true });
		await settled();

		expect(saved).toEqual(['Renamed endpoint']);
		expect(view.find('input.inline-edit')).toBeFalsy();

		view.destroy();
	});

	it('throws the draft away on Escape', async () => {
		const saved = [];
		const view = await mount({ saved });

		await view.click('.editable');
		const input = view.find('input.inline-edit');
		input.value = 'Never saved';
		input.dispatchEvent(new window.Event('input', { bubbles: true }));
		key(input, { key: 'Escape' });
		await settled();

		expect(saved).toEqual([]);
		expect(view.find('input.inline-edit')).toBeFalsy();
		expect(view.element.textContent).toContain('Tickets endpoint');

		view.destroy();
	});

	it('does not fire @save when the text came back unchanged', async () => {
		const saved = [];
		const view = await mount({ saved });

		await view.click('.editable');
		key(view.find('input.inline-edit'), { key: 'Enter', metaKey: true });
		await settled();

		expect(saved).toEqual([]);
		view.destroy();
	});

	it('needs a modifier to commit a multiline edit', async () => {
		const saved = [];
		const view = await mount({ saved, props: { multiline: true, value: 'body text' } });

		await view.click('.editable');
		const area = view.find('textarea.inline-edit');
		area.value = 'new body';
		area.dispatchEvent(new window.Event('input', { bubbles: true }));

		key(area, { key: 'Enter' });
		await settled();
		expect(saved).toEqual([]);

		key(area, { key: 'Enter', ctrlKey: true });
		await settled();
		expect(saved).toEqual(['new body']);

		view.destroy();
	});
});

describe('StatusSelect', () => {
	const mount = (options = {}) => {
		const { editable, props, ...rest } = options;
		return mountView(StatusSelect, {
			store: storeFake({ editable }),
			props: { handle: 'API-TICKETS', status: 'building', mtime: 1700, ...props },
			...rest,
		});
	};

	it('renders a read-only badge when the plan is not editable', async () => {
		const view = await mount({ editable: false });

		expect(view.find('button')).toBeFalsy();
		expect(view.element.textContent).toContain('building');

		view.destroy();
	});

	it('patches the card with the chosen status, carrying if_mtime', async () => {
		const view = await mount();

		await view.click('[data-select-trigger]');
		const verified = view
			.findAll('[role="option"]')
			.find((option) => option.textContent.trim() === 'verified');
		verified.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		await settled();

		expect(api.patchCard).toHaveBeenCalledTimes(1);
		const [, handle, patch, mtime] = api.patchCard.mock.calls[0];
		expect(handle).toBe('API-TICKETS');
		expect(patch).toEqual({ status: 'verified' });
		expect(mtime).toBe(1700);

		view.destroy();
	});

	it('clears the status when "no status" is chosen', async () => {
		const view = await mount();

		await view.click('[data-select-trigger]');
		const none = view
			.findAll('[role="option"]')
			.find((option) => option.textContent.trim() === 'no status');
		none.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		await settled();

		expect(api.patchCard.mock.calls[0][2]).toEqual({ status: null });
		view.destroy();
	});

	it('ignores a pick of the status the card already has', async () => {
		const view = await mount();

		await view.click('[data-select-trigger]');
		const same = view
			.findAll('[role="option"]')
			.find((option) => option.textContent.trim() === 'building');
		same.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
		await settled();

		expect(api.patchCard).not.toHaveBeenCalled();
		view.destroy();
	});
});

describe('CreateCardDialog', () => {
	const mount = async (options = {}) => {
		const pushed = [];
		const closes = [];
		const view = await mountView(CreateCardDialog, {
			store: storeFake(),
			router: routerFake(pushed),
			props: { open: true, type: 'API', close: () => closes.push(true), ...options.props },
		});
		return { view, pushed, closes };
	};

	const typeHandle = async (view, text) => {
		const input = view.find('input.cd-mono');
		input.value = text;
		input.dispatchEvent(new window.Event('input', { bubbles: true }));
		await settled();
		return input;
	};

	it('shows the fixed type prefix and previews the handle it will create', async () => {
		const { view } = await mount();

		expect(view.find('.cd-prefix').textContent).toBe('API-');
		await typeHandle(view, 'new ticket');
		expect(view.find('.cd-preview').textContent).toContain('API-NEW-TICKET');

		view.destroy();
	});

	it('uppercases and dash-joins the handle, then navigates to the new card', async () => {
		const { view, pushed, closes } = await mount();

		await typeHandle(view, 'new ticket');
		await view.click('button.bg-brand');
		await settled();

		expect(api.createCard).toHaveBeenCalledTimes(1);
		expect(api.createCard.mock.calls[0][1]).toEqual({ handle: 'API-NEW-TICKET' });
		expect(closes).toHaveLength(1);
		expect(pushed).toEqual(['/card/API-NEW-TICKET']);

		view.destroy();
	});

	it('sends the optional name when one was given', async () => {
		const { view } = await mount();

		await typeHandle(view, 'exports');
		const name = view.findAll('input.cd-input').at(-1);
		name.value = 'Ticket exports';
		name.dispatchEvent(new window.Event('input', { bubbles: true }));
		await view.click('button.bg-brand');
		await settled();

		expect(api.createCard.mock.calls[0][1]).toEqual({
			handle: 'API-EXPORTS',
			name: 'Ticket exports',
		});
		view.destroy();
	});

	it('rejects a handle the grammar does not allow, without calling the server', async () => {
		const { view } = await mount();

		await typeHandle(view, 'not/valid');
		await view.click('button.bg-brand');
		await settled();

		expect(api.createCard).not.toHaveBeenCalled();
		expect(view.find('.cd-error').textContent).toContain('A–Z');

		view.destroy();
	});

	it('asks for a handle before submitting an empty field', async () => {
		const { view } = await mount();

		await view.click('button.bg-brand');
		await settled();

		expect(api.createCard).not.toHaveBeenCalled();
		expect(view.find('.cd-error').textContent).toContain('Enter a handle');

		view.destroy();
	});

	it('shows a server CARD_EXISTS inline rather than as a toast', async () => {
		api.createCard.mockRejectedValueOnce(
			new api.ApiError('CARD_EXISTS', 'API-TICKETS already exists', 409),
		);
		const { view, closes } = await mount();

		await typeHandle(view, 'tickets');
		await view.click('button.bg-brand');
		await settled();

		expect(view.find('.cd-error').textContent).toContain('already exists');
		expect(closes).toHaveLength(0);

		view.destroy();
	});
});

describe('DeleteCardDialog', () => {
	const mount = async (props = {}) => {
		const pushed = [];
		const closes = [];
		const view = await mountView(DeleteCardDialog, {
			store: storeFake(),
			router: routerFake(pushed),
			props: { open: true, handle: 'API-TICKETS', close: () => closes.push(true), ...props },
		});
		return { view, pushed, closes };
	};

	it('names the card, its file, and every handle that references it', async () => {
		const { view } = await mount();
		const text = view.element.textContent;

		expect(text).toContain('Delete API-TICKETS?');
		expect(text).toContain('api/API-TICKETS.md');
		expect(text).toContain('Referenced by DB-TICKETS');

		view.destroy();
	});

	it('says so when nothing references the card', async () => {
		const { view } = await mount({ handle: 'DOC-ORPHAN' });

		expect(view.element.textContent).toContain('Nothing else in the plan links to it');
		view.destroy();
	});

	it('deletes on confirm and lands on the type list', async () => {
		const { view, pushed, closes } = await mount();

		await view.click('button.bg-danger');
		await settled();

		expect(api.deleteCard).toHaveBeenCalledTimes(1);
		expect(api.deleteCard.mock.calls[0][1]).toBe('API-TICKETS');
		expect(closes).toHaveLength(1);
		expect(pushed).toEqual(['/type/api']);

		view.destroy();
	});

	it('deletes nothing when the prompt is cancelled', async () => {
		const { view, closes, pushed } = await mount();

		await view.click('button.bg-surface');
		await settled();

		expect(api.deleteCard).not.toHaveBeenCalled();
		expect(closes).toHaveLength(1);
		expect(pushed).toEqual([]);

		view.destroy();
	});
});

describe('CardPage edit affordances', () => {
	it('offers no delete button, no status select and no edit hooks when read-only', async () => {
		const view = await mountCard(false);

		expect(view.find('.card-delete')).toBeFalsy();
		expect(view.find('[data-select-trigger]')).toBeFalsy();
		expect(view.find('.editable')).toBeFalsy();
		expect(view.findAll('.editable-static').length).toBeGreaterThan(0);

		view.destroy();
	});

	it('offers all three on an editable plan', async () => {
		const view = await mountCard(true);

		expect(view.find('.card-delete')).toBeTruthy();
		expect(view.find('[data-select-trigger]')).toBeTruthy();
		expect(view.findAll('.editable').length).toBeGreaterThan(0);

		view.destroy();
	});

	it('renames the card through a PATCH carrying if_mtime', async () => {
		const view = await mountCard(true);

		await view.click('h1 .editable');
		const input = view.find('h1 input.inline-edit');
		input.value = 'Renamed';
		input.dispatchEvent(new window.Event('input', { bubbles: true }));
		key(input, { key: 'Enter' });
		await settled();

		expect(api.patchCard).toHaveBeenCalledTimes(1);
		const [, handle, patch, mtime] = api.patchCard.mock.calls[0];
		expect(handle).toBe('API-TICKETS');
		expect(patch).toEqual({ name: 'Renamed' });
		expect(mtime).toBe(1700);

		view.destroy();
	});

	it('opens the delete prompt from the header button', async () => {
		const view = await mountCard(true);

		await view.click('.card-delete');
		expect(view.element.textContent).toContain('Delete API-TICKETS?');

		view.destroy();
	});
});

// Task 10b — frontmatter FIELD editing. The value on screen is YAML: a scalar
// edits as itself, a structure edits as the text js-yaml dumps, and whatever
// comes back is parsed before it is PATCHed as `fields`.
describe('CardPage frontmatter fields', () => {
	const rows = (view) => view.findAll('.field-row:not(.field-ghost)');

	it('lists every non-reserved key and never the four reserved ones', async () => {
		const view = await mountCard(true);
		const terms = view.findAll('.field-row dt').map((dt) => dt.textContent.trim());

		expect(terms).toEqual(['path', 'methods']);
		for (const reserved of ['name', 'kind', 'status', 'connections']) {
			expect(terms).not.toContain(reserved);
		}

		view.destroy();
	});

	it('patches a scalar field with the parsed YAML value', async () => {
		const view = await mountCard(true);

		await press(rows(view)[0].querySelector('.editable'));
		const input = rows(view)[0].querySelector('input.inline-edit');
		expect(input.value).toBe('src/api.ts');
		await typeInto(input, '42');
		key(input, { key: 'Enter' });
		await settled();

		const [, handle, patch, mtime] = api.patchCard.mock.calls[0];
		expect(handle).toBe('API-TICKETS');
		expect(patch).toEqual({ fields: { path: 42 } });
		expect(mtime).toBe(1700);

		view.destroy();
	});

	it('round-trips a structure through YAML text', async () => {
		const view = await mountCard(true);

		await press(rows(view)[1].querySelector('.editable'));
		const area = rows(view)[1].querySelector('textarea.inline-edit');
		expect(area.value).toBe('- GET\n- POST');

		await typeInto(area, '- GET\n- PATCH');
		key(area, { key: 'Enter', metaKey: true });
		await settled();

		expect(api.patchCard.mock.calls[0][2]).toEqual({ fields: { methods: ['GET', 'PATCH'] } });
		view.destroy();
	});

	it('sends null — the server\'s delete — for an emptied value', async () => {
		const view = await mountCard(true);

		await press(rows(view)[0].querySelector('.editable'));
		await typeInto(rows(view)[0].querySelector('input.inline-edit'), '');
		key(rows(view)[0].querySelector('input.inline-edit'), { key: 'Enter' });
		await settled();

		expect(api.patchCard.mock.calls[0][2]).toEqual({ fields: { path: null } });
		view.destroy();
	});

	it('saves nothing when the YAML does not parse', async () => {
		const view = await mountCard(true);

		await press(rows(view)[1].querySelector('.editable'));
		const area = rows(view)[1].querySelector('textarea.inline-edit');
		await typeInto(area, '- [unclosed');
		key(area, { key: 'Enter', metaKey: true });
		await settled();

		expect(api.patchCard).not.toHaveBeenCalled();
		view.destroy();
	});

	it('adds a new field from the ghost "key: value" row', async () => {
		const view = await mountCard(true);

		await press(view.find('.field-ghost .ghost-add'));
		const input = view.find('.field-ghost input.inline-edit');
		await typeInto(input, 'owner: platform');
		key(input, { key: 'Enter' });
		await settled();

		expect(api.patchCard.mock.calls[0][2]).toEqual({ fields: { owner: 'platform' } });
		expect(view.find('.field-ghost input.inline-edit')).toBeFalsy();
		view.destroy();
	});

	it('needs a key before the colon to add anything', async () => {
		const view = await mountCard(true);

		await press(view.find('.field-ghost .ghost-add'));
		const input = view.find('.field-ghost input.inline-edit');
		await typeInto(input, 'no colon here');
		key(input, { key: 'Enter' });
		await settled();

		expect(api.patchCard).not.toHaveBeenCalled();
		view.destroy();
	});

	it('throws the ghost row away on Escape', async () => {
		const view = await mountCard(true);

		await press(view.find('.field-ghost .ghost-add'));
		const input = view.find('.field-ghost input.inline-edit');
		await typeInto(input, 'owner: platform');
		key(input, { key: 'Escape' });
		await settled();

		expect(api.patchCard).not.toHaveBeenCalled();
		expect(view.find('.field-ghost input.inline-edit')).toBeFalsy();
		expect(view.find('.field-ghost .ghost-add')).toBeTruthy();
		view.destroy();
	});

	it('renders values as inert text with no ghost row when read-only', async () => {
		const view = await mountCard(false);

		expect(view.findAll('.field-row dt').map((dt) => dt.textContent.trim())).toEqual([
			'path',
			'methods',
		]);
		expect(view.find('.field-ghost')).toBeFalsy();
		expect(view.find('.field-row .editable')).toBeFalsy();
		expect(view.findAll('.field-row .editable-static').length).toBe(2);

		view.destroy();
	});
});

// Task 10b — connection editing. `connections:` replaces wholesale, so both
// add and remove send the complete array the card should end up with.
describe('CardPage connections', () => {
	it('removes a connection by sending the array minus that handle', async () => {
		const view = await mountCard(true);

		await press(view.find('.connection-remove'));

		const [, handle, patch, mtime] = api.patchCard.mock.calls[0];
		expect(handle).toBe('API-TICKETS');
		expect(patch).toEqual({ connections: [] });
		expect(mtime).toBe(1700);

		view.destroy();
	});

	it('adds a connection by sending the full array', async () => {
		const view = await mountCard(true);

		await press(view.find('.conn-add .ghost-add'));
		const input = view.find('.conn-add input.inline-edit');
		await typeInto(input, 'doc-orphan');
		key(input, { key: 'Enter' });
		await settled();

		expect(api.patchCard.mock.calls[0][2]).toEqual({
			connections: ['DB-TICKETS', 'DOC-ORPHAN'],
		});
		view.destroy();
	});

	it('offers only the handles that are not already neighbours', async () => {
		const view = await mountCard(true);

		await press(view.find('.conn-add .ghost-add'));
		const options = view.findAll('.conn-add datalist option').map((option) => option.value);

		expect(options).toEqual(['DOC-ORPHAN']);
		view.destroy();
	});

	it('refuses a handle that is not a card in this plan', async () => {
		const view = await mountCard(true);

		await press(view.find('.conn-add .ghost-add'));
		const input = view.find('.conn-add input.inline-edit');
		await typeInto(input, 'API-NOPE');
		key(input, { key: 'Enter' });
		await settled();

		expect(api.patchCard).not.toHaveBeenCalled();
		view.destroy();
	});

	it('offers no × and no "+ connect" when the plan is read-only', async () => {
		const view = await mountCard(false);

		expect(view.find('.connection-chip')).toBeTruthy();
		expect(view.find('.connection-remove')).toBeFalsy();
		expect(view.find('.conn-add')).toBeFalsy();

		view.destroy();
	});
});
