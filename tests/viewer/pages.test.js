// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mountView, settled } from '@magic-spells/puzzle/testing';
import Home from '../../viewer/app/views/Home.pzl';
import FeaturesPanel from '../../viewer/app/views/FeaturesPanel.pzl';
import StyleGuide from '../../viewer/app/views/StyleGuide.pzl';
import models from '../../viewer/app/models/index.js';

const NOW = Date.now();

function card(handle, type, extra = {}) {
	return {
		handle,
		type,
		name: extra.name ?? handle,
		status: extra.status,
		mtime: extra.mtime ?? NOW,
		frontmatter: extra.frontmatter ?? {},
		body: extra.body ?? '',
	};
}

/** "4 cards" — the two stacked spans of one stat tile, read as one line. */
const statLine = (el) =>
	`${el.querySelector('.n').textContent} ${el.querySelector('.label').textContent}`;

/** Mount a view against a store seeded with `cards` + a plan singleton. */
async function mountWith(View, cards, plan = {}) {
	const view = await mountView(View, { models });

	for (const record of cards) view.store.createRecord('card', record);
	view.store.createRecord('plan', {
		id: 'plan',
		generation: 1,
		editable: true,
		errors: [],
		warnings: [],
		connections: [],
		...plan,
	});
	await settled();

	return view;
}

describe('Home dashboard', () => {
	const cards = [
		card('PLAN-PROJECT', 'PLAN', {
			name: 'Ticketing',
			body: '# Ticketing\n\nA support desk.',
			frontmatter: {
				connected_repos: [
					{ name: 'design-system', path: '../design-system', description: 'Shared UI' },
					{ name: 'nameless' },
				],
			},
		}),
		card('API-TICKETS', 'API'),
		card('API-USERS', 'API'),
		card('DB-TICKETS', 'DB'),
	];

	it('shows stat counts, the plan body, and a tile per non-empty type', async () => {
		const view = await mountWith(Home, cards, {
			connections: [{ a: 'API-TICKETS', b: 'DB-TICKETS' }],
			warnings: [{ code: 'W004' }],
		});

		const stats = view.findAll('.stat').map(statLine);
		expect(stats).toContain('4 cards');
		expect(stats).toContain('1 connections');
		expect(stats).toContain('✓ integrity');
		expect(stats).toContain('1 warnings');

		// One tile per type that has cards — never an empty type.
		const tiles = view.findAll('.tile');
		expect(tiles).toHaveLength(3);
		expect(tiles.map((t) => t.getAttribute('href'))).toEqual([
			'/plan',
			'/api',
			'/db',
		]);
		expect(tiles[1].textContent).toContain('API endpoints');
		expect(tiles[1].textContent).toContain('2 cards');

		expect(view.element.textContent).toContain('A support desk.');

		view.destroy();
	});

	it('counts lint errors instead of integrity when the plan has any', async () => {
		const view = await mountWith(Home, cards, { errors: [{ code: 'E005' }, { code: 'E005' }] });

		const stats = view.findAll('.stat').map(statLine);
		expect(stats).toContain('2 errors');
		expect(stats).not.toContain('✓ integrity');

		view.destroy();
	});

	it('lists connected repos that declare both a name and a path', async () => {
		const view = await mountWith(Home, cards);

		const repos = view.findAll('.repo');
		expect(repos).toHaveLength(1);
		expect(repos[0].textContent).toContain('design-system');
		expect(repos[0].textContent).toContain('../design-system');
		expect(repos[0].textContent).toContain('Shared UI');

		view.destroy();
	});

	it('renders the sync panel with its activity feed, and hides it without git', async () => {
		const sync = {
			state: 'drifted',
			marker: { synced_at: new Date(NOW - 3 * 3600 * 1000).toISOString() },
			marker_error: null,
			plan_dirty: true,
			plan_changes_since_marker: 1,
			code_commits_since_marker: 2,
			activity: [
				{
					date: new Date(NOW - 600 * 1000).toISOString(),
					subject: 'add ticket search',
					is_sync_point: false,
					cards: ['API-TICKETS', 'DB-TICKETS'],
				},
				{
					date: new Date(NOW - 7200 * 1000).toISOString(),
					subject: 'sync point',
					is_sync_point: true,
					cards: [],
				},
			],
		};

		const view = await mountWith(Home, cards, { sync });

		expect(view.find('.sd-state').textContent).toBe('Drifted');
		const meta = view.find('.sd-meta').textContent;
		expect(meta).toContain('last synced 3h ago');
		expect(meta).toContain('2 code commits / 1 plan change since');
		expect(meta).toContain('uncommitted plan edits');

		expect(view.findAll('.activity .ac-row')).toHaveLength(2);
		expect(view.find('.ac-tag').textContent).toBe('sync');
		expect(view.findAll('.ac-card').map((a) => a.getAttribute('href'))).toEqual([
			'/api/API-TICKETS',
			'/db/DB-TICKETS',
		]);

		view.destroy();

		const noGit = await mountWith(Home, cards, { sync: { state: 'no-git', activity: [] } });
		expect(noGit.find('.sync-dash')).toBeNull();
		noGit.destroy();
	});
});

