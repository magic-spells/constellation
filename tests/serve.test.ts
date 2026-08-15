import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/serve/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let running: RunningServer;

beforeAll(async () => {
  running = await startServer({ planRoot: GOLDEN, port: 0 });
});

afterAll(async () => {
  await running.close();
});

describe('constellation serve', () => {
  it('serves the full plan as JSON', async () => {
    const res = await fetch(`http://localhost:${running.port}/api/plan`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cards).toHaveLength(25);
    expect(data.connections).toHaveLength(26);
    expect(data.errors).toEqual([]);
    const api = data.cards.find((c: { handle: string }) => c.handle === 'API-TICKETS');
    expect(api.frontmatter.path).toBe('/api/v1/tickets');
    expect(api.body).toContain('Tickets API');
  });

  it('exposes a server-sent events stream', async () => {
    const controller = new AbortController();
    const res = await fetch(`http://localhost:${running.port}/events`, {
      signal: controller.signal,
    });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    controller.abort();
  });

  it('refuses path traversal', async () => {
    const res = await fetch(
      `http://localhost:${running.port}/..%2f..%2fpackage.json`,
    );
    expect([403, 200]).toContain(res.status);
    if (res.status === 200) {
      // Must be the SPA fallback, never the actual escaped file.
      expect(await res.text()).not.toContain('"name": "@magic-spells/constellation-next"');
    }
  });
});

describe('GET /api/style-asset', () => {
  // The repo root is the plan folder's PARENT, so these cases need a plan in a
  // writable temp dir rather than the golden fixture inside this repo.
  let dir: string;
  let assetServer: RunningServer;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'constellation-asset-'));
    const planRoot = path.join(dir, 'constellation');
    await cp(GOLDEN, planRoot, { recursive: true });
    await writeFile(path.join(dir, 'brand.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
    assetServer = await startServer({ planRoot, port: 0 });
  });

  afterAll(async () => {
    await assetServer.close();
    await rm(dir, { recursive: true, force: true });
  });

  function asset(rel: string) {
    return fetch(
      `http://localhost:${assetServer.port}/api/style-asset?path=${encodeURIComponent(rel)}`,
    );
  }

  it('serves a font file from the repo root', async () => {
    const res = await asset('brand.woff2');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('font/woff2');
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });

  it('rejects a non-font extension', async () => {
    const res = await asset('constellation/plan.md');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_ASSET');
  });

  it('rejects path traversal outside the repo root', async () => {
    const res = await asset('../../etc/evil.woff2');
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
    // A non-font traversal never reaches the boundary check — the extension
    // filter rejects it first, which is still a refusal.
    const nonFont = await asset('../../etc/passwd');
    expect(nonFont.status).toBe(400);
    expect((await nonFont.json()).error.code).toBe('INVALID_ASSET');
  });

  it('rejects an absolute path outside the repo root', async () => {
    const res = await asset('/etc/evil.woff2');
    expect(res.status).toBe(403);
  });

  it('404s for a missing font', async () => {
    const res = await asset('missing.woff2');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});
