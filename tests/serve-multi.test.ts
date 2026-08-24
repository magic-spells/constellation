import { execFileSync } from 'node:child_process';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverPlans } from '../src/core/resolve.js';
import { startServer, type RunningServer } from '../src/serve/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let repo: string;
let alphaPlan: string;
let betaPlan: string;
let running: RunningServer;
let readonlyServer: RunningServer;

function api(route: string, init?: RequestInit): Promise<Response> {
  return fetch(`http://localhost:${running.port}${route}`, init);
}

async function write(rel: string, content: string | Buffer): Promise<void> {
  const file = path.join(repo, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-serve-multi-'));
  alphaPlan = path.join(repo, 'packages', 'alpha', 'constellation', 'plan.md');
  betaPlan = path.join(repo, 'packages', 'beta', 'constellation', 'plan.md');

  await write(
    'constellation/plan.md',
    '---\nname: Root Fixture\n---\n\n# Root fixture\n\nOne card only.\n',
  );
  await cp(GOLDEN, path.dirname(alphaPlan), { recursive: true });
  await write(
    'packages/beta/constellation/plan.md',
    '---\nname: Beta Fixture\n---\n\n# Beta fixture\n',
  );
  await write('packages/alpha/assets/f.woff2', Buffer.from('alpha-font'));
  await write('shared/fonts/g.woff2', Buffer.from('shared-font'));

  await write(
    'node_modules/decoy/constellation/plan.md',
    '---\nname: Node modules decoy\n---\n',
  );
  await write(
    'packages/alpha/dist/constellation/plan.md',
    '---\nname: Dist decoy\n---\n',
  );

  execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
  const plans = await discoverPlans(repo);
  running = await startServer({ plans, scanRoot: repo, defaultPlan: 'beta', port: 0 });
  readonlyServer = await startServer({
    plans,
    scanRoot: repo,
    defaultPlan: 'beta',
    port: 0,
    readonly: true,
  });
});

afterAll(async () => {
  await running.close();
  await readonlyServer.close();
  await rm(repo, { recursive: true, force: true });
});