describe('FeaturesPanel', () => {
	// "Shipped" = built | verified; planned / building / no status is "Up next".
	const features = [
		card('FEATURE-SEARCH', 'FEATURE', { name: 'Search', status: 'building', mtime: NOW - 1000 }),
		card('FEATURE-SLA', 'FEATURE', { name: 'SLA timers', status: 'planned', mtime: NOW - 5000 }),
		card('FEATURE-DRAFT', 'FEATURE', { name: 'Draft idea', mtime: NOW - 9000 }),
		card('FEATURE-INBOX', 'FEATURE', {
			name: 'Inbox',
			status: 'built',
			mtime: NOW - 2000,
			frontmatter: { release: 'RELEASE-1-0', branch: 'feat/inbox', pr: '42' },
		}),
		card('FEATURE-AUTH', 'FEATURE', { name: 'Auth', status: 'verified', mtime: NOW - 3000 }),
	];

	it('splits features into "Up next" and "Shipped", freshest first', async () => {
		const view = await mountWith(FeaturesPanel, features);

		const sections = view.findAll('.feat-section');
		expect(sections).toHaveLength(2);

		const titles = sections.map((s) => s.querySelector('h3').textContent.replace(/\s+/g, ' ').trim());
		expect(titles).toEqual(['Up next 3', 'Shipped 2']);

		const handlesIn = (section) =>
			[...section.querySelectorAll('.feat-handle')].map((el) => el.textContent);
		expect(handlesIn(sections[0])).toEqual(['FEATURE-SEARCH', 'FEATURE-SLA', 'FEATURE-DRAFT']);
		expect(handlesIn(sections[1])).toEqual(['FEATURE-INBOX', 'FEATURE-AUTH']);

		view.destroy();
	});

	it('renders release, branch and PR chips on a feature row', async () => {
		const view = await mountWith(FeaturesPanel, features);

		const shipped = view.findAll('.feat-section')[1];
		const chips = [...shipped.querySelectorAll('.feat-chip')].map((c) => c.textContent.trim());
		expect(chips).toEqual(['✦ RELEASE-1-0', '⎇ feat/inbox', 'PR 42']);
		expect(shipped.querySelector('a.feat-chip').getAttribute('href')).toBe('/release/RELEASE-1-0');

		view.destroy();
	});

	it('drops the Shipped section and explains itself when there is nothing', async () => {
		const unshipped = await mountWith(FeaturesPanel, [features[0]]);
		expect(unshipped.findAll('.feat-section')).toHaveLength(1);
		unshipped.destroy();

		const none = await mountWith(FeaturesPanel, [card('API-TICKETS', 'API')]);
		expect(none.element.textContent).toContain('No FEATURE cards yet');
		expect(none.findAll('.feat-section')).toHaveLength(0);
		none.destroy();
	});
});

describe('StyleGuide', () => {
	const styleCards = [
		card('STYLE-COLORS', 'STYLE', {
			name: 'Colors',
			body: 'Status colors map to ticket state.',
			frontmatter: {
				category: 'color',
				tokens: [
					{ name: 'ink', value: '#111827', description: 'Primary text' },
					{ name: 'brand', value: '#4f46e5' },
				],
			},
		}),
		card('STYLE-FONTS', 'STYLE', {
			name: 'Fonts',
			frontmatter: {
				category: 'font',
				tokens: [{ name: 'display', value: "'Inter', sans-serif", role: 'Display Font' }],
			},
		}),
		card('STYLE-SPACING', 'STYLE', {
			name: 'Spacing',
			frontmatter: {
				category: 'spacing',
				tokens: [
					{ name: 'sm', value: '0.5rem' },
					{ name: 'lg', value: '2rem' },
				],
			},
		}),
	];

	it('renders a swatch grid from a STYLE card tokens list', async () => {
		const view = await mountWith(StyleGuide, styleCards);

		const colorSection = view.findAll('.sg-section').find((s) => s.textContent.includes('Colors'));
		const swatches = colorSection.querySelectorAll('.swatch');
		expect(swatches).toHaveLength(2);
		expect(swatches[0].querySelector('.swatch-chip').getAttribute('style')).toContain('#111827');
		expect(swatches[0].textContent).toContain('ink');
		expect(swatches[0].textContent).toContain('Primary text');
		expect(colorSection.textContent).toContain('Status colors map to ticket state.');

		view.destroy();
	});

	it('orders sections font → color → spacing and links each to its card', async () => {
		const view = await mountWith(StyleGuide, styleCards);

		const sections = view.findAll('.sg-section');
		expect(sections.map((s) => s.querySelector('h2').textContent)).toEqual([
			'Fonts',
			'Colors',
			'Spacing',
		]);
		expect(sections[0].querySelector('h2 a').getAttribute('href')).toBe('/style/STYLE-FONTS');

		// Per-category layouts: a specimen for fonts, proportional bars for spacing.
		expect(sections[0].querySelector('.specimen-name').textContent).toBe('display');
		const bars = [...sections[2].querySelectorAll('.spacing-bar')].map((b) =>
			b.getAttribute('style'),
		);
		expect(bars).toEqual(['width: 25%', 'width: 100%']);

		view.destroy();
	});

	it('shows an empty state when the plan has no STYLE cards', async () => {
		const view = await mountWith(StyleGuide, [card('API-TICKETS', 'API')]);

		expect(view.element.textContent).toContain('No STYLE cards yet');
		expect(view.findAll('.sg-section')).toHaveLength(0);

		view.destroy();
	});
});
