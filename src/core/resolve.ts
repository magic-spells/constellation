import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export interface DiscoveredPlan {
  /** The constellation/ folder. */
  root: string;
  /** The folder whose code this plan describes. */
  codeRoot: string;
  /** POSIX-style code-root path relative to the scan root. */
  relPath: string;
}

export interface IdentifiedPlan extends DiscoveredPlan {
  id: string;
  aliases: string[];
}

const SKIP_DISCOVERY_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
  'tmp',
  'constellation',
]);

/**
 * Find the plan folder. With a target: the target itself or target/constellation.
 * Without: walk up from cwd looking for constellation/, bounded by the repo root.
 */
export async function resolvePlanDir(target?: string): Promise<string | null> {
  if (target) {
    const abs = path.resolve(target);
    const nested = path.join(abs, 'constellation');
    if (await isDirectory(nested)) return nested;
    // Only adopt the target itself when it actually looks like a plan root —
    // otherwise an explicit path to an unrelated directory would be linted or
    // served as if its markdown files were cards.
    if ((await isDirectory(abs)) && (await looksLikePlanRoot(abs))) return abs;
    return null;
  }
  return findPlanUp(process.cwd());
}

/**
 * Walk up from `startDir` for a `constellation/` folder, stopping at the repo
 * root (the first ancestor containing `.git`). Returns null rather than crossing
 * the repo boundary, so a repo with no plan never adopts a sibling repo's plan.
 */
export async function findPlanUp(startDir: string): Promise<string | null> {
  const repoRoot = await findRepoRoot(startDir);
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, 'constellation');
    if (await exists(candidate)) return candidate;
    // Stop at the repo root — never ascend past it into another repo.
    if (dir === repoRoot) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Find the first ancestor containing .git, or null outside a repository. */
export async function findRepoRoot(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  for (;;) {
    if (await exists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Find every plan beneath one scan root. Discovery is intentionally a one-shot,
 * bounded BFS: serving a newly-created plan requires a restart.
 */
export async function discoverPlans(
  scanRoot: string,
  opts: { maxDepth?: number } = {},
): Promise<DiscoveredPlan[]> {
  const root = path.resolve(scanRoot);
  const maxDepth = opts.maxDepth ?? 3;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const found: DiscoveredPlan[] = [];
  const { codeRootFor } = await import('./repos.js');

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current.dir !== root && (await exists(path.join(current.dir, '.git')))) {
      continue;
    }

    const planRoot = path.join(current.dir, 'constellation');
    if (await isFile(path.join(planRoot, 'plan.md'))) {
      const codeRoot = await codeRootFor(planRoot);
      found.push({
        root: planRoot,
        codeRoot,
        relPath: toPosix(path.relative(root, codeRoot)),
      });
    }

    if (current.depth >= maxDepth) continue;
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || SKIP_DISCOVERY_DIRS.has(entry.name)) continue;
      queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }

  return found.sort(comparePlans);
}

/** Ensure an upward-found plan is present when bounded discovery could not reach it. */
export async function includeDiscoveredPlan(
  plans: DiscoveredPlan[],
  scanRoot: string,
  planRoot: string,
): Promise<DiscoveredPlan[]> {
  const resolvedRoot = path.resolve(planRoot);
  if (plans.some((plan) => path.resolve(plan.root) === resolvedRoot)) return plans;
  const { codeRootFor } = await import('./repos.js');
  const codeRoot = await codeRootFor(resolvedRoot);
  return [
    ...plans,
    {
      root: resolvedRoot,
      codeRoot,
      relPath: toPosix(path.relative(path.resolve(scanRoot), codeRoot)),
    },
  ].sort(comparePlans);
}

/** Assign stable route IDs and aliases to an already-sorted discovered set. */
export function identifyPlans(plans: DiscoveredPlan[]): IdentifiedPlan[] {
  const sorted = [...plans].sort(comparePlans);
  const basenameSlugs = sorted.map((plan) => slugify(path.basename(plan.codeRoot)));
  const basenameCounts = new Map<string, number>();
  for (const slug of basenameSlugs) {
    if (slug) basenameCounts.set(slug, (basenameCounts.get(slug) ?? 0) + 1);
  }

  // Reserve every dashed path before choosing short IDs. This ensures an ID can
  // never shadow another plan's permanent path alias.
  const aliasKeys = new Set<string>(['root']);
  const dashed = sorted.map((plan) => {
    if (plan.relPath === '') return '';
    const base = slugify(plan.relPath) || 'plan';
    return uniqueKey(base, aliasKeys);
  });
  const used = new Set(aliasKeys);

  return sorted.map((plan, index) => {
    if (plan.relPath === '') return { ...plan, id: 'root', aliases: [] };
    const short = basenameSlugs[index];
    const alias = dashed[index];
    const desired = short && basenameCounts.get(short) === 1 ? short : alias;
    if (desired === alias) {
      return { ...plan, id: alias, aliases: [] };
    }
    const id = uniqueKey(desired, used);
    return { ...plan, id, aliases: [alias] };
  });
}

/** Cheap recursive markdown count shared by the roster and CLI banner. */
export async function countPlanCards(planRoot: string): Promise<number> {
  const queue = [path.resolve(planRoot)];
  let count = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const entries = await readdir(queue[index], { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(queue[index], entry.name);
      if (entry.isDirectory()) queue.push(abs);
      else if (entry.isFile() && entry.name.endsWith('.md')) count += 1;
    }
  }
  return count;
}

function comparePlans(a: DiscoveredPlan, b: DiscoveredPlan): number {
  if (a.relPath === '') return b.relPath === '' ? 0 : -1;
  if (b.relPath === '') return 1;
  return a.relPath.localeCompare(b.relPath);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function uniqueKey(base: string, used: Set<string>): string {
  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/** A directory is a plan root if it's named `constellation` or contains a plan.md. */
async function looksLikePlanRoot(dir: string): Promise<boolean> {
  if (path.basename(dir) === 'constellation') return true;
  return exists(path.join(dir, 'plan.md'));
}

export async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
