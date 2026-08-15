// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mountView, settled } from '@magic-spells/puzzle/testing';
import Home from '../../viewer/app/views/Home.pzl';
import BoardPage from '../../viewer/app/views/BoardPage.pzl';
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

	/** "4 cards" — the number and label of one health-strip chip, as one line. */
	const chipLine = (el) =>
		`${el.querySelector('.hs-n').textContent} ${el.querySelector('.hs-label').textContent}`;

	it('counts the plan in the health strip, and renders the plan body', async () => {
		const view = await mountWith(Home, cards, {
			connections: [{ a: 'API-TICKETS', b: 'DB-TICKETS' }],
			warnings: [{ code: 'W004' }],
		});

		const chips = view.findAll('.hs-chip').map(chipLine);
		expect(chips).toContain('4 cards');
		expect(chips).toContain('1 connections');
		expect(chips).toContain('clean integrity');
		expect(chips).toContain('1 warning');

		// The type tile grid is gone on purpose — the sidebar already lists every
		// type with the same counts.
		expect(view.findAll('.tile')).toHaveLength(0);

		expect(view.element.textContent).toContain('A support desk.');

		view.destroy();
	});

	it('counts lint errors instead of integrity when the plan has any', async () => {
		const view = await mountWith(Home, cards, { errors: [{ code: 'E005' }, { code: 'E005' }] });

		const chips = view.findAll('.hs-chip').map(chipLine);
		expect(chips).toContain('2 errors');
		expect(chips).not.toContain('clean integrity');
		expect(view.find('.hs-chip.bad')).toBeTruthy();

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

	it('states the sync verdict in the strip, and drops it without git', async () => {
		const sync = {
			state: 'drifted',
			marker: { synced_at: new Date(NOW - 3 * 3600 * 1000).toISOString() },
			marker_error: null,
			plan_dirty: true,
			plan_changes_since_marker: 1,
			code_commits_since_marker: 2,
			activity: [],
		};

		const view = await mountWith(Home, cards, { sync });

		expect(view.find('.hs-state-label').textContent).toBe('Drifted');
		expect(view.find('.hs-state').className).toContain('warn');
		const meta = view.find('.hs-meta').textContent;
		expect(meta).toContain('last synced 3h ago');
		expect(meta).toContain('2 code commits / 1 plan change since');
		expect(meta).toContain('uncommitted plan edits');
		// A drifted plan already has a marker, so the button offers to move it.
		expect(view.element.textContent).toContain('Update sync point');

		view.destroy();

		// no-git keeps the counts but loses the verdict and the action.
		const noGit = await mountWith(Home, cards, { sync: { state: 'no-git', activity: [] } });
		expect(noGit.find('.health')).toBeTruthy();
		expect(noGit.find('.hs-state')).toBeNull();
		expect(noGit.element.textContent).not.toContain('sync point');
		noGit.destroy();
	});

	it('offers to stamp a first sync point when the plan has never been synced', async () => {
		const view = await mountWith(Home, cards, {
			sync: { state: 'never-synced', marker: null, activity: [], code_activity: [] },
		});

		expect(view.find('.hs-state-label').textContent).toBe('Not synced');
		expect(view.find('.hs-meta').textContent).toContain('no sync point yet');
		expect(view.element.textContent).toContain('Set sync point');

		view.destroy();
	});

	it('interleaves plan and code commits in one activity panel', async () => {
		const view = await mountWith(Home, cards, {
			sync: {
				state: 'in-sync',
				marker: null,
				activity: [
					{
						sha: 'p1',
						date: new Date(NOW - 600 * 1000).toISOString(),
						subject: 'add ticket search',
						is_sync_point: false,
						cards: ['API-TICKETS', 'DB-TICKETS'],
					},
					{
						sha: 'p2',
						date: new Date(NOW - 7200 * 1000).toISOString(),
						subject: 'sync point',
						is_sync_point: true,
						cards: [],
					},
				],
				code_activity: [
					{
						sha: 'c1',
						date: new Date(NOW - 3600 * 1000).toISOString(),
						subject: 'feat: shiny',
						cards: [],
						is_sync_point: false,
					},
				],
			},
		});

		const rows = view.findAll('.act-rows .act-row');
		expect(rows).toHaveLength(3);
		// Newest first regardless of which stream it came from.
		expect(rows.map((r) => r.querySelector('.a-subject').textContent)).toEqual([
			'add ticket search',
			'feat: shiny',
			'sync point',
		]);
		expect(rows.map((r) => r.querySelector('.a-kind').textContent.trim())).toEqual([
			'plan',
			'code',
			'plan',
		]);
		expect(view.find('.a-tag').textContent).toBe('sync');
		expect(view.findAll('.a-card').map((a) => a.getAttribute('href'))).toEqual([
			'/api/API-TICKETS',
			'/db/DB-TICKETS',
		]);

		view.destroy();
	});

	it('renders the release timeline, grouped by change kind', async () => {
		const view = await mountWith(Home, [
			card('PLAN-PROJECT', 'PLAN', { body: '# P' }),
			card('RELEASE-V0-5-0', 'RELEASE', {
				name: 'v0.5.0 — Viewer',
				status: 'building',
				frontmatter: { version: '0.5.0' },
			}),
			card('RELEASE-V0-4-0', 'RELEASE', {
				name: 'v0.4.0 — Memory',
				status: 'built',
				frontmatter: { version: '0.4.0' },
			}),
			card('FEATURE-VIEWER', 'FEATURE', {
				name: 'Puzzle viewer',
				status: 'built',
				frontmatter: { release: 'RELEASE-V0-5-0' },
			}),
			card('FEATURE-DROP-SVELTE', 'FEATURE', {
				name: 'Svelte viewer removed',
				status: 'built',
				frontmatter: { release: 'RELEASE-V0-5-0', change: 'breaking' },
			}),
			card('FEATURE-OLD', 'FEATURE', {
				name: 'Notes',
				status: 'built',
				frontmatter: { release: 'RELEASE-V0-4-0' },
			}),
		], {
			sync: {
				state: 'in-sync',
				marker: null,
				activity: [],
				code_activity: [],
				latest_tag: 'v0.4.0',
				package_version: '0.5.0',
			},
		});

		const text = view.element.textContent;
		expect(text).toContain('v0.4.0 tagged');
		expect(text).toContain('0.5.0 in package.json');

		// Every release is listed; only the in-flight one starts expanded.
		const items = view.findAll('.rel-item');
		expect(items).toHaveLength(2);
		expect(items[0].className).toContain('current');
		expect(items[0].querySelector('.rel-toggle').getAttribute('aria-expanded')).toBe('true');
		expect(items[1].querySelector('.rel-toggle').getAttribute('aria-expanded')).toBe('false');
		expect(items[1].querySelector('.rel-body')).toBeNull();

		// Breaking comes first and is called out on the header too.
		expect(items[0].querySelector('.rel-breaking').textContent).toContain('1 breaking');
		const groups = [...items[0].querySelectorAll('.rel-group-label')];
		// label + count, rendered as adjacent spans with no separator
		expect(groups.map((g) => g.textContent.replace(/\s+/g, ''))).toEqual([
			'Breaking1',
			'Features1',
		]);
		expect(items[0].textContent).toContain('2 of 2 features shipped');

		// The shipped one says so, with its tag.
		expect(items[1].querySelector('.rel-tagged')).toBeTruthy();
		expect(items[1].querySelector('.rel-summary').textContent).toBe('1 feature');

		// Expanding a shipped release opens its body in place.
		items[1].querySelector('.rel-toggle').click();
		await settled();
		expect(view.findAll('.rel-item')[1].querySelector('.rel-body')).toBeTruthy();

		view.destroy();
	});

	it('leads the drift panel with a verdict and collapses unbaselined claims', async () => {
		const view = await mountWith(Home, [
			card('PLAN-PROJECT', 'PLAN', { body: '# P' }),
			card('API-TICKETS', 'API', {
				frontmatter: { notes: [{ kind: 'gotcha', text: 'watch the lock' }] },
			}),
		], {
			sync: {
				state: 'never-synced',
				marker: null,
				activity: [],
				code_activity: [],
				stale: {
					checked: 49,
					stale: [],
					no_baseline: Array.from({ length: 49 }, (_, i) => ({
						handle: `FILE-${i}`,
						status: 'built',
						files: ['src/x.ts'],
					})),
				},
			},
		});

		// The regression this rework exists to fix: 49 claims used to render as 49
		// rows. They are one line now, with the fix in it.
		expect(view.findAll('.drift-row')).toHaveLength(0);
		const untracked = view.find('.d-untracked');
		expect(untracked.textContent).toContain('49');
		expect(untracked.textContent).toContain('commit them');
		expect(view.find('.d-head').textContent).toContain('nothing tracked yet');
		expect(view.find('.d-head').className).toContain('muted');

		// Notes carry a relative time, inferred from the card's mtime.
		expect(view.element.textContent).toContain('watch the lock');
		expect(view.find('.note-row .n-when').textContent.trim()).not.toBe('');

		view.destroy();
	});

	it('names the cards that actually drifted, capped, with the overflow counted', async () => {
		const stale = Array.from({ length: 8 }, (_, i) => ({
			handle: `API-${i}`,
			name: `api ${i}`,
			status: 'verified',
			baseline: 'abc123',
			baseline_source: 'verified_sha',
			changed_files: ['src/a.ts'],
			missing_files: [],
		}));
		const view = await mountWith(Home, [card('PLAN-PROJECT', 'PLAN', { body: '# P' })], {
			sync: {
				state: 'drifted',
				marker: { synced_sha: 'abc123', synced_at: new Date(NOW).toISOString() },
				activity: [],
				code_activity: [],
				stale: { checked: 8, stale, no_baseline: [] },
			},
		});

		expect(view.find('.d-head').className).toContain('warn');
		expect(view.find('.d-head').textContent).toContain('8 of 8 claims drifted');
		expect(view.findAll('.drift-row')).toHaveLength(6);
		expect(view.find('.d-overflow').textContent).toContain('+2 more');
		expect(view.find('.drift-row .d-meta').textContent).toContain('since verify');

		view.destroy();
	});

	it('hides the drift panel without git data', async () => {
		const view = await mountWith(Home, [card('PLAN-PROJECT', 'PLAN', { body: '# P' })], {
			sync: null,
		});

		expect(view.find('.panel-drift')).toBeNull();
		// Release, Activity and Notes still render — their empty states teach the
		// features they are for.
		expect(view.find('.panel-release')).toBeTruthy();
		expect(view.find('.panel-activity')).toBeTruthy();
		expect(view.find('.panel-notes')).toBeTruthy();

		view.destroy();
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

describe('BoardPage', () => {
	// One feature per column, plus the unset-status case that Planned adopts.
	const features = [
		card('FEATURE-SEARCH', 'FEATURE', {
			name: 'Search',
			status: 'building',
			mtime: NOW - 1000,
			body: '# Search\n\nFull-text search across every [[CARD]] body and note.',
		}),
		card('FEATURE-SLA', 'FEATURE', { name: 'SLA timers', status: 'planned', mtime: NOW - 5000 }),
		card('FEATURE-DRAFT', 'FEATURE', { name: 'Draft idea', mtime: NOW - 9000 }),
		card('FEATURE-INBOX', 'FEATURE', { name: 'Inbox', status: 'built', mtime: NOW - 2000 }),
		card('FEATURE-AUTH', 'FEATURE', { name: 'Auth', status: 'verified', mtime: NOW - 3000 }),
	];

	/** Column id → the handles rendered in it, in order. */
	const byColumn = (view) =>
		Object.fromEntries(
			view.findAll('[data-kb-col]').map((col) => [
				col.getAttribute('data-kb-col'),
				[...col.querySelectorAll('[data-kb-card]')].map((c) => c.getAttribute('data-kb-card')),
			]),
		);

	it('lays every FEATURE card out in its status column, freshest first', async () => {
		const view = await mountWith(BoardPage, [...features, card('API-TICKETS', 'API')]);

		const columns = view.findAll('[data-kb-col]');
		expect(columns.map((c) => c.querySelector('h3').textContent)).toEqual([
			'Planned',
			'Building',
			'Built',
			'Verified',
		]);

		// A status-less card is future work, so Planned adopts it — after the
		// freshest planned card, since columns sort by mtime like FeaturesPanel.
		expect(byColumn(view)).toEqual({
			planned: ['FEATURE-SLA', 'FEATURE-DRAFT'],
			building: ['FEATURE-SEARCH'],
			built: ['FEATURE-INBOX'],
			verified: ['FEATURE-AUTH'],
		});

		// Counts sit in the column header next to the title.
		const planned = columns[0];
		expect(planned.querySelector('header span:last-child').textContent).toBe('2');

		view.destroy();
	});

	it('links a card to its card page and summarises its body', async () => {
		const view = await mountWith(BoardPage, features);

		const building = view.find('[data-kb-col="building"] [data-kb-card]');
		expect(building.getAttribute('href')).toBe('/feature/FEATURE-SEARCH');
		expect(building.textContent).toContain('Search');
		expect(building.textContent).toContain('FEATURE-SEARCH');
		// First real paragraph only — the heading is skipped and [[CARD]] unwrapped.
		expect(building.textContent).toContain('Full-text search across every CARD body');
		expect(building.textContent).not.toContain('[[');

		view.destroy();
	});

	it('joins a hard-wrapped paragraph before clamping it', async () => {
		// Every FEATURE body in this repo wraps its opening paragraph, so a summary
		// that stopped at the first newline would cut the sentence mid-clause and
		// leave the clamp nothing to do.
		const view = await mountWith(BoardPage, [
			card('FEATURE-SLA', 'FEATURE', {
				name: 'SLA timers',
				status: 'planned',
				mtime: NOW,
				body: '# SLA timers\n\nPause the clock while a ticket waits\non the customer.\n\n- out of scope: business hours\n',
			}),
			card('FEATURE-ASSIGN', 'FEATURE', {
				name: 'Auto assignment',
				status: 'planned',
				mtime: NOW - 1000,
				body:
					'Route each new ticket to the on-call agent for its queue, so the\n' +
					'median first-response time stops depending on who happens to be\n' +
					'watching the inbox.\n',
			}),
		]);

		const [wrapped, long] = view.findAll('[data-kb-col="planned"] [data-kb-card] p');

		// Joined across the line break, and the list below it is not the paragraph.
		expect(wrapped.textContent).toBe('Pause the clock while a ticket waits on the customer.');

		// Long enough to clamp — which only happens because the lines were joined
		// first. The cut lands on a word boundary, so no word is left half-written.
		expect(long.textContent).toContain('median first-response time stops depending');
		expect(long.textContent.endsWith('…')).toBe(true);
		expect(long.textContent).not.toContain('watching the inbox');
		expect(long.textContent.length).toBeLessThanOrEqual(121);
		expect(long.textContent).not.toMatch(/\s…$/);

		view.destroy();
	});

	it('skips a fenced block whole rather than summarising its interior', async () => {
		const view = await mountWith(BoardPage, [
			card('FEATURE-BOARD', 'FEATURE', {
				name: 'Board',
				status: 'planned',
				body: '# Board\n\n```yaml\nstatus: planned\n```\n\nEvery FEATURE card as a Kanban board.\n',
			}),
		]);

		const summary = view.find('[data-kb-card] p');
		expect(summary.textContent).toBe('Every FEATURE card as a Kanban board.');
		expect(view.element.textContent).not.toContain('status: planned');

		view.destroy();
	});

	it('marks a card with no status instead of letting it read as planned', async () => {
		const view = await mountWith(BoardPage, features);

		const planned = view.findAll('[data-kb-col="planned"] [data-kb-card]');
		expect(planned[0].textContent).not.toContain('no status');
		expect(planned[1].textContent).toContain('no status');

		view.destroy();
	});

	it('lands an unrecognised status in Planned rather than off the board', async () => {
		const view = await mountWith(BoardPage, [
			card('FEATURE-ODD', 'FEATURE', { name: 'Odd one', status: 'shipped' }),
		]);

		expect(byColumn(view)).toEqual({
			planned: ['FEATURE-ODD'],
			building: [],
			built: [],
			verified: [],
		});
		// The status IS set, so it gets no "no status" pill — only the column is a
		// fallback.
		expect(view.find('[data-kb-card]').textContent).not.toContain('no status');

		view.destroy();
	});

	it('is read-only: no card is draggable or focusable as a control', async () => {
		const view = await mountWith(BoardPage, features);

		const cards = view.findAll('[data-kb-card]');
		expect(cards).toHaveLength(5);
		for (const el of cards) {
			expect(el.tagName.toLowerCase()).toBe('a');
			expect(el.getAttribute('role')).toBeNull();
			expect(el.getAttribute('aria-grabbed')).toBeNull();
		}

		view.destroy();
	});

	it('gives an empty column a quiet hint and an empty plan a real empty state', async () => {
		const oneCard = await mountWith(BoardPage, [features[0]]);
		const hints = oneCard.findAll('[data-kb-empty]').map((el) => el.textContent);
		expect(hints).toEqual(['Nothing queued.', 'Nothing built yet.', 'Nothing verified yet.']);
		oneCard.destroy();

		const none = await mountWith(BoardPage, [card('API-TICKETS', 'API')]);
		expect(none.element.textContent).toContain('No FEATURE cards yet');
		expect(none.findAll('[data-kb-col]')).toHaveLength(0);
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
