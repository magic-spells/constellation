import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planRootsFor } from '../src/core/git.js';
import { codeRootFor } from '../src/core/repos.js';
import { buildServer } from '../src/mcp/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let monoRepo: string;
let alphaRoot: string;
let alphaPlan: string;
let monoClient: Client | null = null;
let plainRepo: string;
let plainPlan: string;
let plainClient: Client | null = null;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function initGit(repo: string): void {
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
}

async function connect(planRoot: string): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ planRoot });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, any>> {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

async function writeBoundFiles(root: string): Promise<void> {
  await mkdir(path.join(root, 'src', 'api'), { recursive: true });
  await mkdir(path.join(root, 'src', 'types'), { recursive: true });
  await mkdir(path.join(root, 'src', 'styles'), { recursive: true });
  await writeFile(
    path.join(root, 'src', 'api', 'tickets.ts'),
    'export const tickets = 1; // ALPHA_V1\n',
  );
  await writeFile(path.join(root, 'src', 'types', 'ticket.ts'), 'export type Ticket = {};\n');
  await writeFile(path.join(root, 'src', 'styles', 'tokens.css'), ':root {}\n');
}

beforeAll(async () => {
  monoRepo = await mkdtemp(path.join(tmpdir(), 'constellation-monorepo-'));
  alphaRoot = path.join(monoRepo, 'packages', 'alpha');
  alphaPlan = path.join(alphaRoot, 'constellation');
  const betaRoot = path.join(monoRepo, 'packages', 'beta');

  await mkdir(path.join(monoRepo, 'constellation', 'file'), { recursive: true });
  await mkdir(path.join(betaRoot, 'constellation'), { recursive: true });
  await cp(GOLDEN, alphaPlan, { recursive: true });
  await writeBoundFiles(alphaRoot);
  await writeFile(path.join(alphaRoot, 'src', 'override.ts'), 'export const override = true;\n');
  await writeFile(
    path.join(alphaPlan, 'doc', 'DOC-MONOREPO-PATHS.md'),
    `---
name: Monorepo paths
code_refs:
  - src/api/tickets.ts
  - src/api/genuinely-absent.ts
---

Path resolution regression fixture.
`,
  );
  await writeFile(
    path.join(monoRepo, 'constellation', 'plan.md'),
    `---
name: Monorepo signpost
code_root: packages/alpha
connections:
  - FILE-OVERRIDE
connected_repos:
  - name: alpha
    path: packages/alpha
---

Points callers at the package plans.
`,
  );
  await writeFile(
    path.join(monoRepo, 'constellation', 'file', 'FILE-OVERRIDE.md'),
    `---
name: Overridden code root
path: src/override.ts
connections:
  - PLAN-PROJECT
---

Resolves through PLAN-PROJECT code_root.
`,
  );
  await writeFile(
    path.join(betaRoot, 'constellation', 'plan.md'),
    '---\nname: Beta\n---\n\n# Beta\n',
  );
  await writeFile(
    path.join(monoRepo, 'package.json'),
    JSON.stringify({ name: 'monorepo-shell', version: '9.9.9' }, null, 2) + '\n',
  );
  await writeFile(
    path.join(alphaRoot, 'package.json'),
    JSON.stringify({ name: 'alpha', version: '1.2.3' }, null, 2) + '\n',
  );
  await writeFile(
    path.join(betaRoot, 'package.json'),
    JSON.stringify({ name: 'beta', version: '2.0.0' }, null, 2) + '\n',
  );

  initGit(monoRepo);
  git(monoRepo, 'add', '-A');
  git(monoRepo, 'commit', '-q', '-m', 'initial monorepo');
  monoClient = await connect(path.join(monoRepo, 'constellation'));

  plainRepo = await mkdtemp(path.join(tmpdir(), 'constellation-plain-root-'));
  plainPlan = path.join(plainRepo, 'constellation');
  await cp(GOLDEN, plainPlan, { recursive: true });
  await writeBoundFiles(plainRepo);
  await writeFile(
    path.join(plainRepo, 'package.json'),
    JSON.stringify({ name: 'plain', version: '3.4.5' }, null, 2) + '\n',
  );
  initGit(plainRepo);
  git(plainRepo, 'add', '-A');
  git(plainRepo, 'commit', '-q', '-m', 'initial plain repo');
  plainClient = await connect(plainPlan);
});

afterAll(async () => {
  await monoClient?.close();
  await plainClient?.close();
  await rm(monoRepo, { recursive: true, force: true });
  await rm(plainRepo, { recursive: true, force: true });
});

describe('plan-scoped code roots in a monorepo', () => {
  it('resolves the package code root and translates it to a git prefix', async () => {
    expect(await codeRootFor(alphaPlan)).toBe(alphaRoot);
    const realAlpha = await realpath(alphaRoot);
    expect(await planRootsFor(alphaPlan)).toEqual({
      codeRoot: realAlpha,
      gitRoot: await realpath(monoRepo),
      prefix: 'packages/alpha',
    });
  });

  it('get_card resolves package files and reports only genuinely absent bindings', async () => {
    const res = await call(monoClient!, 'get_card', {
      repo: 'packages/alpha',
      handle: 'DOC-MONOREPO-PATHS',
      code: 'paths',
    });
    expect(res.code.repo_root).toBe(await realpath(alphaRoot));
    expect(res.code.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/api/tickets.ts', exists: true }),
        expect.objectContaining({ path: 'src/api/genuinely-absent.ts', exists: false }),
      ]),
    );
    expect(res.code.missing).toEqual(['src/api/genuinely-absent.ts']);
  });

  it('PLAN-PROJECT code_root overrides the directory containing the plan', async () => {
    const res = await call(monoClient!, 'get_card', {
      handle: 'FILE-OVERRIDE',
      code: 'paths',
    });
    expect(res.code.repo_root).toBe(await realpath(alphaRoot));
    expect(res.code.files).toEqual([
      expect.objectContaining({ path: 'src/override.ts', exists: true }),
    ]);
  });

  it('ignores beta-only commits for staleness, activity, and commit counts', async () => {
    await call(monoClient!, 'set_sync_point', { repo: 'packages/alpha' });
    await writeFile(path.join(monoRepo, 'packages', 'beta', 'beta.ts'), 'export const beta = 1;\n');
    git(monoRepo, 'add', 'packages/beta');
    git(monoRepo, 'commit', '-q', '-m', 'beta only');

    const stale = await call(monoClient!, 'stale_report', { repo: 'packages/alpha' });
    expect(stale.stale.map((card: { handle: string }) => card.handle)).not.toContain(
      'FILE-TICKETS-ROUTE',
    );

    const sync = await call(monoClient!, 'check_sync', { repo: 'packages/alpha' });
    expect(sync.code_commits_since_marker).toBe(0);
    const orient = await call(monoClient!, 'orient', { repo: 'packages/alpha' });
    expect(orient.versions.workspace).toBe('1.2.3');
    expect(orient.versions.workspace).not.toBe('9.9.9');
  });

  it('reports alpha changes in code-root-relative terms and counts only that commit', async () => {
    await writeFile(
      path.join(alphaRoot, 'src', 'api', 'tickets.ts'),
      'export const tickets = 2; // ALPHA_V2\n',
    );
    git(monoRepo, 'add', 'packages/alpha/src/api/tickets.ts');
    git(monoRepo, 'commit', '-q', '-m', 'alpha tickets');

    const report = await call(monoClient!, 'stale_report', { repo: 'packages/alpha' });
    const stale = report.stale.find(
      (card: { handle: string }) => card.handle === 'FILE-TICKETS-ROUTE',
    );
    expect(stale.changed_files).toContain('src/api/tickets.ts');
    expect(stale.changed_files).not.toContain('packages/alpha/src/api/tickets.ts');

    const sync = await call(monoClient!, 'check_sync', { repo: 'packages/alpha' });
    expect(sync.code_commits_since_marker).toBe(1);
  });

  it('set_verified warns about a dirty bound package file', async () => {
    await writeFile(
      path.join(alphaRoot, 'src', 'api', 'tickets.ts'),
      'export const tickets = 3; // DIRTY_ALPHA\n',
    );
    const res = await call(monoClient!, 'set_verified', {
      repo: 'packages/alpha',
      handle: 'API-TICKETS',
    });
    expect(res.warning).toContain('src/api/tickets.ts');
    expect(res.warning).not.toContain('packages/alpha/src/api/tickets.ts');
  });

  it('orient reports connected-repo reachability', async () => {
    const orient = await call(monoClient!, 'orient');
    expect(orient.connected_repos).toEqual([
      { name: 'alpha', path: 'packages/alpha', reachable: true },
    ]);
  });
});

