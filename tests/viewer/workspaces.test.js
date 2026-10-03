// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountView, settled } from '@magic-spells/puzzle/testing';
import WorkspaceSwitcher from '../../viewer/app/components/WorkspaceSwitcher.pzl';
import ConnectedRepos from '../../viewer/app/components/ConnectedRepos.pzl';
import {
	availablePlans,
	monogram,
	monogramTone,
	rosterMatch,
	switchWorkspace,
	workspaceModel,
} from '../../viewer/app/lib/workspaces.js';

const self = { name: 'home', path: '.', root: '/ws/home', kind: 'self' };
const sibling = {
	name: 'sibling',
	path: '../sibling',
	root: '/ws/sibling',
	kind: 'connected',
	description: 'The sibling repo.',
};

const ROSTER = [
	{ id: 'root', name: 'Home', code_path: '', cards: 12, available: true, repo: self },
	{ id: 'sibling', name: 'Sibling', code_path: '', cards: 4, available: true, repo: sibling },
	{
		id: 'ghost',
		name: 'ghost',
		code_path: '',
		cards: 0,
		available: false,
		reason: 'Path not found: ../ghost',
		repo: { name: 'ghost', path: '../ghost', root: '/ws/ghost', kind: 'connected' },
	},
];

describe('monograms', () => {
	it('takes the first letter or digit, upper-cased', () => {
		expect(monogram('constellation')).toBe('C');
		expect(monogram('  @magic/puzzle')).toBe('M');
		expect(monogram('2fa')).toBe('2');
		expect(monogram('')).toBe('?');
	});

	it('gives a name the same tone every time', () => {
		expect(monogramTone('Home')).toBe(monogramTone('Home'));
		expect(monogramTone('Home')).toMatch(/^bg-chart-\d\/15 text-chart-\d$/);
	});
});

describe('workspaceModel', () => {
	it('groups this repo first, then connected repos, unavailable ones disabled', () => {
		const model = workspaceModel(ROSTER, 'root', 'Home Live');
		expect(model.switchable).toBe(true);
		expect(model.current).toMatchObject({ name: 'Home Live', letter: 'H' });
		expect(model.groups.map((g) => g.label)).toEqual(['This repo', 'Connected repos']);
		const [home] = model.groups[0].items;
		expect(home).toMatchObject({ id: 'root', name: 'Home Live', active: true, cards: 12 });
		const [sib, ghost] = model.groups[1].items;
		expect(sib).toMatchObject({ id: 'sibling', detail: 'The sibling repo.', cards: 4, active: false });
		expect(ghost).toMatchObject({ available: false, detail: 'Path not found: ../ghost', cards: null });
	});

	it('is not switchable with one plan and no connected repos', () => {
		const model = workspaceModel([ROSTER[0]], 'root', 'Home');
		expect(model.switchable).toBe(false);
		expect(model.groups).toHaveLength(1);
	});

	it('reads an old roster (no repo/available) as this repo', () => {
		const model = workspaceModel(
			[
				{ id: 'root', name: 'A', code_path: '', cards: 1 },
				{ id: 'b', name: 'B', code_path: 'packages/b', cards: 2 },
			],
			'b',
			'',
		);
		expect(model.groups.map((g) => g.label)).toEqual(['This repo']);
		expect(model.current.name).toBe('B');
		expect(model.groups[0].items[1].detail).toBe('packages/b');
	});

	it('only counts available plans as routable', () => {
		expect(availablePlans(ROSTER).map((p) => p.id)).toEqual(['root', 'sibling']);
	});
});

describe('rosterMatch', () => {
	it('finds a connected repo by its path from the launching repo', () => {
		expect(rosterMatch({ name: 'x', path: '../sibling' }, ROSTER, 'root')).toMatchObject({
			id: 'sibling',
			available: true,
			cards: 4,
		});
	});

	it('finds the launching repo from inside a connected one', () => {
		expect(rosterMatch({ name: 'home', path: '../home' }, ROSTER, 'sibling')).toMatchObject({
			id: 'root',
			available: true,
		});
	});

	it('reports an unavailable repo with its reason, and null when not served', () => {
		expect(rosterMatch({ name: 'ghost', path: '../ghost' }, ROSTER, 'root')).toMatchObject({
			available: false,
			reason: 'Path not found: ../ghost',
		});
		expect(rosterMatch({ name: 'far', path: '../far' }, ROSTER, 'sibling')).toBeNull();
	});
});

