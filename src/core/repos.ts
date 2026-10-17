import path from 'node:path';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { parseFile } from './parse.js';
import {
  discoverPlans,
  findRepoRoot,
  includeDiscoveredPlan,
  resolvePlanDir,
  type DiscoveredPlan,
} from './resolve.js';
import type { ConnectedRepo } from './types.js';

/**
 * Connected repos are repo-level links declared on PLAN-PROJECT (plan.md).
 * They never become card connections and the indexer never sees them — they
 * are read on demand here, so a connected repo's plan can be resolved and
 * targeted by the `repo` selector without ever merging two plans.
 */

/**
 * The directory containing the plan folder. `connected_repos` paths resolve
 * against THIS, always — never against PLAN-PROJECT's `code_root` override,
 * which relocates where a plan's own code lives (that is `codeRootFor`'s job)
 * and says nothing about where sibling repos sit.
 */
function repoRootOf(planRoot: string): string {
  return path.dirname(planRoot);
}

/**
 * The folder whose code this plan describes. PLAN-PROJECT may override the
 * default (the directory containing constellation/) with a relative or absolute
 * `code_root` path — but only one that stays inside the plan's repository (see
 * resolveCodeRoot). One that leaves it falls back to the default, so no reader
 * or writer downstream can be steered outside the repo by a cloned plan.md.
 */
export async function codeRootFor(planRoot: string): Promise<string> {
  return (await resolveCodeRoot(planRoot)).codeRoot;
}

export interface CodeRootResolution {
  /** The code root to use: `code_root` when it stays inside, else the default. */
  codeRoot: string;
  /** Why a configured `code_root` was refused, or null. */
  escape: string | null;
}

/** realpath of `p`, or of its deepest existing ancestor with the rest re-joined. */
async function realpathLoose(p: string): Promise<string> {
  const abs = path.resolve(p);
  const rest: string[] = [];
  let dir = abs;
  for (;;) {
    try {
      return path.join(await realpath(dir), ...rest.reverse());
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return abs;
      rest.push(path.basename(dir));
      dir = parent;
    }
  }
}

/**
 * Resolve `code_root`, bounded. plan.md is repo content, so a cloned repo
 * controls it: `code_root: ../victim` must not move `.constellation/`, the
 * `.gitignore` write or any code read into another project. Its real path must
 * lie inside the plan's git repository — or, outside git, inside the folder
 * that contains the plan. Otherwise the default root is used and `escape` says
 * why. Never throws.
 */
export async function resolveCodeRoot(planRoot: string): Promise<CodeRootResolution> {
  const defaultRoot = path.dirname(planRoot);
  let configured: unknown;
  try {
    configured = parseFile(await readFile(path.join(planRoot, 'plan.md'), 'utf8')).frontmatter.code_root;
  } catch {
    return { codeRoot: defaultRoot, escape: null };
  }
  if (typeof configured !== 'string') return { codeRoot: defaultRoot, escape: null };
  const resolved = path.resolve(defaultRoot, configured);
  const realPlan = await realpathLoose(planRoot);
  const repo = await findRepoRoot(realPlan);
  const bound = await realpathLoose(repo ?? path.dirname(realPlan));
  const real = await realpathLoose(resolved);
  if (real === bound || real.startsWith(bound + path.sep)) return { codeRoot: resolved, escape: null };
  return {
    codeRoot: defaultRoot,
    escape:
      `code_root ${JSON.stringify(configured)} in ${JSON.stringify(path.join(planRoot, 'plan.md'))} ` +
      `leaves ${repo ? 'the repository' : 'the folder that holds the plan'} (${JSON.stringify(bound)})`,
  };
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
  return connectedReposFromFrontmatter(parseFile(raw).frontmatter);
}

