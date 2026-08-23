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
 * Code-side drift for every claim card (status built/verified, or carrying a
 * verified_sha). Baseline precedence:
 *
 * 1. `verified_sha` — explicit "checked against that sha".
 * 2. The card's own last commit — code that moved in a LATER commit is drift;
 *    a card committed with its code is current, so `set_sync_point` is optional.
 * 3. Passed `base`, else the `.sync.json` marker — for cards git has never seen
 *    change (brand new, or renamed out of their history).
 *
 * Uncommitted bound-code changes count as drift under every baseline; a vanished
 * bound file is drift on its own. Computed live, never stored. Shared by
 * stale_report, check_sync and the viewer's /api/sync.
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

  // Card files join the same git pass as bound code, so both need repo-relative
  // paths; outside a git repo every claim falls back to base/marker. The repo
  // root is resolved ONCE here and shared with every resolveCodeForCard call —
  // its own fallback spawns a git subprocess per card.
  let planRel: string | null = null;
  let repoRoot: string | null = null;
  try {
    const realRoot = await realpath(root);
    repoRoot = await repoRootFor(realRoot);
    planRel = path.relative(repoRoot, realRoot).split(path.sep).join('/');
  } catch {
    planRel = null;
    repoRoot = null;
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
    const resolved = await resolveCodeForCard(root, index, card, 'paths', { repoRoot });
    claims.push({
      card,
      cardPath: repoPathOf(card),
      verifiedSha,
      paths: resolved.files.map((f) => f.path),
      dirs: resolved.files.filter((f) => f.dir).map((f) => f.path),
      missing: resolved.files.filter((f) => !f.exists).map((f) => f.path),
    });
  }

  // Pass 2a: ONE git log over all bound paths + claim card files — each path gets
  // its last commit and a comparable position in one newest-first walk. Plus one
  // diff for the uncommitted-code check.
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
      [lastCommit, dirty] = await Promise.all([
        lastCommitByPath(root, union),
        dirtyFilesAmong(root, [...new Set(relative.flatMap((c) => c.paths))]),
      ]);
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
  await Promise.all(
    [...baselines].map(async (baseline) => {
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
    }),
  );

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
      // A bound FILE matches by equality; a bound DIRECTORY by prefix — git
      // reports changed files, never folders, so report those files themselves.
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
