import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codeMetrics } from '../src/core/code.js';
import { loadPlan } from '../src/core/indexer.js';
import { discoverPlans } from '../src/core/resolve.js';
import { startServer, type RunningServer } from '../src/serve/server.js';
import { sameOrigin } from './same-origin.js';

// The serve hardening around workspaces:
//   - the Host/Origin request guard (cross-site writes, DNS rebinding)
//   - a bad connected repo costs its own row, never the server start
//   - symlinks never let a read or write leave its repo / plan
//   - connected plans need a real plan.md in a real, contained folder
//
//   home/        launching repo, connects to every repo below
//   sibling/     a normal connected repo
//   locked/      its constellation/doc is chmod 000            → unavailable
//   linked/      constellation is a symlink to elsewhere/      → unavailable
//   noplan/      constellation/ without plan.md                → unavailable
//   rootcode/    root plan fine; packages/x sets code_root: ../../..
//                (outside the repo) and symlinks a font to a secret → that
//                plan unavailable, its id kept

let ws: string;
let home: string;
let running: RunningServer;

const PLAN = (name: string, extra = '') => `---\nname: ${name}\n${extra}---\n\n# ${name}\n`;
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

async function write(rel: string, content: string): Promise<void> {
  const file = path.join(ws, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

function gitRepo(dir: string): void {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: path.join(ws, dir), encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', `init ${dir}`);
}

function url(route: string): string {
  return `http://localhost:${running.port}${route}`;
}

/** A raw request, so the test controls Host (fetch always derives it). */
function raw(
  route: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: running.port, path: route, method: opts.method ?? 'GET', headers: opts.headers },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  ws = await mkdtemp(path.join(tmpdir(), 'constellation-hardening-'));
  home = path.join(ws, 'home');

  await write(
    'home/constellation/plan.md',
    PLAN(
      'Home',
      [
        'connected_repos:',
        '  - name: sibling',
        '    path: ../sibling',
        '  - name: locked',
        '    path: ../locked',
        '  - name: linked',
        '    path: ../linked',
        '  - name: noplan',
        '    path: ../noplan',
        '  - name: rootcode',
        '    path: ../rootcode',
        '',
      ].join('\n'),
    ),
  );
  gitRepo('home');

  await write('sibling/constellation/plan.md', PLAN('Sibling'));
  await write('sibling/fonts/ok.woff2', 'real-font');
  await write('secret.txt', 'TOP SECRET');
  await symlink('../../secret.txt', path.join(ws, 'sibling', 'fonts', 'leak.woff2'));
  await mkdir(path.join(ws, 'outside'), { recursive: true });
  await symlink('../../outside', path.join(ws, 'sibling', 'constellation', 'api'));
  await write('outside-marker.json', '{"untouched":true}\n');
  await symlink('../../outside-marker.json', path.join(ws, 'sibling', 'constellation', '.sync.json'));
  gitRepo('sibling');

  await write('locked/constellation/plan.md', PLAN('Locked'));
  await write('locked/constellation/doc/DOC-A.md', '---\nname: A\n---\n');
  gitRepo('locked');
  await chmod(path.join(ws, 'locked', 'constellation', 'doc'), 0o000);

  await write('elsewhere/constellation/plan.md', PLAN('Elsewhere'));
  await mkdir(path.join(ws, 'linked'), { recursive: true });
  await write('linked/README.md', 'linked\n');
  await symlink('../elsewhere/constellation', path.join(ws, 'linked', 'constellation'));
  gitRepo('linked');

  await write('noplan/constellation/doc/DOC-X.md', '---\nname: X\n---\n');
  gitRepo('noplan');

  await write('rootcode/constellation/plan.md', PLAN('Rootcode'));
  await write('rootcode/packages/x/constellation/plan.md', PLAN('Escaper', 'code_root: ../../..\n'));
  await symlink('../secret.txt', path.join(ws, 'rootcode', 'x.woff2'));
  gitRepo('rootcode');

  running = await startServer({ plans: await discoverPlans(home), scanRoot: home, port: 0 });
});

afterAll(async () => {
  await running?.close();
  await chmod(path.join(ws, 'locked', 'constellation', 'doc'), 0o755).catch(() => {});
  await rm(ws, { recursive: true, force: true });
});