describe('multi-plan HTTP serving', () => {
  it('lists the ordered roster with names, aliases, counts, and the requested default', async () => {
    const res = await api('/api/plans');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ multi: true, default: 'beta', scan_root: repo });
    expect(data.plans.map((plan: { id: string }) => plan.id)).toEqual([
      'root',
      'alpha',
      'beta',
    ]);
    expect(data.plans).toEqual([
      {
        id: 'root',
        aliases: [],
        name: 'Root Fixture',
        code_path: '',
        plan_path: 'constellation',
        cards: 1,
        default: false,
      },
      {
        id: 'alpha',
        aliases: ['packages-alpha'],
        name: 'Ticketing Example',
        code_path: 'packages/alpha',
        plan_path: 'packages/alpha/constellation',
        cards: 26,
        default: false,
      },
      {
        id: 'beta',
        aliases: ['packages-beta'],
        name: 'Beta Fixture',
        code_path: 'packages/beta',
        plan_path: 'packages/beta/constellation',
        cards: 1,
        default: true,
      },
    ]);
  });

  it('keeps plan payloads isolated', async () => {
    const alpha = await (await api('/api/p/alpha/plan')).json();
    const beta = await (await api('/api/p/beta/plan')).json();
    expect(alpha.cards.some((card: { handle: string }) => card.handle === 'API-TICKETS')).toBe(
      true,
    );
    expect(beta.cards.some((card: { handle: string }) => card.handle === 'API-TICKETS')).toBe(
      false,
    );
  });

  it('aliases unprefixed plan routes to the default', async () => {
    const beta = await (await api('/api/p/beta/plan')).json();
    const unprefixed = await (await api('/api/plan')).json();
    expect(unprefixed).toEqual(beta);
  });

  it('returns a JSON UNKNOWN_PLAN error for an unknown id, never the SPA shell', async () => {
    const res = await api('/api/p/nope/plan');
    const text = await res.text();
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(text.toLowerCase()).not.toContain('<!doctype html');
    expect(JSON.parse(text).error.code).toBe('UNKNOWN_PLAN');
  });

  it('treats traversal-shaped ids as unknown Map keys', async () => {
    const res = await api('/api/p/..%2F..%2Fetc/plan');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect((await res.json()).error.code).toBe('UNKNOWN_PLAN');
  });

  it('returns JSON NOT_FOUND for every other unmatched API route', async () => {
    const res = await api('/api/not-a-real-route');
    const text = await res.text();
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(text.toLowerCase()).not.toContain('<!doctype html');
    expect(JSON.parse(text).error.code).toBe('NOT_FOUND');
  });

  it('accepts the permanent dashed-path alias', async () => {
    const short = await (await api('/api/p/alpha/plan')).json();
    const alias = await (await api('/api/p/packages-alpha/plan')).json();
    expect(alias).toEqual(short);
  });

  it('isolates SSE changes by plan', async () => {
    const controller = new AbortController();
    const response = await api('/api/p/alpha/events', { signal: controller.signal });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const events: string[] = [];
    const pump = (async () => {
      const decoder = new TextDecoder();
      try {
        while (reader) {
          const { done, value } = await reader.read();
          if (done) return;
          events.push(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Expected when the test aborts the subscription.
      }
    })();

    await waitFor(() => events.join('').includes('data: connected'));
    await appendFile(betaPlan, '\n');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(events.join('')).not.toContain('data: change');

    await appendFile(alphaPlan, '\n');
    await waitFor(() => events.join('').includes('data: change'));
    controller.abort();
    await pump;
  }, 10_000);

  it('writes only inside the selected plan', async () => {
    const alphaBefore = await stat(alphaPlan);
    const betaBefore = await readFile(betaPlan, 'utf8');
    const patched = await api('/api/p/beta/card/PLAN-PROJECT', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '# Beta fixture\n\nEdited through beta.\n' }),
    });
    expect(patched.status).toBe(200);
    expect(await readFile(betaPlan, 'utf8')).not.toBe(betaBefore);
    expect((await stat(alphaPlan)).mtimeMs).toBe(alphaBefore.mtimeMs);
  });

  it('rejects a prefixed write on a readonly server', async () => {
    const before = await readFile(betaPlan, 'utf8');
    const rejected = await fetch(
      `http://localhost:${readonlyServer.port}/api/p/beta/card/PLAN-PROJECT`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'must not write' }),
      },
    );
    expect(rejected.status).toBe(405);
    expect((await rejected.json()).error.code).toBe('READONLY');
    expect(await readFile(betaPlan, 'utf8')).toBe(before);
  });

  it('serves style assets from the code root, then the scan root, and blocks traversal', async () => {
    const asset = (value: string) =>
      api(`/api/p/alpha/style-asset?path=${encodeURIComponent(value)}`);

    const local = await asset('assets/f.woff2');
    expect(local.status).toBe(200);
    expect(Buffer.from(await local.arrayBuffer()).toString()).toBe('alpha-font');

    const shared = await asset('shared/fonts/g.woff2');
    expect(shared.status).toBe(200);
    expect(Buffer.from(await shared.arrayBuffer()).toString()).toBe('shared-font');

    const traversal = await asset('../../../etc/passwd.woff2');
    expect(traversal.status).toBe(403);
    expect((await traversal.json()).error.code).toBe('FORBIDDEN');
  });

  it('closes a multi-plan server without leaving its watchers or SSE responses open', async () => {
    const disposable = await startServer({
      plans: await discoverPlans(repo),
      scanRoot: repo,
      defaultPlan: 'root',
      port: 0,
    });
    await expect(
      new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('close timed out')), 2_000);
        void disposable.close().then(() => {
          clearTimeout(timeout);
          resolve('closed');
        }, (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      }),
    ).resolves.toBe('closed');
  });
});

async function waitFor(predicate: () => boolean, timeout = 5_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('timed out waiting for event');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
