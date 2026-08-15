/**
 * Pure model builders for the Overview dashboard panels.
 *
 * Every function here takes plain data — a `planIndex()` result and/or the
 * `/api/sync` payload — and returns the exact rows a panel renders. No store,
 * no DOM, no fetch: the views do the wiring, these do the thinking, and the
 * tests can drive them with hand-built fixtures.
 *
 * Keys arriving from the server are snake_case (that is the wire shape); every
 * key leaving these functions is camelCase (that is the template shape).
 */

import { relTime, SYNC_META } from './format.js';
import { CHANGE_ICON, STATE_ICON } from './icons.js';
import { SHIPPED, statusMeta } from './status.js';
import { hrefForHandle } from './types.js';

/* ── health ─────────────────────────────────────────────────────────────── */

/**
 * The one-line detail under the sync state: marker age, drift, dirtiness.
 * Exported for the topbar badge's tooltip as much as the strip itself.
 */
export function syncMetaLine(sync) {
	if (!sync) return '';
	let line = sync.marker ? `last synced ${relTime(sync.marker.synced_at)}` : 'no sync point yet';

	if (sync.state === 'drifted') {
		if (sync.marker_error) {
			line += ` · ${sync.marker_error}`;
		} else {
			const commits = sync.code_commits_since_marker ?? 0;
			const changes = sync.plan_changes_since_marker ?? 0;
			line += ` · ${commits} code commit${commits === 1 ? '' : 's'} / ${changes} plan change${changes === 1 ? '' : 's'} since`;
		}
	}

	if (sync.plan_dirty) line += ' · uncommitted plan edits';
	return line;
}

/**
 * The health strip: the plan's state in one line. Replaces the old sync panel
 * AND the standalone stats row — the numbers only mean something next to the
 * freshness verdict, so they live in the same strip.
 *
 * The strip always renders (card/connection/integrity counts need no git); the
 * state dot and the sync button only appear when git can actually answer.
 */
export function healthModel(index, sync, options = {}) {
	const state = sync?.state ?? null;
	const hasGit = !!state && state !== 'no-git';
	const errors = options.errors ?? 0;
	const warnings = options.warnings ?? 0;
	const stale = sync?.stale ?? null;

	// Every chip carries its own icon + tone: the glyph says what is being
	// counted, the tone says whether the number is good news. Read together they
	// answer "is this plan healthy" without reading a single label.
	const chips = [
		{ key: 'cards', icon: 'layers', value: index?.byHandle?.size ?? 0, label: 'cards', tone: '' },
		{ key: 'connections', icon: 'link', value: index?.connections?.length ?? 0, label: 'connections', tone: '' },
		errors > 0
			? { key: 'integrity', icon: 'alert', value: errors, label: errors === 1 ? 'error' : 'errors', tone: 'bad' }
			: { key: 'integrity', icon: 'shield', value: 'clean', label: 'integrity', tone: 'good' },
	];
	if (warnings > 0) {
		chips.push({
			key: 'warnings',
			icon: 'alert',
			value: warnings,
			label: warnings === 1 ? 'warning' : 'warnings',
			tone: 'warn',
		});
	}

	// One drift chip, three readings: something moved / nothing is tracked yet /
	// every claim holds. A shifting set of chips reads as noise, so the slot is
	// always occupied once a verdict exists.
	if (stale) {
		const drifted = stale.stale?.length ?? 0;
		const untracked = stale.no_baseline?.length ?? 0;
		if (drifted > 0) {
			chips.push({ key: 'drift', icon: 'pulse', value: drifted, label: 'drifted', tone: 'warn' });
		} else if (untracked > 0) {
			chips.push({ key: 'drift', icon: 'target', value: untracked, label: 'untracked', tone: 'muted' });
		} else {
			chips.push({ key: 'drift', icon: 'check', value: 'no drift', label: 'code', tone: 'good' });
		}
	}

	const stateIcon = STATE_ICON[state] ?? { icon: '', tone: '' };

	return {
		hasGit,
		state: state ?? '',
		stateLabel: hasGit ? (SYNC_META[state]?.label ?? '') : '',
		stateIcon: hasGit ? stateIcon.icon : '',
		stateTone: hasGit ? stateIcon.tone : '',
		stateClass: hasGit ? `hs-state ${stateIcon.tone}` : 'hs-state',
		meta: hasGit ? syncMetaLine(sync) : '',
		chips,
		// Stamping the marker is a write — a --readonly server hides the button
		// rather than offering an action that 405s.
		canSync: hasGit && options.editable !== false,
		syncLabel: state === 'never-synced' ? 'Set sync point' : 'Update sync point',
	};
}

/* ── drift ──────────────────────────────────────────────────────────────── */

/** Stale rows shown inline before the list collapses into a "+N more" line. */
const DRIFT_ROW_CAP = 6;

/**
 * Reverse-drift verdict: cards whose bound code moved since their verified
 * baseline. `show` is false only when the payload carries no verdict at all
 * (outside git, or before the sync route answered) — a repo with nothing
 * verified still shows, as a clean panel.
 *
 * Shape rule: this panel is a verdict, not a list. Stale rows cap at
 * DRIFT_ROW_CAP, and cards with no reachable baseline collapse to a single
 * counted line — a plan that has never been synced has every claim in that
 * bucket, and rendering 49 identical rows says nothing 1 sentence can't.
 */
