/**
 * Display helpers shared by the dashboard pages, ported from the Svelte
 * viewer's `lib/format.ts` (types dropped — the runtime values are unchanged).
 */

/** Compact relative time: "just now", "5m ago", "2h ago", "3d ago", or a date.
 *  Accepts an ISO string or an epoch-ms number (card mtimes). */
export function relTime(when) {
	if (!when) return '';
	const then = typeof when === 'number' ? when : new Date(when).getTime();
	if (Number.isNaN(then)) return '';
	const secs = Math.round((Date.now() - then) / 1000);
	if (secs < 45) return 'just now';
	const mins = Math.round(secs / 60);
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(then).toLocaleDateString();
}

/** Glyph + label per sync state (shared by SyncBadge and the Overview dashboard). */
export const SYNC_META = {
	'in-sync': { icon: '✓', label: 'In sync' },
	drifted: { icon: '⚠', label: 'Drifted' },
	dirty: { icon: '●', label: 'Uncommitted edits' },
	'never-synced': { icon: '○', label: 'Not synced' },
	'no-git': { icon: '', label: '' },
};
