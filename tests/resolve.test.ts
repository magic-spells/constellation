import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findPlanUp, resolvePlanDir } from '../src/core/resolve.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'constellation-resolve-'));
  // A constellation/ at the very top — the "sibling/dev repo" that must NOT leak.
  await mkdir(path.join(root, 'constellation'), { recursive: true });
  // repoA: a git repo with NO plan.
  await mkdir(path.join(root, 'repoA', '.git'), { recursive: true });
  await mkdir(path.join(root, 'repoA', 'sub'), { recursive: true });
  // repoB: a git repo WITH a plan.
  await mkdir(path.join(root, 'repoB', '.git'), { recursive: true });
  await mkdir(path.join(root, 'repoB', 'constellation'), { recursive: true });
  await mkdir(path.join(root, 'repoB', 'sub', 'deep'), { recursive: true });
  // A non-repo directory that is a plan root only by virtue of containing plan.md.
  await mkdir(path.join(root, 'loose-plan'), { recursive: true });
  await writeFile(path.join(root, 'loose-plan', 'plan.md'), 'name: Loose\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('findPlanUp (repo-bounded)', () => {
  it('returns null inside a repo with no plan — never adopts an ancestor plan', async () => {
    expect(await findPlanUp(path.join(root, 'repoA', 'sub'))).toBeNull();
    expect(await findPlanUp(path.join(root, 'repoA'))).toBeNull();
  });

  it('finds the plan at or above the start, within the repo', async () => {
    expect(await findPlanUp(path.join(root, 'repoB', 'sub', 'deep'))).toBe(
      path.join(root, 'repoB', 'constellation'),
    );
    expect(await findPlanUp(path.join(root, 'repoB'))).toBe(
      path.join(root, 'repoB', 'constellation'),
    );
  });

  it('finds a plan present at the start dir even outside any repo', async () => {
    expect(await findPlanUp(root)).toBe(path.join(root, 'constellation'));
  });
});

describe('resolvePlanDir', () => {
  it('does not treat an explicit file path as an empty plan folder', async () => {
    const file = path.join(root, 'package.json');
    await writeFile(file, '{}\n');
    expect(await resolvePlanDir(file)).toBeNull();
  });

  it('resolves an explicit target by its constellation/ child', async () => {
    expect(await resolvePlanDir(path.join(root, 'repoB'))).toBe(
      path.join(root, 'repoB', 'constellation'),
    );
  });

  it('resolves an explicit path that is itself a plan root', async () => {
    // Named `constellation`...
    expect(await resolvePlanDir(path.join(root, 'constellation'))).toBe(
      path.join(root, 'constellation'),
    );
    // ...or any directory that contains plan.md.
    expect(await resolvePlanDir(path.join(root, 'loose-plan'))).toBe(
      path.join(root, 'loose-plan'),
    );
  });

  it('returns null for an explicit directory that does not look like a plan', async () => {
    // repoA exists but has no constellation/ child, is not named constellation,
    // and has no plan.md — it must not be adopted and linted as if it were a plan.
    expect(await resolvePlanDir(path.join(root, 'repoA'))).toBeNull();
    expect(await resolvePlanDir(path.join(root, 'repoA', 'sub'))).toBeNull();
  });
});
