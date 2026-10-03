import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverPlans } from '../src/core/resolve.js';
import { startServer, type RunningServer } from '../src/serve/server.js';

// Workspaces: `serve` adds the launching repo's PLAN-PROJECT `connected_repos`
// to the roster, one level deep, each served from its own repo.
//
//   home/       launching repo: root plan + packages/docs (id `docs`)
//   sibling/    connected, own git + tag, declares `far` (never followed)
//   mono/       connected monorepo: root plan + packages/api
//   docsrepo/   connected as `docs` — collides with home's `docs`
//   far/        a plan only `sibling` declares
//   plain/      exists, not a git repo        → unavailable
//   bare/       git repo with no plan         → unavailable
//   ghost       declared, missing             → unavailable
//   inner       declared as packages/docs     → already served, not doubled

let ws: string;
let home: string;
let running: RunningServer;

const PLAN = (name: string, extra = '') => `---\nname: ${name}\n${extra}---\n\n# ${name}\n`;

async function write(rel: string, content: string): Promise<void> {
  const file = path.join(ws, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: path.join(ws, dir), encoding: 'utf8' }).trim();
}

function gitRepo(dir: string): void {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `init ${dir}`);
}

async function serveHome(): Promise<RunningServer> {
  return startServer({ plans: await discoverPlans(home), scanRoot: home, port: 0 });
}

function api(server: RunningServer, route: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://localhost:${server.port}${route}`, init);
}

beforeAll(async () => {
  ws = await mkdtemp(path.join(tmpdir(), 'constellation-workspaces-'));
  home = path.join(ws, 'home');

  await write(
    'home/constellation/plan.md',
    PLAN(
      'Home',
      [
        'connected_repos:',
        '  - name: sibling',
        '    path: ../sibling',
        '    description: The sibling repo.',
        '  - name: ghost',
        '    path: ../ghost',
        '  - name: plain',
        '    path: ../plain',
        '  - name: bare',
        '    path: ../bare',
        '  - name: mono',
        '    path: ../mono',
        '  - name: docs',
        '    path: ../docsrepo',
        '  - name: inner',
        '    path: packages/docs',
        '',
      ].join('\n'),
    ),
  );
  await write('home/packages/docs/constellation/plan.md', PLAN('Home Docs'));
  gitRepo('home');
  git('home', 'tag', 'v1.0.0');

  await write(
    'sibling/constellation/plan.md',
    PLAN('Sibling', 'connected_repos:\n  - name: far\n    path: ../far\n'),
  );
  await write('sibling/constellation/doc/DOC-NOTE.md', '---\nname: Note\n---\n\nA note.\n');
  gitRepo('sibling');
  git('sibling', 'tag', 'v9.9.9');

  await write('mono/constellation/plan.md', PLAN('Mono'));
  await write('mono/packages/api/constellation/plan.md', PLAN('Mono API'));
  gitRepo('mono');

  await write('docsrepo/constellation/plan.md', PLAN('Docs Repo'));
  gitRepo('docsrepo');

  await write('far/constellation/plan.md', PLAN('Far'));
  gitRepo('far');

  await write('plain/constellation/plan.md', PLAN('Plain'));
  await write('bare/README.md', 'no plan here\n');
  gitRepo('bare');

  running = await serveHome();
});

afterAll(async () => {
  await running?.close();
  await rm(ws, { recursive: true, force: true });
});

