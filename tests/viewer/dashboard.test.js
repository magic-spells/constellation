import { describe, expect, it } from 'vitest';
import {
	activityModel,
	driftModel,
	healthModel,
	notesModel,
	releasesModel,
} from '../../viewer/app/lib/dashboard.js';

const card = (handle, type, extra = {}) => ({
	handle, type,
	name: extra.name ?? handle,
	status: extra.status,
	mtime: extra.mtime ?? 1000,
	frontmatter: extra.frontmatter ?? {},
	body: '',
});

function indexOf(cards, connections = []) {
	const byHandle = new Map();
	const byType = new Map();
	for (const c of cards) {
		byHandle.set(c.handle, c);
		if (!byType.has(c.type)) byType.set(c.type, []);
		byType.get(c.type).push(c);
	}
	return { byHandle, byType, neighbors: new Map(), connections, projectCard: null };
}

const chip = (model, key) => model.chips.find((c) => c.key === key);

describe('healthModel', () => {
	it('renders the counts with no git, but no state or sync action', () => {
		const m = healthModel(indexOf([card('API-A', 'API')], [['A', 'B']]), { state: 'no-git' });
		expect(m.hasGit).toBe(false);
		expect(m.canSync).toBe(false);
		expect(m.stateLabel).toBe('');
		expect(chip(m, 'cards').value).toBe(1);
		expect(chip(m, 'connections').value).toBe(1);
		// No stale verdict outside git → no drift chip at all.
		expect(chip(m, 'drift')).toBeUndefined();
	});

	it('tones the integrity chip on errors and adds a warnings chip', () => {
		const clean = healthModel(indexOf([]), { state: 'in-sync' }, { errors: 0, warnings: 0 });
		expect(chip(clean, 'integrity')).toMatchObject({ tone: 'good', icon: 'shield' });
		expect(chip(clean, 'warnings')).toBeUndefined();

		const broken = healthModel(indexOf([]), { state: 'in-sync' }, { errors: 2, warnings: 3 });
		expect(chip(broken, 'integrity')).toMatchObject({ value: 2, label: 'errors', tone: 'bad' });
		expect(chip(broken, 'warnings')).toMatchObject({ value: 3, tone: 'warn' });
	});

	it('reads the drift chip three ways: drifted, untracked, clean', () => {
		const base = { state: 'in-sync', marker: { synced_sha: 'abc', synced_at: '2026-01-01' } };
		const drifted = healthModel(indexOf([]), {
			...base,
			stale: { checked: 5, stale: [{ handle: 'A' }, { handle: 'B' }], no_baseline: [] },
		});
		expect(chip(drifted, 'drift')).toMatchObject({ value: 2, label: 'drifted', tone: 'warn' });

		const untracked = healthModel(indexOf([]), {
			...base,
			stale: { checked: 5, stale: [], no_baseline: [{ handle: 'A' }] },
		});
		expect(chip(untracked, 'drift')).toMatchObject({ value: 1, label: 'untracked', tone: 'muted' });

		const clean = healthModel(indexOf([]), {
			...base,
			stale: { checked: 5, stale: [], no_baseline: [] },
		});
		expect(chip(clean, 'drift')).toMatchObject({ tone: 'good', icon: 'check' });
	});

	it('labels the sync button by state and hides it on a read-only server', () => {
		const fresh = healthModel(indexOf([]), { state: 'never-synced' });
		expect(fresh.syncLabel).toBe('Set sync point');
		expect(fresh.canSync).toBe(true);
		expect(fresh.meta).toBe('no sync point yet');
		expect(fresh.stateIcon).toBe('circle');

		const synced = healthModel(indexOf([]), { state: 'in-sync' }, { editable: false });
		expect(synced.syncLabel).toBe('Update sync point');
		expect(synced.canSync).toBe(false);
	});
});

