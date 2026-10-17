/**
 * Display helpers shared by the dashboard pages, ported from the Svelte
 * viewer's `lib/format.ts`. Words come from the locale table and numbers and
 * dates from Intl in the active locale (lib/i18n.js).
 */
import { formatDateTime, formatRelative, t } from './i18n.js';

/** Compact relative time: "just now", "5m ago", "2h ago", "3d ago", or a date.
 *  Accepts an ISO string or an epoch-ms number (card mtimes). */
export function relTime(when) {
	if (!when) return '';
	const then = typeof when === 'number' ? when : new Date(when).getTime();
	if (Number.isNaN(then)) return '';
	const secs = Math.round((Date.now() - then) / 1000);
	if (secs < 45) return t('time.justNow');
	const mins = Math.round(secs / 60);
	if (mins < 60) return formatRelative(-mins, 'minute');
	const hours = Math.round(mins / 60);
	if (hours < 24) return formatRelative(-hours, 'hour');
	const days = Math.round(hours / 24);
	if (days < 30) return formatRelative(-days, 'day');
	return formatDateTime(then, { year: 'numeric', month: 'numeric', day: 'numeric' });
}

/** Glyph + label key per sync state (shared by SyncBadge and the Overview
 *  dashboard). `syncLabel(state)` is the translated word. */
export const SYNC_META = {
	'in-sync': { icon: '✓', labelKey: 'sync.state.inSync' },
	drifted: { icon: '⚠', labelKey: 'sync.state.drifted' },
	dirty: { icon: '●', labelKey: 'sync.state.dirty' },
	'never-synced': { icon: '○', labelKey: 'sync.state.neverSynced' },
	'no-git': { icon: '', labelKey: '' },
};

/** A sync state's label in the active locale; '' for no-git or an unknown state. */
export function syncLabel(state) {
	const key = SYNC_META[state]?.labelKey;
	return key ? t(key) : '';
}
