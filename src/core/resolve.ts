import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

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
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, 'constellation');
    if (await exists(candidate)) return candidate;
    // Stop at the repo root — never ascend past it into another repo.
    if (await exists(path.join(dir, '.git'))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
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
