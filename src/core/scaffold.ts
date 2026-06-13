import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const STARTER_PLAN = `---
name: Project plan
---

# Project Plan

## Current state

- (what exists, what is in flight)

## Conventions

- (project-wide rules cards should follow)

## Last synced

Code has not been reconciled against this plan yet.
`;

/** Create constellation/ with a starter plan.md. Throws if it already exists. */
export async function initPlan(targetDir: string): Promise<string> {
  const root = path.resolve(targetDir, 'constellation');
  try {
    await access(root);
    throw new Error(`${root} already exists`);
  } catch (err) {
    if (err instanceof Error && err.message.endsWith('already exists')) throw err;
  }
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'plan.md'), STARTER_PLAN, { flag: 'wx' });
  return root;
}