describe('single-repo control', () => {
  it('keeps code and git roots identical and resolves bindings as before', async () => {
    expect(await codeRootFor(plainPlan)).toBe(plainRepo);
    const realPlain = await realpath(plainRepo);
    expect(await planRootsFor(plainPlan)).toEqual({
      codeRoot: realPlain,
      gitRoot: realPlain,
      prefix: '',
    });

    const card = await call(plainClient!, 'get_card', {
      handle: 'API-TICKETS',
      code: 'paths',
    });
    expect(card.code.files).toEqual([
      expect.objectContaining({ path: 'src/api/tickets.ts', exists: true }),
    ]);
    const orient = await call(plainClient!, 'orient');
    expect(orient.versions.workspace).toBe('3.4.5');
  });

  it('keeps stale paths, commit counts, and dirty warnings repo-relative', async () => {
    await call(plainClient!, 'set_sync_point');
    await writeFile(
      path.join(plainRepo, 'src', 'api', 'tickets.ts'),
      'export const tickets = 2; // PLAIN_V2\n',
    );
    git(plainRepo, 'add', 'src/api/tickets.ts');
    git(plainRepo, 'commit', '-q', '-m', 'plain tickets');

    const report = await call(plainClient!, 'stale_report');
    const stale = report.stale.find(
      (card: { handle: string }) => card.handle === 'FILE-TICKETS-ROUTE',
    );
    expect(stale.changed_files).toContain('src/api/tickets.ts');
    const sync = await call(plainClient!, 'check_sync');
    expect(sync.code_commits_since_marker).toBe(1);

    await writeFile(
      path.join(plainRepo, 'src', 'api', 'tickets.ts'),
      'export const tickets = 3; // DIRTY_PLAIN\n',
    );
    const verified = await call(plainClient!, 'set_verified', { handle: 'API-TICKETS' });
    expect(verified.warning).toContain('src/api/tickets.ts');
  });
});
