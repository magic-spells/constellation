import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Turn a folder slug into a human-readable project name: pyramid-server → Pyramid Server. */
export function titleCaseFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ') // kebab / snake → spaces
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // split camelCase
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The starter plan.md body, parameterized by the project's display name. */
export function starterPlan(name: string): string {
  return `---
name: ${name}
---

# Project Plan

## Current state

- (what exists, what is in flight)

## Conventions

- (project-wide rules cards should follow)

## Last synced

Code has not been reconciled against this plan yet.
`;
}

/**
 * Create constellation/ with a starter plan.md. Throws if it already exists.
 * The project name defaults to a title-cased version of the target folder
 * (so pyramid-server → "Pyramid Server"); pass opts.name to override it. The
 * resolved name is returned so callers can echo / confirm it.
 */
export async function initPlan(
  targetDir: string,
  opts: { name?: string } = {},
): Promise<{ root: string; name: string }> {
  const resolvedTarget = path.resolve(targetDir);
  const root = path.join(resolvedTarget, 'constellation');
  const name =
    opts.name?.trim() ||
    titleCaseFromSlug(path.basename(resolvedTarget)) ||
    'Project plan';
  try {
    await access(root);
    throw new Error(`${root} already exists`);
  } catch (err) {
    if (err instanceof Error && err.message.endsWith('already exists')) throw err;
  }
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'plan.md'), starterPlan(name), { flag: 'wx' });
  return { root, name };
}