export function driftModel(sync) {
	const verdict = sync?.stale;
	if (!verdict) {
		return { show: false, clean: true, headline: '', rows: [], overflow: 0, untracked: null };
	}

	const stale = Array.isArray(verdict.stale) ? verdict.stale : [];
	const noBaseline = Array.isArray(verdict.no_baseline) ? verdict.no_baseline : [];
	const count = stale.length;
	const checked = verdict.checked ?? 0;
	const tracked = Math.max(checked - noBaseline.length, 0);

	return {
		show: true,
		clean: count === 0,
		headline:
			count === 0
				? tracked === 0
					? 'nothing tracked yet'
					: tracked === 1
						? '1 claim still holds'
						: `${tracked} claims still hold`
				: `${count} of ${tracked} claim${tracked === 1 ? '' : 's'} drifted`,
		rows: stale.slice(0, DRIFT_ROW_CAP).map((entry) => {
			const status = entry.status ?? '';
			const meta = statusMeta(status);
			return {
				handle: entry.handle,
				path: hrefForHandle(entry.handle),
				name: entry.name || entry.handle,
				status,
				statusVariant: meta.variant,
				statusTint: meta.tint,
				// A card is stale when bound files changed *or* went missing, and
				// the row has one count slot — so count both, or a card stale only
				// because its files vanished would render as "0 changed".
				changedCount: (entry.changed_files?.length ?? 0) + (entry.missing_files?.length ?? 0),
				baselineSource: entry.baseline_source ?? '',
			};
		}),
		overflow: Math.max(count - DRIFT_ROW_CAP, 0),
		// One summary line, never a list. `reason` distinguishes "never had a
		// baseline" from "its baseline fell out of history" — different fixes.
		untracked:
			noBaseline.length === 0
				? null
				: {
						count: noBaseline.length,
						unreachable: noBaseline.filter((entry) => entry.reason).length,
						// The fix depends on why: with no marker at all, one sync point
						// baselines every claim at once.
						hint: sync?.marker
							? 'stamp them with set_verified to track their code'
							: 'set a sync point to give every claim a baseline',
					},
	};
}

/* ── releases ───────────────────────────────────────────────────────────── */

