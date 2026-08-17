// @vitest-environment jsdom
//
// The viewer half of the compiled document: link resolution, the TOC tree, and
// the scroll-spy rule. Ordering and heading levels are the server's job and are
// covered in tests/docs.test.ts — nothing here re-decides them.
import { describe, expect, it } from 'vitest';
import { installFakeAnimate, mountView, settled } from '@magic-spells/puzzle/testing';
import AppShell from '../../viewer/app/layouts/AppShell.pzl';
import DocsPage from '../../viewer/app/views/DocsPage.pzl';
import DocsToc from '../../viewer/app/components/DocsToc.pzl';
import models from '../../viewer/app/models/index.js';
import { anchorAt, sectionAnchor, tocTree } from '../../viewer/app/lib/docs.js';
import { renderDocMarkdown, renderMarkdown } from '../../viewer/app/lib/markdown.js';

const SECTIONS = [
	{
		id: 'overview',
		name: 'Overview',
		summary: 'What this is.',
		cards: [
			{
				handle: 'DOC-INTRO',
				name: 'Introduction',
				type: 'DOC',
				body: 'Start with [[DOC-DETAIL]], then [[API-TICKETS]].\n\n#### Notes\n\nMore.',
			},
			{ handle: 'DOC-DETAIL', name: 'The detail', type: 'DOC', body: 'Detail.' },
		],
	},
	{
		id: 'reference',
		name: 'Reference',
		summary: '',
		cards: [{ handle: 'DB-TICKETS', name: 'Tickets table', type: 'DB', body: 'Columns.' }],
	},
];

/** Mount a docs view against a store holding a compiled document. */
async function mountDocs(View, { route, props, docs = { title: 'Ticketing', sections: SECTIONS } } = {}) {
	const view = await mountView(View, { models, route: route ?? { params: {} }, props });
	view.store.createRecord('plan', {
		id: 'plan',
		generation: 1,
		editable: true,
		errors: [],
		warnings: [],
		connections: [],
		sync: { package_version: '9.9.9' },
		docs,
	});
	await settled();
	return view;
}

describe('[[HANDLE]] resolution inside the document', () => {
	it('anchors a target that is on the page and routes one that is not', () => {
		const html = renderDocMarkdown(
			'see [[DOC-DETAIL]] and [[API-TICKETS]]',
			new Set(['DOC-INTRO', 'DOC-DETAIL']),
			'/docs',
		);

		// In the document: an in-page anchor, riding as a second fragment because
		// the router owns the first one.
		expect(html).toContain('href="#/docs#DOC-DETAIL"');
		// Out of it: the card's own route, exactly as anywhere else in the viewer.
		expect(html).toContain('href="#/api/API-TICKETS"');
	});

	it('anchors within the soloed section on /docs/:section', () => {
		const html = renderDocMarkdown('[[DOC-DETAIL]]', ['DOC-DETAIL'], '/docs/overview');
		expect(html).toContain('href="#/docs/overview#DOC-DETAIL"');
	});

	it('leaves the ordinary renderer alone once the document parse is done', () => {
		renderDocMarkdown('[[DOC-DETAIL]]', ['DOC-DETAIL']);
		expect(renderMarkdown('[[DOC-DETAIL]]')).toContain('href="#/doc/DOC-DETAIL"');
	});
});

describe('tocTree', () => {
	it('anchors every row within the document being read', () => {
		const tree = tocTree(SECTIONS);

		expect(tree.map((s) => s.href)).toEqual(['/docs#section-overview', '/docs#section-reference']);
		expect(tree[0].cards.map((c) => c.href)).toEqual([
			'/docs#DOC-INTRO',
			'/docs#DOC-DETAIL',
		]);
	});

	it('keeps a soloed section in-page and sends the others to their own page', () => {
		const tree = tocTree(SECTIONS, { base: '/docs/overview', solo: 'overview' });

		expect(tree[0].href).toBe('/docs/overview#section-overview');
		expect(tree[0].cards[0].href).toBe('/docs/overview#DOC-INTRO');
		// A section you are not reading is a destination, not an anchor.
		expect(tree[1].href).toBe('/docs/reference');
		expect(tree[1].cards[0].href).toBe('/docs/reference#DB-TICKETS');
	});
});