describe('driftModel', () => {
	it('hides when the payload has no stale verdict', () => {
		expect(driftModel(null).show).toBe(false);
		expect(driftModel({ stale: null }).show).toBe(false);
	});

	it('reports clean when nothing is stale', () => {
		const m = driftModel({ stale: { checked: 3, stale: [], no_baseline: [] } });
		expect(m.show).toBe(true);
		expect(m.clean).toBe(true);
		expect(m.headline).toBe('3 claims still hold');
		expect(m.untracked).toBeNull();
	});

	it('maps stale cards to linked rows', () => {
		const m = driftModel({ stale: { checked: 3, no_baseline: [], stale: [
			{ handle: 'API-TICKETS', name: 'Tickets', status: 'verified', baseline: 'abc123', baseline_source: 'verified_sha', changed_files: ['src/a.ts', 'src/b.ts'], missing_files: [] },
		] } });
		expect(m.clean).toBe(false);
		expect(m.headline).toBe('1 of 3 claims drifted');
		expect(m.rows[0]).toMatchObject({ handle: 'API-TICKETS', changedCount: 2, baselineSource: 'verified_sha' });
		expect(m.rows[0].path).toContain('API-TICKETS');
	});

	it('caps the stale list and reports the overflow', () => {
		const stale = Array.from({ length: 9 }, (_, i) => ({
			handle: `API-${i}`, status: 'built', changed_files: ['a.ts'], missing_files: [],
		}));
		const m = driftModel({ stale: { checked: 9, stale, no_baseline: [] } });
		expect(m.rows).toHaveLength(6);
		expect(m.overflow).toBe(3);
	});

	// The bug this rework exists to fix: a never-synced plan put every claim card
	// in no_baseline and rendered 49 rows that said nothing.
	it('collapses no-baseline claims to one counted line with the right fix', () => {
		const no_baseline = Array.from({ length: 49 }, (_, i) => ({ handle: `FILE-${i}`, status: 'built', files: [] }));
		const noMarker = driftModel({ marker: null, stale: { checked: 49, stale: [], no_baseline } });
		expect(noMarker.headline).toBe('nothing tracked yet');
		expect(noMarker.untracked).toMatchObject({ count: 49, unreachable: 0 });
		expect(noMarker.untracked.hint).toContain('commit them');

		const withMarker = driftModel({
			marker: { synced_sha: 'abc', synced_at: '2026-01-01' },
			stale: { checked: 2, stale: [], no_baseline: [{ handle: 'A', reason: 'baseline abc unreachable' }] },
		});
		expect(withMarker.untracked).toMatchObject({ count: 1, unreachable: 1 });
		expect(withMarker.untracked.hint).toContain('set_verified');
	});
});

