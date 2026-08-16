import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/serve/server.js';

// POST /api/sync-point — stamping the sync marker from the viewer, the same
// write the MCP `set_sync_point` tool performs. It is what the dashboard's
// health strip button calls, and the reason it exists: without a marker every
// claim card has no drift baseline, so the drift verdict can say nothing.

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let repo: string;
let planRoot: string;
let running: RunningServer;
let readonlyServer: RunningServer;

// A plan outside any git repo — no HEAD to pin the marker to.
let bare: string;
let bareServer: RunningServer;

function post(server: RunningServer) {
  return fetch(`http://localhost:${server.port}/api/sync-point`, { method: 'POST' });
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-syncpoint-'));
  planRoot = path.join(repo, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial plan');

  running = await startServer({ planRoot, port: 0 });
  readonlyServer = await startServer({ planRoot, port: 0, readonly: true });

  bare = await mkdtemp(path.join(tmpdir(), 'constellation-nogit-'));
  await cp(GOLDEN, path.join(bare, 'constellation'), { recursive: true });
  bareServer = await startServer({ planRoot: path.join(bare, 'constellation'), port: 0 });
});

afterAll(async () => {
  await running.close();
  await readonlyServer.close();
  await bareServer.close();
  await rm(repo, { recursive: true, force: true });
  await rm(bare, { recursive: true, force: true });
});

describe('POST /api/sync-point', () => {
  it('writes the marker at HEAD and returns the recomputed status', async () => {
    const res = await post(running);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.marker.synced_sha).toMatch(/^[0-9a-f]{40}$/);
    const onDisk = JSON.parse(await readFile(path.join(planRoot, '.sync.json'), 'utf8'));
    expect(onDisk.synced_sha).toBe(data.marker.synced_sha);

    // The whole point of the round trip: the client can render the new verdict
    // without waiting for the next poll.
    expect(data.sync.marker.synced_sha).toBe(data.marker.synced_sha);
    // Bound files from the golden plan are not in this fixture, so claims
    // are stale — that is reverse drift, not in-sync.
    expect(data.sync.state).toBe('drifted');
    expect(data.sync.stale.stale.length).toBeGreaterThan(0);
  });

  it('gives every unverified claim card a baseline, so drift becomes answerable', async () => {
    // No claim card should land in no_baseline — the bucket that used to fill
    // the drift panel with rows that said nothing. Each one is measured against
    // its own last commit (the marker is only the fallback now).
    const { sync } = await (await post(running)).json();
    expect(sync.stale.checked).toBeGreaterThan(0);
    expect(sync.stale.no_baseline).toEqual([]);
    // The golden plan describes an app whose source is not in this fixture, so
    // its claims are stale for the honest reason: the bound file is missing.
    expect(sync.stale.stale.length).toBeGreaterThan(0);
    for (const entry of sync.stale.stale) {
      expect(entry.baseline_source).toBe('card-commit');
      expect(entry.missing_files.length).toBeGreaterThan(0);
    }
  });

  it('is refused on a --readonly server', async () => {
    const res = await post(readonlyServer);
    expect(res.status).toBe(405);
    expect((await res.json()).error.code).toBe('READONLY');
  });

  it('fails cleanly outside a git repo instead of 500ing', async () => {
    const res = await post(bareServer);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NO_GIT');
  });
});