describe('anchorAt', () => {
	const anchors = [
		{ id: 'section-overview', top: 0 },
		{ id: 'DOC-INTRO', top: 100 },
		{ id: 'DOC-DETAIL', top: 400 },
	];

	it('picks the last anchor the reading line has passed', () => {
		expect(anchorAt(anchors, 0)).toBe('section-overview');
		expect(anchorAt(anchors, 99)).toBe('section-overview');
		expect(anchorAt(anchors, 100)).toBe('DOC-INTRO');
		expect(anchorAt(anchors, 399)).toBe('DOC-INTRO');
		expect(anchorAt(anchors, 4000)).toBe('DOC-DETAIL');
	});

	it('gives the end of the scroll to the first anchor still below the line', () => {
		// The trap: past the bottom nothing can ever pass the reading line again,
		// so a final card too short to reach it would leave the TOC highlighting
		// the card above it — including right after you clicked that final card.
		expect(anchorAt(anchors, 120, true)).toBe('DOC-DETAIL');
	});

	it('falls back to the normal walk when the bottom is inside the last anchor', () => {
		expect(anchorAt(anchors, 900, true)).toBe('DOC-DETAIL');
	});

	it('has nothing to say about an empty document', () => {
		expect(anchorAt([], 0)).toBe('');
	});
});

describe('DocsPage', () => {
	it('frames the document: title, imprint, section headings, per-card anchors', async () => {
		const view = await mountDocs(DocsPage);

		expect(view.find('.docs-title').textContent).toBe('Ticketing');
		expect(view.find('.docs-imprint').textContent).toContain('v9.9.9');

		expect(view.findAll('.docs-section-title').map((el) => el.id)).toEqual([
			sectionAnchor('overview'),
			sectionAnchor('reference'),
		]);
		expect(view.findAll('[data-doc-anchor]').map((el) => el.id)).toEqual([
			'DOC-INTRO',
			'DOC-DETAIL',
			'DB-TICKETS',
		]);
		expect(view.find('.docs-section-summary').textContent).toBe('What this is.');

		view.destroy();
	});

	it('links each card heading back to its own card page, read-only', async () => {
		const view = await mountDocs(DocsPage);

		const source = view.find('.docs-card-source');
		expect(source.getAttribute('href')).toBe('/doc/DOC-INTRO');
		// Nothing on the page edits: the only control is the TOC's jump select.
		expect(view.findAll('input')).toHaveLength(0);
		expect(view.findAll('textarea')).toHaveLength(0);
		expect(view.findAll('[contenteditable]')).toHaveLength(0);

		view.destroy();
	});

	it('lays the document out centred, with the contents in the gutter beside it', async () => {
		const view = await mountDocs(DocsPage);

		// Three-track grid, and the two are placed by CSS grid-column rather than
		// by source order — a hidden rail must not slide the column into track 1.
		expect(view.find('.docs-grid')).toBeTruthy();
		expect(view.find('.docs-grid > .docs-rail .dtoc')).toBeTruthy();
		expect(view.find('.docs-grid > .docs-column')).toBeTruthy();
		// The jump control lives INSIDE the column, so it cannot shift it either.
		expect(view.find('.docs-column .docs-compact')).toBeTruthy();

		view.destroy();
	});

	it('renders one section on /docs/:section, and anchors only its own cards', async () => {
		const view = await mountDocs(DocsPage, { route: { params: { section: 'overview' } } });

		expect(view.findAll('.docs-section-title')).toHaveLength(1);
		expect(view.findAll('[data-doc-anchor]').map((el) => el.id)).toEqual([
			'DOC-INTRO',
			'DOC-DETAIL',
		]);

		const links = [...view.element.querySelectorAll('.md-block a.wiki')].map((a) =>
			a.getAttribute('href'),
		);
		expect(links).toContain('#/docs/overview#DOC-DETAIL');
		expect(links).toContain('#/api/API-TICKETS');

		view.destroy();
	});

	it('teaches the feature when no card carries a section', async () => {
		const view = await mountDocs(DocsPage, { docs: { title: 'Bare', sections: [] } });

		expect(view.element.textContent).toContain('No documentation yet');
		expect(view.findAll('.docs-section')).toHaveLength(0);

		view.destroy();
	});

	it('says so when the URL names a section that does not exist', async () => {
		const view = await mountDocs(DocsPage, { route: { params: { section: 'nope' } } });

		expect(view.element.textContent).toContain('No such section');
		expect(view.element.textContent).toContain('section: nope');

		view.destroy();
	});
});

