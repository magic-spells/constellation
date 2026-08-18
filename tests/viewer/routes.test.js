// @vitest-environment jsdom
//
// The URL scheme: a card lives at `/<folder>/<HANDLE>`, mirroring its file on
// disk (constellation/api/API-TICKETS.md → #/api/API-TICKETS), and a type's list
// is `/<folder>`. Two things have to hold for that to be safe: the folder must
// be derived from the handle in exactly one place (hrefForHandle), and the URLs
// the previous scheme minted (`/card/…`, `/type/…`) must still land somewhere.
import { describe, expect, it } from 'vitest';
import { createTestApp, installFakeAnimate } from '@magic-spells/puzzle/testing';
import routes from '../../viewer/app/routes.js';
import models from '../../viewer/app/models/index.js';
import { hrefForHandle, typeForHandle } from '../../viewer/app/lib/types.js';

describe('hrefForHandle', () => {
	it('matches the LONGEST type prefix, not the first plausible one', () => {
		// The trap: DB- and DATATYPE- both start "D", and a naive prefix scan in
		// declaration order can hand a DATATYPE card the db folder.
		expect(typeForHandle('DATATYPE-TICKET')).toBe('DATATYPE');
		expect(hrefForHandle('DATATYPE-TICKET')).toBe('/datatype/DATATYPE-TICKET');
		expect(hrefForHandle('DB-TICKETS')).toBe('/db/DB-TICKETS');
	});

	it('maps each handle onto its plan folder, upper-casing the handle', () => {
		expect(hrefForHandle('API-TICKETS')).toBe('/api/API-TICKETS');
		expect(hrefForHandle('api-tickets')).toBe('/api/API-TICKETS');
		expect(hrefForHandle('PLAN-PROJECT')).toBe('/plan/PLAN-PROJECT');
	});

	it('sends a handle with no known type prefix to the overview', () => {
		expect(typeForHandle('NOPE-THING')).toBeNull();
		expect(hrefForHandle('NOPE-THING')).toBe('/');
		expect(hrefForHandle('')).toBe('/');
	});
});

describe('legacy route redirects', () => {
	/** A real app on the memory router — guards only run inside one. */
	async function bootAt(path) {
		const animate = installFakeAnimate();
		const app = await createTestApp({ routes, models, routerInitialPath: '/' });
		await app.router.push(path);
		return {
			path: app.router.current?.path,
			name: app.router.current?.route?.name,
			done: () => {
				app.destroy();
				animate.uninstall();
			},
		};
	}

	it('redirects /card/:handle to the handle folder route', async () => {
		const nav = await bootAt('/card/API-TICKETS');
		expect(nav.path).toBe('/api/API-TICKETS');
		nav.done();
	});

	it('upper-cases the handle on the way through', async () => {
		const nav = await bootAt('/card/doc-lint-codes');
		expect(nav.path).toBe('/doc/DOC-LINT-CODES');
		nav.done();
	});

	it('redirects /type/:folder to the bare folder route', async () => {
		const nav = await bootAt('/type/api');
		expect(nav.path).toBe('/api');
		nav.done();
	});

	it('sends an unroutable legacy handle home rather than nowhere', async () => {
		const nav = await bootAt('/card/NOPE-THING');
		expect(nav.path).toBe('/');
		nav.done();
	});

	// Routes match in ORDER, and `/:folder/:handle` would happily eat
	// `/docs/getting-started` — so the document's own pair has to come first.
	it('routes /docs and /docs/:section rather than letting the folder pair eat them', async () => {
		const doc = await bootAt('/docs');
		expect(doc.name).toBe('docs');
		doc.done();

		const section = await bootAt('/docs/getting-started');
		expect(section.name).toBe('docs-section');
		section.done();
	});
});
