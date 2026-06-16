import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseFile } from './parse.js';
import { resolvePlanDir } from './resolve.js';
import type { ConnectedRepo } from './types.js';

/**
 * Connected repos are repo-level links declared on PLAN-PROJECT (plan.md).
 * They never become card connections and the indexer never sees them — they
 * are read on demand here, so a connected repo's plan can be resolved and
 * targeted by the `repo` selector without ever merging two plans.
 */

/** The directory containing the plan folder — the repo root in the normal layout. */
function repoRootOf(planRoot: string): string {
  return path.dirname(planRoot);
}

/**
 * Read the connected_repos declared on PLAN-PROJECT (plan.md at the plan root).
 * Returns [] when there is no plan.md, no frontmatter, or no connected_repos.
 * Malformed entries are skipped silently — lint surfaces the schema warning
 * (W002) separately; this reader stays lenient so a broken entry never crashes
 * a resolution that other entries could still satisfy.
 */
export async function readConnectedRepos(planRoot: string): Promise<ConnectedRepo[]> {
  let raw: string;
  try {
    raw = await readFile(path.join(planRoot, 'plan.md'), 'utf8');
  } catch {
    return [];
  }
  const list = parseFile(raw).frontmatter.connected_repos;
  if (!Array.isArray(list)) return [];
  const repos: ConnectedRepo[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.name !== 'string' || typeof e.path !== 'string') continue;
    repos.push({
      name: e.name,
      path: e.path,
      description: typeof e.description === 'string' ? e.description : undefined,
    });
  }
  return repos;
}

/** Resolve a path (relative to the home repo root, or absolute) to a plan root, or null. */
async function resolveRepoPath(
  homePlanRoot: string,
  rawPath: string,
): Promise<string | null> {
  const abs = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(repoRootOf(homePlanRoot), rawPath);
  return resolvePlanDir(abs);
}

export interface ResolvedRepo {
  /** The connected repo's plan root (its constellation/ folder). */
  root: string;
  /** The connected repo's root directory. */
  repoRoot: string;
  /** The connected_repos name when resolved by name; null when resolved by raw path. */
  name: string | null;
}

/**
 * Resolve a `repo` selector against a home plan. `nameOrPath` is either the name
 * of a connected_repos entry on the home plan, or a path (relative to the home
 * repo root, or absolute). Returns null when it can't be resolved to a plan.
 */
export async function resolveConnectedRepo(
  homePlanRoot: string,
  nameOrPath: string,
): Promise<ResolvedRepo | null> {
  const byName = (await readConnectedRepos(homePlanRoot)).find(
    (r) => r.name === nameOrPath,
  );
  const root = await resolveRepoPath(homePlanRoot, byName ? byName.path : nameOrPath);
  if (!root) return null;
  return { root, repoRoot: repoRootOf(root), name: byName?.name ?? null };
}

export interface ConnectedRepoStatus extends ConnectedRepo {
  /** Whether the path resolves to an existing plan on this machine. */
  reachable: boolean;
  /** The resolved plan root, or null when unreachable. */
  planRoot: string | null;
}

/** The home plan's connected repos, each annotated with use-time reachability. */
export async function listConnectedRepos(
  homePlanRoot: string,
): Promise<ConnectedRepoStatus[]> {
  const repos = await readConnectedRepos(homePlanRoot);
  return Promise.all(
    repos.map(async (r) => {
      const planRoot = await resolveRepoPath(homePlanRoot, r.path);
      return { ...r, reachable: planRoot !== null, planRoot };
    }),
  );
}

/** Upsert an entry by name (replacing any existing entry with the same name). */
export function upsertConnectedRepo(
  existing: ConnectedRepo[],
  entry: ConnectedRepo,
): ConnectedRepo[] {
  return [...existing.filter((r) => r.name !== entry.name), entry];
}

/** Remove the entry with the given name. */
export function removeConnectedRepoEntry(
  existing: ConnectedRepo[],
  name: string,
): ConnectedRepo[] {
  return existing.filter((r) => r.name !== name);
}

/**
 * Serialize a ConnectedRepo to a plain frontmatter object, omitting an empty
 * description so we never write `description: null` into a card.
 */
export function connectedRepoToFm(repo: ConnectedRepo): Record<string, unknown> {
  const out: Record<string, unknown> = { name: repo.name, path: repo.path };
  if (repo.description) out.description = repo.description;
  return out;
}