function versionKey(card) {
	const v = card.frontmatter?.version;
	if (typeof v !== 'string') return [-1];
	return v.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

/** Newest release first, numerically per segment — 0.10.0 beats 0.9.0. */
function byVersionDesc(a, b) {
	const ka = versionKey(a);
	const kb = versionKey(b);
	for (let i = 0; i < Math.max(ka.length, kb.length); i += 1) {
		const d = (kb[i] ?? 0) - (ka[i] ?? 0);
		if (d !== 0) return d;
	}
	return 0;
}

// `change:` on a FEATURE card, in the order a reader scans a release: what will
// break me, what's new, what got fixed, what was housekeeping. Unset reads as
// `feature` — the field is optional and most work is a feature.
const CHANGE_GROUPS = [
	{ key: 'breaking', label: 'Breaking' },
	{ key: 'feature', label: 'Features' },
	{ key: 'fix', label: 'Fixes' },
	{ key: 'chore', label: 'Chores' },
];
const CHANGE_KEYS = new Set(CHANGE_GROUPS.map((g) => g.key));

function featureRow(card) {
	const status = card.status ?? '';
	const meta = statusMeta(status);
	const change = card.frontmatter?.change;
	return {
		handle: card.handle,
		path: hrefForHandle(card.handle),
		name: card.name || card.handle,
		status,
		statusVariant: meta.variant,
		statusTint: meta.tint,
		change: CHANGE_KEYS.has(change) ? change : 'feature',
	};
}

/**
 * Every release the plan knows about, newest first — a timeline, not a single
 * "current". The release still being pushed on (the newest one not yet
 * built/verified) is expanded with its features grouped by `change:`; the ones
 * already out collapse to a summary line the panel can expand on demand.
 *
 * Contents are DERIVED from the FEATURE cards pointing at a release, never
 * stored on the RELEASE card — a RELEASE holds theme and migration notes, and a
 * hand-written changelog would drift the moment a feature slipped a version.
 */
export function releasesModel(index, sync) {
	const cards = [...(index?.byType?.get('RELEASE') ?? [])].sort(byVersionDesc);
	const features = [...(index?.byType?.get('FEATURE') ?? [])];
	const latestTag = sync?.latest_tag ?? '';

	// The newest unshipped release is what the project is working on; with
	// everything shipped, the newest one is still the interesting one.
	const currentHandle = (cards.find((c) => !SHIPPED.has(c.status ?? '')) ?? cards[0])?.handle ?? null;

	const releases = cards.map((card) => {
		const mine = features.filter((f) => f.frontmatter?.release === card.handle).map(featureRow);
		const shippedCount = mine.filter((f) => SHIPPED.has(f.status)).length;
		const version = typeof card.frontmatter?.version === 'string' ? card.frontmatter.version : '';
		const status = card.status ?? '';
		const meta = statusMeta(status);

		return {
			handle: card.handle,
			path: hrefForHandle(card.handle),
			name: card.name || card.handle,
			version,
			status,
			statusVariant: meta.variant,
			statusTint: meta.tint,
			shipped: SHIPPED.has(status),
			current: card.handle === currentHandle,
			// The tag is the repo's own word that this version actually went out.
			tagged: !!version && !!latestTag && latestTag.replace(/^v/, '') === version,
			groups: CHANGE_GROUPS.map((group) => ({
				...group,
				icon: CHANGE_ICON[group.key] ?? 'sparkle',
				// Breaking is the one group a reader scans for — it is the only one
				// that carries a tone, so it stands out without shouting.
				tone: group.key === 'breaking' ? 'warn' : '',
				items: mine.filter((f) => f.change === group.key),
			})).filter((group) => group.items.length > 0),
			breakingCount: mine.filter((f) => f.change === 'breaking').length,
			shippedCount,
			totalCount: mine.length,
			pct: mine.length === 0 ? 0 : Math.round((shippedCount / mine.length) * 100),
		};
	});

	return {
		latestTag,
		packageVersion: sync?.package_version ?? '',
		releases,
		currentHandle,
		empty: releases.length === 0,
	};
}

/* ── activity ───────────────────────────────────────────────────────────── */

/**
 * One activity stream, plan and code interleaved. The server reports them
 * separately (`activity` = commits touching the plan, `code_activity` = commits
 * touching code but not the plan) and the two are disjoint by construction —
 * but they answer the same question, "what has been happening here", so
 * splitting them across two panels only made the reader do the merge.
 *
 * Rows are keyed by sha and deduped defensively; the server sends each list
 * newest-first but says nothing about how the two interleave, so sort by date.
 */
export function activityModel(sync, limit = 9) {
	const plan = Array.isArray(sync?.activity) ? sync.activity : [];
	const code = Array.isArray(sync?.code_activity) ? sync.code_activity : [];

	const seen = new Set();
	const rows = [];
	for (const [kind, entries] of [
		['plan', plan],
		['code', code],
	]) {
		for (const commit of entries) {
			const sha = commit.sha ?? commit.short_sha ?? '';
			if (sha && seen.has(sha)) continue;
			if (sha) seen.add(sha);
			rows.push({
				key: sha || `${kind}:${rows.length}`,
				kind,
				// A plan commit edits cards, a code commit edits code — the glyph
				// carries that distinction so the tag can stay small and quiet.
				icon: kind === 'plan' ? 'file' : 'commit',
				at: commit.date ? new Date(commit.date).getTime() : 0,
				when: relTime(commit.date),
				subject: commit.subject ?? '',
				isSyncPoint: !!commit.is_sync_point,
				// Two chips, not more: handles are long (FEATURE-DASHBOARD-REWORK is
				// 24 chars) and a half-width panel can only show a couple before
				// they all ellipsize into uselessness. The "+N" carries the rest.
				cards: (commit.cards ?? []).slice(0, 2).map((handle) => ({
					handle,
					path: hrefForHandle(handle),
				})),
				more: (commit.cards?.length ?? 0) > 2 ? `+${commit.cards.length - 2}` : '',
			});
		}
	}

	rows.sort((a, b) => b.at - a.at);
	return { rows: rows.slice(0, limit) };
}

/* ── notes ──────────────────────────────────────────────────────────────── */

// Glyph + tone per note kind. Notes keep their typographic glyphs rather than
// the stroke icons — they read as a margin mark next to prose, and the five
// kinds are distinct enough by shape. The tone is what makes the stream
// scannable: a gotcha and a decision should not look alike.
const NOTE_GLYPHS = {
	decision: '◆',
	gotcha: '⚡',
	state: '●',
	deviation: '△',
	verified: '✓',
};
const NOTE_TONES = {
	decision: 'brand',
	gotcha: 'warn',
	state: 'muted',
	deviation: 'warn',
	verified: 'good',
};

/**
 * The plan's most recent notes. Notes carry no timestamps, so recency is
 * inferred: cards by file mtime (freshest edit first), and within a card the
 * `notes` array reversed — appends land at the end on disk, so the last one
 * written is the newest.
 */
export function notesModel(index, limit = 8) {
	const cards = [...(index?.byHandle?.values() ?? [])].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
	const rows = [];

	for (const card of cards) {
		const notes = card.frontmatter?.notes;
		if (!Array.isArray(notes)) continue;
		const when = relTime(card.mtime);
		for (let i = notes.length - 1; i >= 0; i -= 1) {
			const note = notes[i];
			if (!note?.text) continue;
			rows.push({
				key: `${card.handle}:${i}`,
				kind: note.kind ?? '',
				glyph: NOTE_GLYPHS[note.kind] ?? '·',
				tone: NOTE_TONES[note.kind] ?? '',
				text: note.text,
				handle: card.handle,
				path: hrefForHandle(card.handle),
				when,
			});
			if (rows.length >= limit) return { rows };
		}
	}

	return { rows };
}
