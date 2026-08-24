import { beforeEach, describe, expect, it } from 'vitest';
import {
	activePlanId,
	apiBaseFor,
	eventsUrlFor,
	planFromHash,
	routerBaseFor,
	setActivePlanId,
} from '../../viewer/app/lib/plans.js';

// Plan addressing is the one part of multi-plan serving that has to agree with
// three different encoders at once — the router's hash base, the API prefix and
// the SSE URL — so it lives in a plain-JS module and is pinned here. `null`
// everywhere means "the default plan", i.e. the single-plan URLs, and those
// cases are the back-compat contract: they must not acquire a prefix.

beforeEach(() => {
	setActivePlanId(null);
});

describe('planFromHash', () => {
	it('reads the plan id out of a plan-scoped route', () => {
		expect(planFromHash('#/p/puzzle/api/API-TICKETS')).toBe('puzzle');
	});

	it('reads a bare plan root, with or without the trailing slash', () => {
		expect(planFromHash('#/p/puzzle')).toBe('puzzle');
		expect(planFromHash('#/p/puzzle/')).toBe('puzzle');
	});

	it('reads a plan root carrying a query', () => {
		expect(planFromHash('#/p/puzzle?q=cards')).toBe('puzzle');
	});

	it('returns null for an unscoped route', () => {
		expect(planFromHash('#/api/API-TICKETS')).toBeNull();
		expect(planFromHash('#/')).toBeNull();
	});

	it('returns null for an empty or absent fragment', () => {
		expect(planFromHash('')).toBeNull();
		expect(planFromHash('#')).toBeNull();
		expect(planFromHash(undefined)).toBeNull();
		expect(planFromHash(null)).toBeNull();
	});

	it('returns null when the id segment is missing', () => {
		expect(planFromHash('#/p')).toBeNull();
		expect(planFromHash('#/p/')).toBeNull();
	});

	it('does not match a `p` segment that is not at the root', () => {
		// A card page for a folder called `p` is a route, not a plan base.
		expect(planFromHash('#/api/p/puzzle')).toBeNull();
	});

	it('does not treat a bare in-page anchor as a plan', () => {
		expect(planFromHash('#DOC-OVERVIEW')).toBeNull();
	});
});

describe('routerBaseFor', () => {
	it('bases a plan under /p/<id>', () => {
		expect(routerBaseFor('puzzle')).toBe('/p/puzzle');
	});

	it('is empty for the default plan, so hashes stay unprefixed', () => {
		expect(routerBaseFor(null)).toBe('');
		expect(routerBaseFor(undefined)).toBe('');
		expect(routerBaseFor('')).toBe('');
	});

	it('round-trips with planFromHash', () => {
		expect(planFromHash(`#${routerBaseFor('puzzle')}/api/X`)).toBe('puzzle');
	});
});

describe('apiBaseFor', () => {
	it('prefixes a plan API under /api/p/<id>', () => {
		expect(apiBaseFor('puzzle')).toBe('/api/p/puzzle');
	});

	it('falls back to the unprefixed /api for the default plan', () => {
		expect(apiBaseFor(null)).toBe('/api');
		expect(apiBaseFor('')).toBe('/api');
	});
});

describe('eventsUrlFor', () => {
	it('puts a plan stream under its API prefix', () => {
		expect(eventsUrlFor('puzzle')).toBe('/api/p/puzzle/events');
	});

	// Deliberately NOT '/api/events': the single-plan stream is a top-level
	// route and that URL does not move.
	it('keeps the default plan stream at the top-level /events', () => {
		expect(eventsUrlFor(null)).toBe('/events');
		expect(eventsUrlFor('')).toBe('/events');
	});
});

describe('the active plan id', () => {
	it('defaults to null — the single-plan reading', () => {
		expect(activePlanId()).toBeNull();
	});

	it('holds the id it was set to', () => {
		setActivePlanId('puzzle');
		expect(activePlanId()).toBe('puzzle');
	});

	it('normalizes a falsy id back to null', () => {
		setActivePlanId('puzzle');
		setActivePlanId('');
		expect(activePlanId()).toBeNull();
	});
});
