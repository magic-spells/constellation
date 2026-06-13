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
    expect(data.cards).toHaveLength(18);
    expect(data.connections).toHaveLength(48);
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
