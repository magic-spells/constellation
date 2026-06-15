import type { SyncState } from './types';

/** Compact relative time: "just now", "5m ago", "2h ago", "3d ago", or a date. */
export function relTime(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Pill/dashboard glyph + label per sync state (shared by SyncPill and the Overview dashboard). */
export const SYNC_META: Record<SyncState, { icon: string; label: string }> = {
  'in-sync': { icon: '✓', label: 'In sync' },
  drifted: { icon: '⚠', label: 'Drifted' },
  dirty: { icon: '●', label: 'Uncommitted edits' },
  'never-synced': { icon: '○', label: 'Not synced' },
  'no-git': { icon: '', label: '' },
};
