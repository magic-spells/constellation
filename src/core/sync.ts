import {
  countCodeCommitsSince,
  diffPlan,
  planDirty,
  readSyncPoint,
  recentPlanActivity,
  type SyncActivity,
  type SyncPoint,
} from './git.js';
import { lintPlan } from './lint.js';

export type SyncState =
  | 'in-sync'
  | 'drifted'
  | 'dirty'
  | 'never-synced'
  | 'no-git';

export interface SyncStatus {
  state: SyncState;
  marker: SyncPoint | null;
  marker_error: string | null;
  plan_dirty: boolean;
  plan_changes_since_marker: number;
  code_commits_since_marker: number;
  integrity: { errors: number; warnings: number; orphans: number };
  status_rollup: Record<string, number>;
  total_cards: number;
  activity: SyncActivity[];
}

const STATUS_KEYS = ['planned', 'building', 'built', 'verified'] as const;

/**
 * The plan's freshness/trust state, computed live from git + lint on every call —
 * never stored, so it cannot go stale or lie. Composes the sync marker
 * (.sync.json), working-tree state, drift since the marker, lint integrity, the
 * card-status rollup, and recent plan activity into one glanceable verdict. When
 * the plan isn't in a git repo, returns `state: 'no-git'` (the viewer hides the
 * freshness pill) but still reports the git-independent lint + rollup.
 */
export async function computeSyncStatus(
  planRoot: string,
  options: { activityLimit?: number } = {},
): Promise<SyncStatus> {
  const lint = await lintPlan(planRoot);
  const orphans = [...lint.index.cards.keys()].filter(
    (h) => (lint.index.connectedHandles.get(h)?.size ?? 0) === 0,
  );
  const status_rollup: Record<string, number> = { none: 0 };
  for (const key of STATUS_KEYS) status_rollup[key] = 0;
  for (const card of lint.index.cards.values()) {
    const key = card.status ?? 'none';
    status_rollup[key] = (status_rollup[key] ?? 0) + 1;
  }

  const base = {
    integrity: {
      errors: lint.errors.length,
      warnings: lint.warnings.length,
      orphans: orphans.length,
    },
    status_rollup,
    total_cards: lint.index.cards.size,
  };

  let marker: SyncPoint | null = null;
  let plan_dirty = false;
  let plan_changes_since_marker = 0;
  let code_commits_since_marker = 0;
  let marker_error: string | null = null;
  let activity: SyncActivity[] = [];
  try {
    marker = await readSyncPoint(planRoot);
    plan_dirty = await planDirty(planRoot);
    activity = await recentPlanActivity(planRoot, options.activityLimit ?? 6);
    if (marker) {
      try {
        const diff = await diffPlan(planRoot, marker.synced_sha, 'HEAD');
        plan_changes_since_marker = diff.changes.length;
      } catch (err) {
        marker_error = markerError(marker.synced_sha, err);
      }
      try {
        code_commits_since_marker = await countCodeCommitsSince(
          planRoot,
          marker.synced_sha,
        );
      } catch (err) {
        marker_error ??= markerError(marker.synced_sha, err);
      }
    }
  } catch {
    // repoRootFor threw → not a git repo; no freshness signal is available.
    return {
      state: 'no-git',
      marker: null,
      marker_error: null,
      plan_dirty: false,
      plan_changes_since_marker: 0,
      code_commits_since_marker: 0,
      activity: [],
      ...base,
    };
  }

  const state: SyncState = !marker
    ? 'never-synced'
    : marker_error
      ? 'drifted'
    : plan_changes_since_marker > 0 || code_commits_since_marker > 0
      ? 'drifted'
      : plan_dirty
        ? 'dirty'
        : 'in-sync';

  return {
    state,
    marker,
    marker_error,
    plan_dirty,
    plan_changes_since_marker,
    code_commits_since_marker,
    activity,
    ...base,
  };
}

function markerError(sha: string, err: unknown): string {
  const reason = err instanceof Error ? err.message : String(err);
  return (
    `Sync marker ${sha.slice(0, 12)} is not reachable in git history; ` +
    `reconcile the plan and run set_sync_point again. ${reason}`
  );
}