describe('AppShell wiring', () => {
	it('gives Documentation a top-rail row beside Tasks', async () => {
		const animate = installFakeAnimate();
		const view = await mountDocs(AppShell, {
			route: { params: {}, pathname: '/docs', route: { name: 'docs' } },
		});

		const rows = view.findAll('nav a, [role="navigation"] a').map((a) => a.textContent.trim());
		expect(rows.slice(0, 4)).toEqual(['Overview', 'Tasks', 'Documentation', 'Constellation']);

		view.destroy();
		animate.uninstall();
	});

	it('opts /docs out of the split entirely rather than leaving an empty pane', async () => {
		const animate = installFakeAnimate();
		const view = await mountDocs(AppShell, {
			route: { params: {}, pathname: '/docs', route: { name: 'docs' } },
		});

		// A list pane here would push the document off-centre, which is the one
		// thing the docs layout must not do. The route takes the `wide` shape:
		// the panel is collapsed to [0, 100] with its divider hidden.
		expect(view.find('.shell-pane-list .clist')).toBeNull();
		expect(view.find('.shell-pane-list').children).toHaveLength(0);
		expect(view.find('.shell-flat')).toBeTruthy();

		view.destroy();
		animate.uninstall();
	});

	it('still gives a card route its list pane', async () => {
		const animate = installFakeAnimate();
		const view = await mountDocs(AppShell, {
			route: { params: { folder: 'doc' }, pathname: '/doc', route: { name: 'type-list' } },
		});

		expect(view.find('.shell-pane-list .clist')).toBeTruthy();
		expect(view.find('.shell-flat')).toBeNull();

		view.destroy();
		animate.uninstall();
	});
});

describe('DocsToc', () => {
	it('is two levels, section then card, with every card clickable', async () => {
		const view = await mountDocs(DocsToc, { props: { variant: 'rail', solo: '' } });

		expect(view.findAll('.dtoc-section').map((el) => el.textContent)).toEqual([
			'Overview',
			'Reference',
		]);
		expect(view.findAll('.dtoc-card').map((el) => el.getAttribute('href'))).toEqual([
			'/docs#DOC-INTRO',
			'/docs#DOC-DETAIL',
			'/docs#DB-TICKETS',
		]);

		view.destroy();
	});

	it('is marginalia, not a pane: no border, fill or divider', async () => {
		const view = await mountDocs(DocsToc, { props: { variant: 'rail', solo: '' } });

		const nav = view.find('.dtoc');
		expect(nav.className).not.toMatch(/border|bg-surface/);

		view.destroy();
	});

	it('keeps listing the whole document while one section is soloed', async () => {
		const view = await mountDocs(DocsToc, { props: { variant: 'rail', solo: 'reference' } });

		// Every section stays reachable — the soloed one anchors in place, the
		// others become links to their own page — plus a way back to the whole.
		expect(view.findAll('.dtoc-section').map((el) => el.getAttribute('href'))).toEqual([
			'/docs/overview',
			'/docs/reference#section-reference',
		]);
		expect(view.find('.dtoc-all').getAttribute('href')).toBe('/docs');

		view.destroy();
	});

	it('renders the same tree as a jump control for a narrow gutter', async () => {
		const view = await mountDocs(DocsToc, { props: { variant: 'compact', solo: '' } });

		expect(view.find('.dtoc')).toBeNull();
		const options = view.findAll('option');
		expect(options[0].value).toBe('');
		expect(options.map((o) => [o.value, o.textContent.trim()]).slice(1)).toEqual([
			['/docs#section-overview', 'Overview'],
			['/docs#DOC-INTRO', 'Introduction'],
			['/docs#DOC-DETAIL', 'The detail'],
			['/docs#section-reference', 'Reference'],
			['/docs#DB-TICKETS', 'Tickets table'],
		]);
		// Both levels are there, and the cards are indented under their section.
		expect(options[2].textContent.startsWith(options[2].textContent.trim())).toBe(false);
		expect(options[1].textContent.startsWith(options[1].textContent.trim())).toBe(true);

		view.destroy();
	});

	it('highlights the anchor the document publishes as it scrolls', async () => {
		const view = await mountDocs(DocsToc, { props: { variant: 'rail', solo: '' } });
		const { setActiveDocAnchor } = await import('../../viewer/app/lib/docs.js');

		setActiveDocAnchor('DOC-DETAIL');
		await settled();

		const active = view.findAll('.is-active');
		expect(active).toHaveLength(1);
		expect(active[0].getAttribute('href')).toBe('/docs#DOC-DETAIL');

		setActiveDocAnchor('');
		view.destroy();
	});
});
