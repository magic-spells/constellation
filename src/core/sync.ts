import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  countCodeCommitsSince,
  diffPlan,
  latestTag,
  planDirty,
  readSyncPoint,
  recentCodeActivity,
  recentPlanActivity,
  repoRootFor,
  type SyncActivity,
  type SyncPoint,
} from './git.js';
import { lintPlan, type LintResult } from './lint.js';
import { computeStaleCards, type StaleResult } from './stale.js';

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
  /** Recent commits that touched code but not the plan. `[]` outside a git repo. */
  code_activity: SyncActivity[];
  /** Newest git tag, or null with no tags / outside a git repo. */
  latest_tag: string | null;
  /** `version` from the repo root's package.json; null when absent. */
  package_version: string | null;
  /** Live code-drift verdict over verified cards. null outside a git repo. */
  stale: StaleResult | null;
}

const STATUS_KEYS = ['planned', 'building', 'built', 'verified'] as const;

/**
 * The `version` from the repo root's package.json — the plan's own release line.
 * Read live (never stored); null for a non-node repo, an unreadable/invalid
 * package.json, or a plan outside a git repo.
 */
export async function packageVersion(planRoot: string): Promise<string | null> {
  try {
    const repoRoot = await repoRootFor(await realpath(planRoot));
    const raw = await readFile(path.join(repoRoot, 'package.json'), 'utf8');
    const version: unknown = JSON.parse(raw)?.version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

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
  options: { activityLimit?: number; lint?: LintResult; stale?: StaleResult } = {},
): Promise<SyncStatus> {
  // Callers that already linted (check_sync) pass the result in — the plan
  // must not be re-read from disk twice in one tool call. Same for `stale`:
  // check_sync computes the drift verdict itself (with its own `base`), so it
  // hands it over rather than paying for a second claim-card pass + git diffs.
  const lint = options.lint ?? (await lintPlan(planRoot));
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
  let code_activity: SyncActivity[] = [];
  let latest_tag: string | null = null;
  let pkg_version: string | null = null;
  let stale: StaleResult | null = null;
  try {
    marker = await readSyncPoint(planRoot);
    plan_dirty = await planDirty(planRoot);
    activity = await recentPlanActivity(planRoot, options.activityLimit ?? 6);
    code_activity = await recentCodeActivity(planRoot, options.activityLimit ?? 6);
    latest_tag = await latestTag(planRoot);
    pkg_version = await packageVersion(planRoot);
    stale = options.stale ?? (await computeStaleCards(planRoot, lint.index));
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
      code_activity: [],
      latest_tag: null,
      package_version: null,
      stale: null,
      ...base,
    };
  }

  // Per-card reverse drift (bound code moved or vanished) is part of the
  // definition-of-done, not a side list. An uncommitted edit to bound code —
  // or a missing bound file — must not report in-sync. plan_dirty still wins
  // over stale: uncommitted plan edits are the more immediate signal.
  const hasStaleClaims = (stale?.stale.length ?? 0) > 0;
  const state: SyncState = !marker
    ? 'never-synced'
    : marker_error
      ? 'drifted'
    : plan_changes_since_marker > 0 || code_commits_since_marker > 0
      ? 'drifted'
      : plan_dirty
        ? 'dirty'
        : hasStaleClaims
          ? 'drifted'
          : 'in-sync';

  return {
    state,
    marker,
    marker_error,
    plan_dirty,
    plan_changes_since_marker,
    code_commits_since_marker,
    activity,
    code_activity,
    latest_tag,
    package_version: pkg_version,
    stale,
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