describe('request guard', () => {
  const create = (headers: Record<string, string>) =>
    fetch(url('/api/p/sibling/cards'), {
      method: 'POST',
      headers,
      body: JSON.stringify({ handle: 'DOC-EVIL' }),
    });

  it('refuses a cross-site write, even a no-preflight text/plain one', async () => {
    const res = await create({ 'content-type': 'text/plain', origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
    const sync = await fetch(url('/api/p/sibling/sync-point'), {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    });
    expect(sync.status).toBe(403);
    await expect(stat(path.join(ws, 'sibling', 'constellation', 'doc', 'DOC-EVIL.md'))).rejects.toThrow();
  });

  it('refuses a write with no Origin at all', async () => {
    const res = await create({ 'content-type': 'application/json' });
    expect(res.status).toBe(403);
    const del = await fetch(url('/api/card/PLAN-PROJECT'), { method: 'DELETE' });
    expect(del.status).toBe(403);
  });

  it('refuses a foreign Host on every route, reads and SSE included', async () => {
    for (const route of ['/api/plans', '/api/p/sibling/plan', '/events', '/']) {
      const res = await raw(route, { headers: { host: `evil.example:${running.port}` } });
      expect(res.status, route).toBe(403);
    }
  });

  it('accepts every loopback spelling of this server', async () => {
    for (const host of [`localhost:${running.port}`, `127.0.0.1:${running.port}`, `[::1]:${running.port}`]) {
      const res = await raw('/api/plans', { headers: { host } });
      expect(res.status, host).toBe(200);
    }
    const res = await raw('/api/p/sibling/sync-point', {
      method: 'POST',
      headers: { host: `127.0.0.1:${running.port}`, origin: `http://127.0.0.1:${running.port}` },
    });
    expect(res.status).toBe(200);
  });

  it('accepts a same-origin write into a connected plan', async () => {
    const res = await fetch(
      url('/api/p/sibling/cards'),
      sameOrigin(running.port, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'DOC-OK', name: 'Fine' }),
      }),
    );
    expect(res.status).toBe(201);
    expect(await readFile(path.join(ws, 'sibling', 'constellation', 'doc', 'DOC-OK.md'), 'utf8')).toContain('Fine');
  });

  it('lets an explicit loopback dev origin through, and nothing else', async () => {
    const dev = await startServer({
      planRoot: path.join(ws, 'sibling', 'constellation'),
      port: 0,
      devOrigins: ['http://localhost:3999'],
    });
    try {
      const ok = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: dev.port,
            path: '/api/sync-point',
            method: 'POST',
            headers: { host: 'localhost:3999', origin: 'http://localhost:3999' },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(ok).toBe(200);
      // A forwarded port (ssh -L 8080:…) carries its own Host on every read.
      for (const [host, want] of [
        ['localhost:3999', 200],
        ['127.0.0.1:3999', 200],
        ['localhost:4000', 403],
      ] as const) {
        const status = await new Promise<number>((resolve, reject) => {
          const req = http.request(
            { host: '127.0.0.1', port: dev.port, path: '/api/plans', headers: { host } },
            (res) => {
              res.resume();
              resolve(res.statusCode ?? 0);
            },
          );
          req.on('error', reject);
          req.end();
        });
        expect(status, host).toBe(want);
      }
    } finally {
      await dev.close();
    }
    await expect(
      startServer({
        planRoot: path.join(ws, 'sibling', 'constellation'),
        port: 0,
        devOrigins: ['https://evil.example'],
      }),
    ).rejects.toThrow(/Dev origin/);
  });
});

describe('connected repo failures', () => {
  it.skipIf(IS_ROOT)('turns an unreadable connected plan into an unavailable row', async () => {
    const data = await (await fetch(url('/api/plans'))).json();
    const locked = data.plans.find((p: { id: string }) => p.id === 'locked');
    expect(locked).toMatchObject({ available: false, cards: 0 });
    expect(locked.reason).toMatch(/Cannot read \.\.\/locked/);
    expect((await fetch(url('/api/p/locked/plan'))).status).toBe(404);
  });

  it('refuses a plan folder that is a symlink, and one without plan.md', async () => {
    const data = await (await fetch(url('/api/plans'))).json();
    expect(data.plans.find((p: { id: string }) => p.id === 'linked')).toMatchObject({
      available: false,
      reason: 'No constellation/ plan in ../linked',
    });
    expect(data.plans.find((p: { id: string }) => p.id === 'noplan')).toMatchObject({
      available: false,
      reason: 'No constellation/ plan in ../noplan',
    });
    expect(data.plans.some((p: { name: string }) => p.name === 'Elsewhere')).toBe(false);
  });
});

describe('connected code_root', () => {
  it('refuses a connected plan whose code_root leaves its repo, keeping its id', async () => {
    const data = await (await fetch(url('/api/plans'))).json();
    const rows = data.plans.filter((p: { repo: { name: string } }) => p.repo.name === 'rootcode');
    expect(rows.map((p: { id: string; available: boolean }) => [p.id, p.available])).toEqual([
      ['rootcode', true],
      ['rootcode-x', false],
    ]);
    expect(rows[1].reason).toBe('code_root leaves the repo: ../rootcode');
    const leak = await fetch(url('/api/p/rootcode-x/style-asset?path=rootcode/x.woff2'));
    expect(leak.status).toBe(404);
    expect(await leak.text()).not.toContain('TOP SECRET');
  });

  it('bounds code metrics by the repo', async () => {
    const index = await loadPlan(path.join(ws, 'rootcode', 'packages', 'x', 'constellation'));
    expect(await codeMetrics(index, { bound: path.join(ws, 'rootcode') })).toEqual({});
  });
});

describe('symlinks never leave the repo', () => {
  it('serves a real font but not a symlink out of the repo', async () => {
    const ok = await fetch(url('/api/p/sibling/style-asset?path=fonts/ok.woff2'));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('real-font');
    const leak = await fetch(url('/api/p/sibling/style-asset?path=fonts/leak.woff2'));
    expect(leak.status).toBe(403);
    expect(await leak.text()).not.toContain('TOP SECRET');
  });

  it('will not create a card through a symlinked type folder', async () => {
    const res = await fetch(
      url('/api/p/sibling/cards'),
      sameOrigin(running.port, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: 'API-ESCAPE' }),
      }),
    );
    expect(res.status).toBe(403);
    await expect(stat(path.join(ws, 'outside', 'API-ESCAPE.md'))).rejects.toThrow();
  });

  it('replaces a symlinked sync marker instead of writing through it', async () => {
    const res = await fetch(
      url('/api/p/sibling/sync-point'),
      sameOrigin(running.port, { method: 'POST' }),
    );
    expect(res.status).toBe(200);
    expect(await readFile(path.join(ws, 'outside-marker.json'), 'utf8')).toBe('{"untouched":true}\n');
  });
});