/** The lenient connected_repos parse, for callers that already hold plan.md's frontmatter. */
export function connectedReposFromFrontmatter(
  frontmatter: Record<string, unknown>,
): ConnectedRepo[] {
  const list = frontmatter.connected_repos;
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

/**
 * A connected repo as a viewer workspace: its plans, discovered the way `serve`
 * discovers the home repo's (bounded BFS that never enters another `.git`), or
 * the reason it cannot be served. One level only — the connected repo's own
 * `connected_repos` are never read here.
 */
export type ConnectedWorkspace =
  | {
      repo: ConnectedRepo;
      /** The declared path, resolved against the home repo root. */
      abs: string;
      available: true;
      /** The connected repo's git root: its git state and asset fallback. */
      gitRoot: string;
      /** Where its plans were discovered from; plan paths are relative to this. */
      scanRoot: string;
      plans: DiscoveredPlan[];
      /** Real plans refused anyway (a `code_root` outside the repo). */
      rejected: RejectedPlan[];
    }
  | { repo: ConnectedRepo; abs: string; available: false; reason: string };

export interface RejectedPlan {
  plan: DiscoveredPlan;
  reason: string;
}

/**
 * Resolve every `connected_repos` entry on the home plan into a workspace.
 * Never throws for a bad entry: a missing path, a non-git directory or a repo
 * without a plan comes back `available: false` with a reason.
 */
export async function discoverConnectedWorkspaces(
  homePlanRoot: string,
): Promise<ConnectedWorkspace[]> {
  const repos = await readConnectedRepos(homePlanRoot);
  return Promise.all(
    repos.map(async (repo): Promise<ConnectedWorkspace> => {
      const abs = path.isAbsolute(repo.path)
        ? path.resolve(repo.path)
        : path.resolve(repoRootOf(homePlanRoot), repo.path);
      const down = (reason: string): ConnectedWorkspace => ({
        repo,
        abs,
        available: false,
        reason,
      });
      try {
        const info = await stat(abs).catch(() => null);
        if (!info) return down(`Path not found: ${repo.path}`);
        if (!info.isDirectory()) return down(`Not a directory: ${repo.path}`);
        const gitRoot = await findRepoRoot(abs);
        if (!gitRoot) return down(`Not a git repository: ${repo.path}`);
        // A path naming the plan folder itself scans from the folder above it.
        const direct = await resolvePlanDir(abs);
        const scanRoot = direct && path.resolve(direct) === abs ? path.dirname(abs) : abs;
        let plans = await discoverPlans(scanRoot);
        if (direct) plans = await includeDiscoveredPlan(plans, scanRoot, direct);
        // Stricter than local discovery, because these plans are served and
        // written from another repo's viewer: a plan needs a real plan.md, and
        // its folder must be a real directory whose real path stays inside the
        // connected repo — no symlink out to node_modules or anywhere else.
        const realScan = await realpath(scanRoot);
        const kept: DiscoveredPlan[] = [];
        for (const plan of plans) {
          if (await isServablePlan(plan.root, realScan)) kept.push(plan);
        }
        if (kept.length === 0) return down(`No constellation/ plan in ${repo.path}`);
        // A plan's `code_root` is the connected repo's own, untrusted say-so,
        // and every code read (style assets, metrics, drift) resolves under
        // it. One whose real path leaves the repo is refused, reported rather
        // than dropped so it never disappears silently.
        const realGit = await realpath(gitRoot);
        plans = [];
        const rejected: RejectedPlan[] = [];
        for (const plan of kept) {
          // plan.codeRoot is already bounded (codeRootFor falls back when
          // code_root escapes), so ask resolveCodeRoot whether it had to.
          const real = await realpath(plan.codeRoot).catch(() => null);
          const { escape } = await resolveCodeRoot(plan.root);
          if (!escape && real && (real === realGit || real.startsWith(realGit + path.sep))) plans.push(plan);
          else {
            // Identified by its plan folder, so nothing outside the repo (the
            // escaping code_root's name) shapes its id or paths.
            const home = path.dirname(plan.root);
            const relPath = path.relative(scanRoot, home).split(path.sep).join('/');
            rejected.push({
              plan: { ...plan, codeRoot: home, relPath },
              reason: `code_root leaves the repo: ${repo.path}`,
            });
          }
        }
        return { repo, abs, available: true, gitRoot, scanRoot, plans, rejected };
      } catch (err) {
        return down(err instanceof Error ? err.message : String(err));
      }
    }),
  );
}

async function isServablePlan(planRoot: string, realRepoRoot: string): Promise<boolean> {
  try {
    if ((await lstat(planRoot)).isSymbolicLink()) return false;
    if (!(await stat(path.join(planRoot, 'plan.md'))).isFile()) return false;
    const real = await realpath(planRoot);
    return real.startsWith(realRepoRoot + path.sep);
  } catch {
    return false;
  }
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
