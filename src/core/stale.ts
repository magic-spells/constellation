import { realpath } from 'node:fs/promises';
import path from 'node:path';
import type { Card, PlanIndex } from './types.js';
import {
  changedFilesSince,
  dirtyFilesAmong,
  lastCommitByPath,
  readSyncPoint,
  repoRootFor,
  type PathCommit,
} from './git.js';
import { boundPathsForCard, boundPathsOverlap, resolveCodeForCard } from './code.js';

export interface StaleCard {
  handle: string;
  name: string | null;
  status: string | null;
  baseline: string;
  baseline_source: 'verified_sha' | 'card-commit' | 'argument' | 'sync-marker';
  changed_files: string[];
  missing_files: string[];
}

export interface StaleResult {
  checked: number;
  stale: StaleCard[];
  no_baseline: Array<{ handle: string; status: string | null; files: string[]; reason?: string }>;
}

/**
 * Code-side drift: for every card that makes a claim about code it is bound to
 * (status built/verified, or carrying a verified_sha) decide whether the code
 * has moved on without it. The baseline, in precedence order:
 *
 * 1. `verified_sha` — an explicit "I checked this card against that sha".
 * 2. **The card's own last commit** — the ordinary loop: a card committed with
 *    (or after) its code is current; code that moved in a LATER commit is drift.
 *    This is what makes `set_sync_point` optional instead of a chore, and what
 *    stops a card+code edit landing in one commit from reading as stale.
 * 3. The passed `base`, else the `.sync.json` marker — the fallback for cards
 *    git has never seen change (brand new, or renamed out of their history).
 *
 * Uncommitted changes to bound code count as drift under every baseline, and a
 * bound file that vanished is drift on its own. The verdict is computed live and
 * never stored. Shared by stale_report, check_sync and the viewer's /api/sync.
 */