describe('workspace roster', () => {
  it('lists this repo, then each connected repo in declaration order', async () => {
    const data = await (await api(running, '/api/plans')).json();
    expect(data.multi).toBe(true);
    expect(data.default).toBe('root');
    expect(
      data.plans.map((p: { id: string; available: boolean }) => [p.id, p.available]),
    ).toEqual([
      ['root', true],
      ['docs', true],
      ['sibling', true],
      ['ghost', false],
      ['plain', false],
      ['bare', false],
      ['mono', true],
      ['mono-api', true],
      ['docs-2', true],
    ]);

    const byId = new Map(data.plans.map((p: { id: string }) => [p.id, p]));
    expect(byId.get('root')).toMatchObject({
      name: 'Home',
      code_path: '',
      plan_path: 'constellation',
      default: true,
      repo: { name: 'home', path: '.', root: home, kind: 'self' },
    });
    expect(byId.get('sibling')).toEqual({
      id: 'sibling',
      aliases: [],
      name: 'Sibling',
      code_path: '',
      plan_path: 'constellation',
      cards: 2,
      default: false,
      available: true,
      repo: {
        name: 'sibling',
        path: '../sibling',
        root: path.join(ws, 'sibling'),
        kind: 'connected',
        description: 'The sibling repo.',
      },
    });
    expect(byId.get('mono-api')).toMatchObject({
      name: 'Mono API',
      code_path: 'packages/api',
      plan_path: 'packages/api/constellation',
      aliases: ['mono-packages-api'],
      repo: { name: 'mono', kind: 'connected' },
    });
  });

  it('lists unreachable repos as unavailable with a reason', async () => {
    const data = await (await api(running, '/api/plans')).json();
    const down = data.plans.filter((p: { available: boolean }) => !p.available);
    expect(down).toEqual([
      expect.objectContaining({
        id: 'ghost',
        name: 'ghost',
        cards: 0,
        reason: 'Path not found: ../ghost',
        repo: expect.objectContaining({ kind: 'connected', path: '../ghost' }),
      }),
      expect.objectContaining({ id: 'plain', reason: 'Not a git repository: ../plain' }),
      expect.objectContaining({ id: 'bare', reason: 'No constellation/ plan in ../bare' }),
    ]);
    expect(running.unavailable.map((u) => u.id)).toEqual(['ghost', 'plain', 'bare']);
  });

  it('never serves a plan twice when a connected path is inside this repo', async () => {
    const data = await (await api(running, '/api/plans')).json();
    const names = data.plans.map((p: { name: string }) => p.name);
    expect(names.filter((n: string) => n === 'Home Docs')).toHaveLength(1);
    expect(data.plans.some((p: { id: string }) => p.id === 'inner')).toBe(false);
  });

  it('follows one level only', async () => {
    const data = await (await api(running, '/api/plans')).json();
    expect(data.plans.some((p: { name: string }) => p.name === 'Far')).toBe(false);
    // The connected repo's own connected_repos are not served even from inside it.
    const res = await api(running, '/api/p/far/plan');
    expect(res.status).toBe(404);
  });

  it('keeps ids stable when an unavailable repo comes back', async () => {
    await write('ghost/constellation/plan.md', PLAN('Ghost'));
    gitRepo('ghost');
    const second = await serveHome();
    try {
      const data = await (await api(second, '/api/plans')).json();
      expect(data.plans.map((p: { id: string }) => p.id)).toEqual([
        'root',
        'docs',
        'sibling',
        'ghost',
        'plain',
        'bare',
        'mono',
        'mono-api',
        'docs-2',
      ]);
      expect(data.plans.find((p: { id: string }) => p.id === 'ghost')).toMatchObject({
        name: 'Ghost',
        available: true,
      });
    } finally {
      await second.close();
      await rm(path.join(ws, 'ghost'), { recursive: true, force: true });
    }
  });
});

describe('connected plan routes', () => {
  it('returns a JSON 404 for an unknown or unavailable id', async () => {
    for (const id of ['nope', 'ghost', 'plain']) {
      const res = await api(running, `/api/p/${id}/plan`);
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe('UNKNOWN_PLAN');
    }
  });

  it("serves the connected plan's own cards", async () => {
    const data = await (await api(running, '/api/p/sibling/plan')).json();
    expect(data.cards.map((c: { handle: string }) => c.handle).sort()).toEqual([
      'DOC-NOTE',
      'PLAN-PROJECT',
    ]);
  });

  it("computes sync against the connected repo's own git", async () => {
    const sibling = await (await api(running, '/api/p/sibling/sync')).json();
    const root = await (await api(running, '/api/p/root/sync')).json();
    expect(sibling.latest_tag).toBe('v9.9.9');
    expect(root.latest_tag).toBe('v1.0.0');
    expect(sibling.activity[0]?.subject).toBe('init sibling');

    const res = await api(running, '/api/p/sibling/sync-point', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.marker.synced_sha).toBe(git('sibling', 'rev-parse', 'HEAD'));
    expect(body.marker.synced_sha).not.toBe(git('home', 'rev-parse', 'HEAD'));
    const marker = JSON.parse(
      await readFile(path.join(ws, 'sibling', 'constellation', '.sync.json'), 'utf8'),
    );
    expect(marker.synced_sha).toBe(git('sibling', 'rev-parse', 'HEAD'));
    await expect(stat(path.join(home, 'constellation', '.sync.json'))).rejects.toThrow();
  });

  it("writes a viewer edit into the connected repo's files", async () => {
    const created = await api(running, '/api/p/sibling/cards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'DOC-FROM-VIEWER', name: 'From the viewer' }),
    });
    expect(created.status).toBe(201);
    const file = path.join(ws, 'sibling', 'constellation', 'doc', 'DOC-FROM-VIEWER.md');
    expect(await readFile(file, 'utf8')).toContain('name: From the viewer');
    await expect(
      stat(path.join(home, 'constellation', 'doc', 'DOC-FROM-VIEWER.md')),
    ).rejects.toThrow();

    const patched = await api(running, '/api/p/sibling/card/DOC-NOTE', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'built' }),
    });
    expect(patched.status).toBe(200);
    expect(
      await readFile(path.join(ws, 'sibling', 'constellation', 'doc', 'DOC-NOTE.md'), 'utf8'),
    ).toContain('status: built');
  });

  it('serves a single-plan launch with its connected repos too', async () => {
    const single = await startServer({ planRoot: path.join(ws, 'sibling', 'constellation'), port: 0 });
    try {
      const data = await (await api(single, '/api/plans')).json();
      // sibling declares only `far`; one level from sibling is far.
      expect(data.plans.map((p: { id: string }) => p.id)).toEqual(['root', 'far']);
      expect(data.multi).toBe(true);
    } finally {
      await single.close();
    }
  });
});
