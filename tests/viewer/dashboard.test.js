import { describe, expect, it } from 'vitest';
import { commitsModel, driftModel, notesModel, releaseModel } from '../../viewer/app/lib/dashboard.js';

const card = (handle, type, extra = {}) => ({
	handle, type,
	name: extra.name ?? handle,
	status: extra.status,
	mtime: extra.mtime ?? 1000,
	frontmatter: extra.frontmatter ?? {},
	body: '',
});

function indexOf(cards) {
	const byHandle = new Map();
	const byType = new Map();
	for (const c of cards) {
		byHandle.set(c.handle, c);
		if (!byType.has(c.type)) byType.set(c.type, []);
		byType.get(c.type).push(c);
	}
	return { byHandle, byType, neighbors: new Map(), connections: [], projectCard: null };
}

describe('driftModel', () => {
	it('hides when the payload has no stale verdict', () => {
		expect(driftModel(null).show).toBe(false);
		expect(driftModel({ stale: null }).show).toBe(false);
	});
	it('reports clean when nothing is stale', () => {
		const m = driftModel({ stale: { checked: 3, stale: [], no_baseline: [] } });
		expect(m.show).toBe(true);
		expect(m.clean).toBe(true);
	});
	it('maps stale cards to linked rows', () => {
		const m = driftModel({ stale: { checked: 3, no_baseline: [], stale: [
			{ handle: 'API-TICKETS', name: 'Tickets', status: 'verified', baseline: 'abc123', baseline_source: 'verified_sha', changed_files: ['src/a.ts', 'src/b.ts'], missing_files: [] },
		] } });
		expect(m.clean).toBe(false);
		expect(m.headline).toBe('1 stale card');
		expect(m.rows[0]).toMatchObject({ handle: 'API-TICKETS', changedCount: 2, baselineSource: 'verified_sha' });
		expect(m.rows[0].path).toContain('API-TICKETS');
	});
});

describe('releaseModel', () => {
	it('is null-current with no RELEASE cards, but still carries versions', () => {
		const m = releaseModel(indexOf([]), { latest_tag: 'v0.4.2', package_version: '0.5.0' });
		expect(m.current).toBeNull();
		expect(m.latestTag).toBe('v0.4.2');
		expect(m.packageVersion).toBe('0.5.0');
	});
	it('picks the in-flight release and computes feature progress', () => {
		const cards = [
			card('RELEASE-V0-4-0', 'RELEASE', { status: 'built', frontmatter: { version: '0.4.0' } }),
			card('RELEASE-V0-5-0', 'RELEASE', { status: 'building', frontmatter: { version: '0.5.0' } }),
			card('FEATURE-A', 'FEATURE', { status: 'built', frontmatter: { release: 'RELEASE-V0-5-0' } }),
			card('FEATURE-B', 'FEATURE', { status: 'planned', frontmatter: { release: 'RELEASE-V0-5-0' } }),
			card('FEATURE-OLD', 'FEATURE', { status: 'built', frontmatter: { release: 'RELEASE-V0-4-0' } }),
		];
		const m = releaseModel(indexOf(cards), {});
		expect(m.current.handle).toBe('RELEASE-V0-5-0');
		expect(m.current.totalCount).toBe(2);
		expect(m.current.shippedCount).toBe(1);
		expect(m.current.pct).toBe(50);
	});
	it('falls back to the newest release when everything shipped', () => {
		const cards = [
			card('RELEASE-V0-3-0', 'RELEASE', { status: 'verified', frontmatter: { version: '0.3.0' } }),
			card('RELEASE-V0-10-0', 'RELEASE', { status: 'built', frontmatter: { version: '0.10.0' } }),
		];
		expect(releaseModel(indexOf(cards), {}).current.handle).toBe('RELEASE-V0-10-0'); // numeric, not lexicographic
	});
});

describe('commitsModel', () => {
	it('hides on empty and maps rows newest-first', () => {
		expect(commitsModel({ code_activity: [] }).show).toBe(false);
		const m = commitsModel({ code_activity: [
			{ sha: 'a'.repeat(40), short_sha: 'aaaaaaaa', date: new Date().toISOString(), subject: 'feat: x', cards: [], is_sync_point: false },
		] });
		expect(m.show).toBe(true);
		expect(m.rows[0].subject).toBe('feat: x');
	});
});

describe('notesModel', () => {
	it('orders by card mtime desc then reverse note order, and limits', () => {
		const cards = [
			card('DB-USERS', 'DB', { mtime: 1, frontmatter: { notes: [{ kind: 'decision', text: 'old note' }] } }),
			card('API-TICKETS', 'API', { mtime: 2, frontmatter: { notes: [
				{ kind: 'gotcha', text: 'first' }, { kind: 'state', text: 'second (newest)' },
			] } }),
		];
		const m = notesModel(indexOf(cards), 2);
		expect(m.rows).toHaveLength(2);
		expect(m.rows[0]).toMatchObject({ handle: 'API-TICKETS', kind: 'state', text: 'second (newest)' });
		expect(m.rows[1]).toMatchObject({ handle: 'API-TICKETS', kind: 'gotcha' });
	});
});