export async function computeStaleCards(
  root: string,
  index: PlanIndex,
  base?: string,
): Promise<StaleResult> {
  let marker: string | null = null;
  try {
    marker = (await readSyncPoint(root))?.synced_sha ?? null;
  } catch {
    marker = null;
  }
  const fallback = base ?? marker ?? null;
  const fallbackSource: StaleCard['baseline_source'] = base ? 'argument' : 'sync-marker';

  // Pass 1: collect every claim card with its resolved bound paths.
  interface Claim {
    card: Card;
    /** The card file itself, repo-relative — the card-relative baseline's subject. */
    cardPath: string | null;
    verifiedSha: string | null;
    paths: string[];
    /** Bound paths that are directories — matched by prefix, not equality. */
    dirs: string[];
    missing: string[];
  }
  const claims: Claim[] = [];

  // Card files are compared against bound code in the SAME git pass, so both
  // need repo-relative paths. Outside a git repo there is no comparison to make
  // and every claim falls back to base/marker (or to no_baseline).
  let planRel: string | null = null;
  try {
    const realRoot = await realpath(root);
    const repoRoot = await repoRootFor(realRoot);
    planRel = path.relative(repoRoot, realRoot).split(path.sep).join('/');
  } catch {
    planRel = null;
  }
  const repoPathOf = (card: Card): string | null => {
    if (planRel === null) return null;
    const rel = card.relPath.split(path.sep).join('/');
    return planRel ? `${planRel}/${rel}` : rel;
  };

  for (const card of index.cards.values()) {
    const verifiedSha =
      typeof card.frontmatter.verified_sha === 'string'
        ? card.frontmatter.verified_sha
        : null;
    const isClaim =
      card.status === 'built' || card.status === 'verified' || Boolean(verifiedSha);
    if (!isClaim) continue;
    if (boundPathsForCard(index, card).length === 0) continue;
    const resolved = await resolveCodeForCard(root, index, card, 'paths');
    claims.push({
      card,
      cardPath: repoPathOf(card),
      verifiedSha,
      paths: resolved.files.map((f) => f.path),
      dirs: resolved.files.filter((f) => f.dir).map((f) => f.path),
      missing: resolved.files.filter((f) => !f.exists).map((f) => f.path),
    });
  }

  // Pass 2a: ONE git log over every bound path and every claim card file, giving
  // each path its last commit and a comparable position in one newest-first walk
  // — not one git call per card. Plus one diff for the uncommitted-code check.
  const relative = claims.filter((c) => !c.verifiedSha && c.cardPath);
  let lastCommit = new Map<string, PathCommit>();
  let dirty = new Set<string>();
  if (relative.length > 0) {
    const union = [
      ...new Set([
        ...relative.flatMap((c) => c.paths),
        ...relative.map((c) => c.cardPath!),
      ]),
    ];
    try {
      lastCommit = await lastCommitByPath(root, union);
      dirty = await dirtyFilesAmong(
        root,
        [...new Set(relative.flatMap((c) => c.paths))],
      );
    } catch {
      // No usable history (fresh repo, no HEAD): every card falls back below.
      lastCommit = new Map();
      dirty = new Set();
    }
  }

  // Pass 2b: one git call per DISTINCT sha baseline (verified_sha, or the shared
  // fallback) — a plan with 100 verified cards must not spawn 100 diffs.
  const shaBaseline = (c: Claim): string | null =>
    c.verifiedSha ?? (lastCommit.has(c.cardPath ?? '') ? null : fallback);
  const changedBy = new Map<string, Set<string> | 'unreachable'>();
  const baselines = new Set(
    claims.map(shaBaseline).filter((b): b is string => Boolean(b)),
  );
  for (const baseline of baselines) {
    const union = [
      ...new Set(
        claims.filter((c) => shaBaseline(c) === baseline).flatMap((c) => c.paths),
      ),
    ];
    try {
      changedBy.set(baseline, await changedFilesSince(root, baseline, union));
    } catch {
      changedBy.set(baseline, 'unreachable');
    }
  }

  const stale: StaleCard[] = [];
  const noBaseline: StaleResult['no_baseline'] = [];
  for (const claim of claims) {
    const { card, paths, dirs, missing } = claim;
    const cardCommit = claim.verifiedSha
      ? undefined
      : lastCommit.get(claim.cardPath ?? '');

    let baseline: string;
    let baseline_source: StaleCard['baseline_source'];
    let changedFiles: string[];

    if (cardCommit) {
      // Card-relative: bound code whose last commit is NEWER than the card's,
      // plus anything uncommitted (which no commit order can account for).
      baseline = cardCommit.sha;
      baseline_source = 'card-commit';
      const newer = (p: string) => {
        const c = lastCommit.get(p);
        return c !== undefined && c.order < cardCommit.order;
      };
      const underDirs = dirs.length > 0
        ? [...lastCommit.keys()].filter(
            (p) => !paths.includes(p) && dirs.some((d) => boundPathsOverlap(d, p) && p !== d),
          )
        : [];
      changedFiles = [
        ...paths.filter((p) => newer(p) || dirty.has(p)),
        ...underDirs.filter((p) => newer(p) || dirty.has(p)),
      ];
    } else {
      const sha = shaBaseline(claim);
      if (!sha) {
        noBaseline.push({ handle: card.handle, status: card.status ?? null, files: paths });
        continue;
      }
      const changed = changedBy.get(sha)!;
      if (changed === 'unreachable') {
        noBaseline.push({
          handle: card.handle,
          status: card.status ?? null,
          files: paths,
          reason: `baseline ${sha.slice(0, 8)} unreachable in git history`,
        });
        continue;
      }
      baseline = sha;
      baseline_source = claim.verifiedSha ? 'verified_sha' : fallbackSource;
      // A bound FILE matches by equality; a bound DIRECTORY matches anything
      // under it — git reports the individual files it changed, never the
      // folder, so a card bound to `tests` would otherwise never register drift
      // at all. Report the files themselves rather than the folder: "3 files
      // changed" under a directory is the useful signal, "tests changed" is not.
      changedFiles = [
        ...paths.filter((p) => changed.has(p)),
        ...(dirs.length > 0
          ? [...changed].filter((c) => dirs.some((d) => boundPathsOverlap(d, c) && c !== d))
          : []),
      ];
    }

    if (changedFiles.length > 0 || missing.length > 0) {
      stale.push({
        handle: card.handle,
        name: card.name ?? null,
        status: card.status ?? null,
        baseline: baseline.slice(0, 12),
        baseline_source,
        changed_files: [...new Set(changedFiles)].sort(),
        missing_files: missing,
      });
    }
  }
  return { checked: claims.length, stale, no_baseline: noBaseline };
}
