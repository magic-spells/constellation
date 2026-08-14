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

import { relTime } from './format.js';
import { SHIPPED, statusMeta } from './status.js';
import { hrefForHandle } from './types.js';

/* ── drift ──────────────────────────────────────────────────────────────── */

/**
 * Reverse-drift verdict: cards whose bound code moved since their verified
 * baseline. `show` is false only when the payload carries no verdict at all
 * (outside git, or before the sync route answered) — a repo with nothing
 * verified still shows, as a clean panel.
 */
export function driftModel(sync) {
	const verdict = sync?.stale;
	if (!verdict) return { show: false, clean: true, headline: '', rows: [], noBaseline: [] };

	const stale = Array.isArray(verdict.stale) ? verdict.stale : [];
	const noBaseline = Array.isArray(verdict.no_baseline) ? verdict.no_baseline : [];
	const count = stale.length;

	return {
		show: true,
		clean: count === 0,
		headline: `${count} stale card${count === 1 ? '' : 's'}`,
		rows: stale.map((entry) => {
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
		noBaseline: noBaseline.map((entry) => ({
			handle: entry.handle,
			path: hrefForHandle(entry.handle),
			status: entry.status ?? '',
			reason: entry.reason ?? 'no verified baseline',
		})),
	};
}

/* ── release ────────────────────────────────────────────────────────────── */

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

/**
 * The release the project is currently pushing on, plus the two version
 * numbers the repo itself reports. "Current" is the newest RELEASE card that
 * has not shipped; once everything has shipped it is simply the newest one, so
 * the panel keeps showing the last thing that went out rather than going blank.
 */
export function releaseModel(index, sync) {
	const releases = [...(index?.byType?.get('RELEASE') ?? [])].sort(byVersionDesc);
	const inFlight = releases.filter((card) => !SHIPPED.has(card.status ?? ''));
	const current = inFlight[0] ?? releases[0] ?? null;

	const model = {
		latestTag: sync?.latest_tag ?? '',
		packageVersion: sync?.package_version ?? '',
		current: null,
	};
	if (!current) return model;

	const features = [...(index?.byType?.get('FEATURE') ?? [])]
		.filter((card) => card.frontmatter?.release === current.handle)
		.map((card) => {
			const status = card.status ?? '';
			const meta = statusMeta(status);
			return {
				handle: card.handle,
				path: hrefForHandle(card.handle),
				name: card.name || card.handle,
				status,
				statusVariant: meta.variant,
				statusTint: meta.tint,
			};
		});

	const shippedCount = features.filter((f) => SHIPPED.has(f.status)).length;
	const totalCount = features.length;

	model.current = {
		handle: current.handle,
		path: hrefForHandle(current.handle),
		name: current.name || current.handle,
		version: typeof current.frontmatter?.version === 'string' ? current.frontmatter.version : '',
		features,
		shippedCount,
		totalCount,
		pct: totalCount === 0 ? 0 : Math.round((shippedCount / totalCount) * 100),
	};
	return model;
}

/* ── commits ────────────────────────────────────────────────────────────── */

/**
 * Recent commits touching bound code. The server sends them newest-first and
 * may send fewer than it was asked for — never assume a length.
 */
export function commitsModel(sync) {
	const activity = sync?.code_activity;
	if (!Array.isArray(activity) || activity.length === 0) return { show: false, rows: [] };

	return {
		show: true,
		rows: activity.map((commit) => ({
			key: commit.short_sha,
			when: relTime(commit.date),
			subject: commit.subject ?? '',
		})),
	};
}

/* ── notes ──────────────────────────────────────────────────────────────── */

const NOTE_GLYPHS = {
	decision: '◆',
	gotcha: '⚡',
	state: '●',
	deviation: '△',
	verified: '✓',
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
