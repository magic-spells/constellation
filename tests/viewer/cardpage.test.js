// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mountView, settled } from '@magic-spells/puzzle/testing';
import CardPage from '../../viewer/app/views/CardPage.pzl';
import MarkdownBlock from '../../viewer/app/components/MarkdownBlock.pzl';
import models from '../../viewer/app/models/index.js';

const card = {
	handle: 'API-ALPHA',
	type: 'API',
	kind: 'http',
	name: 'Alpha endpoint',
	status: 'built',
	frontmatter: {
		name: 'Alpha endpoint',
		kind: 'http',
		status: 'built',
		response_schema: 'DATATYPE-ALPHA',
		method: 'GET',
		examples: [{ status: 200, schema: 'DATATYPE-ALPHA' }],
	},
	body: 'Read [[DOC-ALPHA]] before changing this endpoint.',
};

const neighbors = [
	{
		handle: 'DATATYPE-ALPHA',
		type: 'DATATYPE',
		name: 'Alpha response',
		frontmatter: { name: 'Alpha response' },
	},
];

async function mountCardPage(handle = 'api-alpha') {
	const view = await mountView(CardPage, {
		params: { folder: 'api', handle },
		route: { params: { folder: 'api', handle } },
		models,
	});

	view.store.createRecord('card', card);
	for (const neighbor of neighbors) view.store.createRecord('card', neighbor);
	view.store.createRecord('plan', {
		id: 'plan',
		generation: 1,
		connections: [{ a: 'API-ALPHA', b: 'DATATYPE-ALPHA' }],
	});
	await settled();

	return view;
}

describe('CardPage read path', () => {
	it('renders a seeded card name, fields, and grouped connection chips', async () => {
		const view = await mountCardPage();

		expect(view.element.textContent).toContain('Alpha endpoint');
		expect(view.element.textContent).toContain('response_schema');
		expect(view.element.textContent).toContain('GET');
		expect(view.element.textContent).toContain('200');
		const schemaChip = view.find('a[href="/datatype/DATATYPE-ALPHA"]');
		expect(schemaChip?.textContent).toContain('DATATYPE-ALPHA');
		expect(view.element.textContent).toContain('Data types');

		view.destroy();
	});

	it('renders a body wikilink as an anchor with the wiki class', async () => {
		const view = await mountCardPage();

		const wikilink = view.find('a.wiki');
		expect(wikilink?.textContent).toBe('DOC-ALPHA');
		expect(wikilink?.getAttribute('href')).toBe('#/doc/DOC-ALPHA');

		view.destroy();
	});

	it('renders the empty state for an unknown handle', async () => {
		const view = await mountCardPage('api-missing');

		expect(view.element.textContent).toContain('API-MISSING is not in this plan.');

		view.destroy();
	});
});

describe('MarkdownBlock', () => {
	it('re-renders its island when the src prop changes', async () => {
		const view = await mountView(MarkdownBlock, { props: { src: 'First' } });
		expect(view.element.textContent).toContain('First');

		await view.setProps({ src: 'Second [[DOC-ALPHA]]' });
		expect(view.element.textContent).not.toContain('First');
		expect(view.find('a.wiki')?.textContent).toBe('DOC-ALPHA');

		view.destroy();
	});
});
