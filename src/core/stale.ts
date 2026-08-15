import type { Card, PlanIndex } from './types.js';
import { changedFilesSince, readSyncPoint } from './git.js';
import { boundPathsForCard, resolveCodeForCard } from './code.js';

export interface StaleCard {
  handle: string;
  name: string | null;
  status: string | null;
  baseline: string;
  baseline_source: 'verified_sha' | 'argument' | 'sync-marker';
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
 * (status built/verified, or carrying a verified_sha) compare its bound files
 * against its baseline (its own verified_sha, else the passed base, else the
 * sync marker). A card whose bound code changed — or whose bound file vanished —
 * since it was verified is stale. The verdict is computed live and never stored.
 * Shared by stale_report and check_sync.
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

  // Pass 1: collect every claim card with its baseline and resolved bound paths.
  interface Claim {
    card: Card;
    baseline: string | null;
    baseline_source: StaleCard['baseline_source'];
    paths: string[];
    /** Bound paths that are directories — matched by prefix, not equality. */
    dirs: string[];
    missing: string[];
  }
  const claims: Claim[] = [];
  for (const card of index.cards.values()) {
    const verifiedSha =
      typeof card.frontmatter.verified_sha === 'string'
        ? card.frontmatter.verified_sha
        : undefined;
    const isClaim =
      card.status === 'built' || card.status === 'verified' || Boolean(verifiedSha);
    if (!isClaim) continue;
    if (boundPathsForCard(index, card).length === 0) continue;
    const resolved = await resolveCodeForCard(root, index, card, 'paths');
    claims.push({
      card,
      baseline: verifiedSha ?? fallback,
      baseline_source: verifiedSha ? 'verified_sha' : base ? 'argument' : 'sync-marker',
      paths: resolved.files.map((f) => f.path),
      dirs: resolved.files.filter((f) => f.dir).map((f) => f.path),
      missing: resolved.files.filter((f) => !f.exists).map((f) => f.path),
    });
  }

  // Pass 2: one git call per DISTINCT baseline (usually just the sync marker),
  // not one per card — a plan with 100 verified cards must not spawn 100 diffs.
  const changedBy = new Map<string, Set<string> | 'unreachable'>();
  const baselines = new Set(
    claims.map((c) => c.baseline).filter((b): b is string => Boolean(b)),
  );
  for (const baseline of baselines) {
    const union = [
      ...new Set(
        claims.filter((c) => c.baseline === baseline).flatMap((c) => c.paths),
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
  for (const { card, baseline, baseline_source, paths, dirs, missing } of claims) {
    if (!baseline) {
      noBaseline.push({ handle: card.handle, status: card.status ?? null, files: paths });
      continue;
    }
    const changed = changedBy.get(baseline)!;
    if (changed === 'unreachable') {
      noBaseline.push({
        handle: card.handle,
        status: card.status ?? null,
        files: paths,
        reason: `baseline ${baseline.slice(0, 8)} unreachable in git history`,
      });
      continue;
    }
    // A bound FILE matches by equality; a bound DIRECTORY matches anything under
    // it — git reports the individual files it changed, never the folder, so a
    // card bound to `tests` would otherwise never register drift at all. Report
    // the files themselves rather than the folder: "3 files changed" under a
    // directory is the useful signal, "tests changed" is not.
    const changedFiles = [
      ...paths.filter((p) => changed.has(p)),
      ...(dirs.length > 0
        ? [...changed].filter((c) => dirs.some((d) => c.startsWith(`${d}/`)))
        : []),
    ];
    if (changedFiles.length > 0 || missing.length > 0) {
      stale.push({
        handle: card.handle,
        name: card.name ?? null,
        status: card.status ?? null,
        baseline: baseline.slice(0, 12),
        baseline_source,
        changed_files: changedFiles,
        missing_files: missing,
      });
    }
  }
  return { checked: claims.length, stale, no_baseline: noBaseline };
}