describe('switchWorkspace', () => {
	it('replaces the URL with the plan-scoped one and reloads', () => {
		const loc = { pathname: '/', search: '', replace: vi.fn(), reload: vi.fn() };
		switchWorkspace('sibling', loc);
		expect(loc.replace).toHaveBeenCalledWith('/#/p/sibling/');
		expect(loc.reload).toHaveBeenCalled();
	});
});

describe('WorkspaceSwitcher', () => {
	let view;
	afterEach(() => view?.destroy());

	it('shows the name with no chevron when there is nothing to switch to', async () => {
		view = await mountView(WorkspaceSwitcher, {
			props: { plans: [ROSTER[0]], active: 'root', projectName: 'Home' },
		});
		expect(view.find('[data-workspace-trigger]')).toBeNull();
		expect(view.element.textContent).toContain('Home');
		expect(view.find('svg')).toBeNull();
	});

	it('opens a grouped list with the active row checked and unavailable rows disabled', async () => {
		view = await mountView(WorkspaceSwitcher, {
			props: { plans: ROSTER, active: 'root', projectName: 'Home' },
		});
		const trigger = view.find('[data-workspace-trigger]');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(trigger.textContent).toContain('H');

		await view.click('[data-workspace-trigger]');
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		const rows = view.findAll('[data-workspace-item]');
		expect(rows.map((r) => r.dataset.id)).toEqual(['root', 'sibling', 'ghost']);
		expect(rows[0].getAttribute('aria-selected')).toBe('true');
		expect(rows[2].getAttribute('aria-disabled')).toBe('true');
		expect(rows[2].textContent).toContain('Path not found');
		expect(view.findAll('[role="group"]').map((g) => g.getAttribute('aria-label'))).toEqual([
			'This repo',
			'Connected repos',
		]);
	});

	it('closes on Escape and hands focus back to the trigger', async () => {
		view = await mountView(WorkspaceSwitcher, {
			props: { plans: ROSTER, active: 'root', projectName: 'Home' },
		});
		document.body.append(view.container);
		await view.click('[data-workspace-trigger]');
		const row = view.find('[data-workspace-item]');
		row.focus();
		row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await settled();
		expect(view.find('[role="listbox"]')).toBeNull();
		expect(document.activeElement).toBe(view.find('[data-workspace-trigger]'));
		view.container.remove();
	});

	it('moves between enabled rows with the arrow keys', async () => {
		view = await mountView(WorkspaceSwitcher, {
			props: { plans: ROSTER, active: 'root', projectName: 'Home' },
		});
		document.body.append(view.container);
		await view.click('[data-workspace-trigger]');
		const [first, second] = view.findAll('[data-workspace-item]');
		first.focus();
		first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(document.activeElement).toBe(second);
		// The unavailable row is skipped: down from the last enabled row wraps.
		second.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		expect(document.activeElement).toBe(first);
		view.container.remove();
	});
});

describe('ConnectedRepos', () => {
	it('links served repos to their workspace and leaves the rest inert', async () => {
		const view = await mountView(ConnectedRepos, {
			props: {
				repos: [
					{ name: 'sibling', path: '../sibling', description: '' },
					{ name: 'ghost', path: '../ghost', description: '' },
					{ name: 'far', path: '../far', description: '' },
				],
				plans: ROSTER,
				active: 'root',
			},
		});
		const rows = view.findAll('.repo');
		expect(rows[0].getAttribute('href')).toMatch(/#\/p\/sibling\/$/);
		expect(rows[0].textContent).toContain('4 cards');
		expect(rows[1].hasAttribute('href')).toBe(false);
		expect(rows[1].getAttribute('aria-disabled')).toBe('true');
		expect(rows[1].textContent).toContain('Path not found');
		expect(rows[2].textContent).toContain('Not served by this viewer');
		view.destroy();
	});
});