describe('releasesModel', () => {
	it('is empty with no RELEASE cards, but still carries versions', () => {
		const m = releasesModel(indexOf([]), { latest_tag: 'v0.4.2', package_version: '0.5.0' });
		expect(m.empty).toBe(true);
		expect(m.releases).toEqual([]);
		expect(m.latestTag).toBe('v0.4.2');
		expect(m.packageVersion).toBe('0.5.0');
	});

	it('lists every release newest-first and marks the in-flight one current', () => {
		const cards = [
			card('RELEASE-V0-3-0', 'RELEASE', { status: 'verified', frontmatter: { version: '0.3.0' } }),
			card('RELEASE-V0-10-0', 'RELEASE', { status: 'built', frontmatter: { version: '0.10.0' } }),
			card('RELEASE-V0-5-0', 'RELEASE', { status: 'building', frontmatter: { version: '0.5.0' } }),
		];
		const m = releasesModel(indexOf(cards), {});
		// numeric per segment, not lexicographic: 0.10.0 > 0.5.0 > 0.3.0
		expect(m.releases.map((r) => r.version)).toEqual(['0.10.0', '0.5.0', '0.3.0']);
		expect(m.currentHandle).toBe('RELEASE-V0-5-0');
		expect(m.releases.find((r) => r.current).handle).toBe('RELEASE-V0-5-0');
		expect(m.releases[0].shipped).toBe(true);
	});

	it('falls back to the newest release as current when everything shipped', () => {
		const cards = [
			card('RELEASE-V0-3-0', 'RELEASE', { status: 'verified', frontmatter: { version: '0.3.0' } }),
			card('RELEASE-V0-10-0', 'RELEASE', { status: 'built', frontmatter: { version: '0.10.0' } }),
		];
		expect(releasesModel(indexOf(cards), {}).currentHandle).toBe('RELEASE-V0-10-0');
	});

	it('groups its features by change kind, in scan order, and counts progress', () => {
		const cards = [
			card('RELEASE-V0-5-0', 'RELEASE', { status: 'building', frontmatter: { version: '0.5.0' } }),
			card('FEATURE-A', 'FEATURE', { status: 'built', frontmatter: { release: 'RELEASE-V0-5-0' } }),
			card('FEATURE-B', 'FEATURE', { status: 'planned', frontmatter: { release: 'RELEASE-V0-5-0', change: 'fix' } }),
			card('FEATURE-C', 'FEATURE', { status: 'built', frontmatter: { release: 'RELEASE-V0-5-0', change: 'breaking' } }),
			card('FEATURE-OTHER', 'FEATURE', { status: 'built', frontmatter: { release: 'RELEASE-V9-0-0' } }),
		];
		const r = releasesModel(indexOf(cards), {}).releases[0];
		expect(r.totalCount).toBe(3);
		expect(r.shippedCount).toBe(2);
		expect(r.pct).toBe(67);
		expect(r.breakingCount).toBe(1);
		// Breaking first — it is what a reader scans a release for. An unset
		// `change:` reads as a feature.
		expect(r.groups.map((g) => g.key)).toEqual(['breaking', 'feature', 'fix']);
		expect(r.groups[1].items.map((f) => f.handle)).toEqual(['FEATURE-A']);
	});

	it('marks a release tagged when the repo tag matches its version', () => {
		const cards = [card('RELEASE-V0-4-0', 'RELEASE', { status: 'built', frontmatter: { version: '0.4.0' } })];
		expect(releasesModel(indexOf(cards), { latest_tag: 'v0.4.0' }).releases[0].tagged).toBe(true);
		expect(releasesModel(indexOf(cards), { latest_tag: 'v0.5.0' }).releases[0].tagged).toBe(false);
	});
});

describe('activityModel', () => {
	it('is empty with no commits at all', () => {
		expect(activityModel({}).rows).toEqual([]);
		expect(activityModel({ activity: [], code_activity: [] }).rows).toEqual([]);
	});

	it('interleaves plan and code commits newest-first, tagged by kind', () => {
		const m = activityModel({
			activity: [
				{ sha: 'a1', short_sha: 'a1', date: '2026-01-03T00:00:00Z', subject: 'docs(plan): x', cards: ['API-A', 'API-B', 'API-C', 'API-D'] },
				{ sha: 'a2', short_sha: 'a2', date: '2026-01-01T00:00:00Z', subject: 'plan: old', cards: [], is_sync_point: true },
			],
			code_activity: [
				{ sha: 'b1', short_sha: 'b1', date: '2026-01-02T00:00:00Z', subject: 'feat: y', cards: [] },
			],
		});
		expect(m.rows.map((r) => r.key)).toEqual(['a1', 'b1', 'a2']);
		expect(m.rows.map((r) => r.kind)).toEqual(['plan', 'code', 'plan']);
		expect(m.rows[0].icon).toBe('file');
		expect(m.rows[1].icon).toBe('commit');
		// Card chips cap at 2 with a "+N" tail, so a wide commit can't blow the row.
		expect(m.rows[0].cards).toHaveLength(2);
		expect(m.rows[0].more).toBe('+2');
		expect(m.rows[2].isSyncPoint).toBe(true);
	});

	it('dedupes by sha and honours the limit', () => {
		const commit = { sha: 'same', short_sha: 'same', date: '2026-01-01T00:00:00Z', subject: 'both', cards: [] };
		expect(activityModel({ activity: [commit], code_activity: [commit] }).rows).toHaveLength(1);

		const many = Array.from({ length: 12 }, (_, i) => ({
			sha: `s${i}`, short_sha: `s${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`, subject: `c${i}`, cards: [],
		}));
		expect(activityModel({ code_activity: many }, 4).rows).toHaveLength(4);
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
		expect(m.rows[1]).toMatchObject({ handle: 'API-TICKETS', kind: 'gotcha', tone: 'warn' });
	});
});
