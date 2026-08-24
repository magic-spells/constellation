import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  discoverPlans,
  identifyPlans,
  type DiscoveredPlan,
} from '../src/core/resolve.js';

let repo: string;

async function plan(codePath: string, name = path.basename(codePath || repo)): Promise<void> {
  const root = path.join(repo, codePath, 'constellation');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'plan.md'), `---\nname: ${name}\n---\n`);
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-discover-'));
  await mkdir(path.join(repo, '.git'));

  await plan('', 'Root');
  await plan('apps/web', 'Web');
  await plan('packages/alpha', 'Alpha');
  await plan('packages/@scope/pkg', 'Scoped package');

  await plan('node_modules/pkg', 'Node modules decoy');
  await plan('packages/x/dist', 'Dist decoy');
  await plan('.turbo', 'Dot directory decoy');
  await plan('too/deep/for/the/limit', 'Depth decoy');
  await plan('vendor/sub', 'Vendor decoy');
  await mkdir(path.join(repo, 'vendor', 'sub', '.git'), { recursive: true });
  await plan('nested/repo', 'Nested repo decoy');
  await mkdir(path.join(repo, 'nested', 'repo', '.git'), { recursive: true });
  await mkdir(path.join(repo, 'packages', 'empty', 'constellation'), { recursive: true });
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('discoverPlans', () => {
  it('finds valid plans breadth-first within the depth bound and skips excluded trees', async () => {
    const plans = await discoverPlans(repo);
    expect(plans.map((entry) => entry.relPath)).toEqual([
      '',
      'apps/web',
      'packages/@scope/pkg',
      'packages/alpha',
    ]);
    expect(plans.map((entry) => entry.root)).toEqual(
      plans.map((entry) => path.join(entry.codeRoot, 'constellation')),
    );
  });

  it('honors a smaller explicit maxDepth', async () => {
    expect((await discoverPlans(repo, { maxDepth: 1 })).map((entry) => entry.relPath)).toEqual([
      '',
    ]);
  });
});

describe('plan identity', () => {
  const discovered = (...relPaths: string[]): DiscoveredPlan[] =>
    relPaths.map((relPath) => ({
      root: path.join('/repo', relPath, 'constellation'),
      codeRoot: path.join('/repo', relPath),
      relPath,
    }));

  it('uses short unique basenames and always retains the dashed path alias', () => {
    const plans = identifyPlans(discovered('packages/alpha', 'apps/web'));
    expect(plans.map(({ id, aliases }) => ({ id, aliases }))).toEqual([
      { id: 'web', aliases: ['apps-web'] },
      { id: 'alpha', aliases: ['packages-alpha'] },
    ]);
  });

  it('promotes duplicate basenames to their dashed paths', () => {
    const plans = identifyPlans(discovered('packages/admin', 'apps/admin'));
    expect(plans.map(({ id, aliases }) => ({ id, aliases }))).toEqual([
      { id: 'apps-admin', aliases: [] },
      { id: 'packages-admin', aliases: [] },
    ]);
  });

  it('keeps the repo-root id and suffixes a residual package collision in code-path order', () => {
    const plans = identifyPlans(discovered('packages/root', ''));
    expect(plans.map(({ relPath, id, aliases }) => ({ relPath, id, aliases }))).toEqual([
      { relPath: '', id: 'root', aliases: [] },
      { relPath: 'packages/root', id: 'root-2', aliases: ['packages-root'] },
    ]);
  });
});
