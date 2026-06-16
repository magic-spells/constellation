import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectedRepoToFm,
  listConnectedRepos,
  readConnectedRepos,
  removeConnectedRepoEntry,
  resolveConnectedRepo,
  upsertConnectedRepo,
} from '../src/core/repos.js';

let base: string;
let webPlan: string;
let serverPlan: string;

const webPlanMd = `---
name: Pyramid Web
connected_repos:
  - name: pyramid-server
    path: ../pyramid-server
    description: Back-end API, Go.
  - name: ghost
    path: ../does-not-exist
  - { not: valid }
---

# Pyramid Web
`;

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'constellation-repos-'));
  webPlan = path.join(base, 'pyramid-web', 'constellation');
  serverPlan = path.join(base, 'pyramid-server', 'constellation');
  await mkdir(webPlan, { recursive: true });
  await mkdir(serverPlan, { recursive: true });
  await writeFile(path.join(webPlan, 'plan.md'), webPlanMd);
  await writeFile(
    path.join(serverPlan, 'plan.md'),
    '---\nname: Pyramid Server\n---\n\n# Pyramid Server\n',
  );
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('readConnectedRepos', () => {
  it('parses valid entries and silently skips malformed ones', async () => {
    const repos = await readConnectedRepos(webPlan);
    expect(repos.map((r) => r.name)).toEqual(['pyramid-server', 'ghost']);
    expect(repos[0]).toMatchObject({
      name: 'pyramid-server',
      path: '../pyramid-server',
      description: 'Back-end API, Go.',
    });
  });

  it('returns [] when a plan declares none', async () => {
    expect(await readConnectedRepos(serverPlan)).toEqual([]);
  });
});

describe('resolveConnectedRepo', () => {
  it('resolves by connected_repos name to the sibling plan dir', async () => {
    const r = await resolveConnectedRepo(webPlan, 'pyramid-server');
    expect(r?.root).toBe(serverPlan);
    expect(r?.name).toBe('pyramid-server');
  });

  it('resolves by a raw relative path', async () => {
    const r = await resolveConnectedRepo(webPlan, '../pyramid-server');
    expect(r?.root).toBe(serverPlan);
    expect(r?.name).toBeNull();
  });

  it('returns null for an unknown name', async () => {
    expect(await resolveConnectedRepo(webPlan, 'nope')).toBeNull();
  });

  it('returns null for a declared-but-missing path', async () => {
    expect(await resolveConnectedRepo(webPlan, 'ghost')).toBeNull();
  });
});

describe('listConnectedRepos', () => {
  it('annotates reachability without erroring on a missing path', async () => {
    const repos = await listConnectedRepos(webPlan);
    expect(repos.find((r) => r.name === 'pyramid-server')?.reachable).toBe(true);
    expect(repos.find((r) => r.name === 'ghost')?.reachable).toBe(false);
  });
});

describe('pure list helpers', () => {
  it('upsert replaces by name', () => {
    const out = upsertConnectedRepo([{ name: 'a', path: 'x' }], {
      name: 'a',
      path: 'y',
      description: 'd',
    });
    expect(out).toEqual([{ name: 'a', path: 'y', description: 'd' }]);
  });

  it('remove drops by name', () => {
    expect(
      removeConnectedRepoEntry([{ name: 'a', path: 'x' }, { name: 'b', path: 'y' }], 'a'),
    ).toEqual([{ name: 'b', path: 'y' }]);
  });

  it('connectedRepoToFm omits an empty description', () => {
    expect(connectedRepoToFm({ name: 'a', path: 'x' })).toEqual({ name: 'a', path: 'x' });
    expect(connectedRepoToFm({ name: 'a', path: 'x', description: 'd' })).toEqual({
      name: 'a',
      path: 'x',
      description: 'd',
    });
  });
});
