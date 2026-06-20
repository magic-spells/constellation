import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recentPlanActivity, writeSyncPoint } from '../src/core/git.js';
import { computeSyncStatus } from '../src/core/sync.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let repo: string;
let planRoot: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-sync-'));
  planRoot = path.join(repo, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial plan');
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

// These run in order and build on each other (like mcp-git.test.ts), each
// mutating the shared repo to drive the status through its lifecycle.
describe('computeSyncStatus', () => {
  it('is never-synced before any marker, with a self-consistent rollup', async () => {
    const status = await computeSyncStatus(planRoot);
    expect(status.state).toBe('never-synced');
    expect(status.marker).toBeNull();
    expect(status.total_cards).toBeGreaterThan(0);
    expect(status.integrity.errors).toBe(0); // golden plan lints clean
    const summed = Object.values(status.status_rollup).reduce((a, b) => a + b, 0);
    expect(summed).toBe(status.total_cards);
  });

  it('is in-sync right after a sync point on a clean tree', async () => {
    const head = git('rev-parse', 'HEAD').trim();
    await writeSyncPoint(planRoot); // marker at HEAD; .sync.json is excluded from dirty
    const status = await computeSyncStatus(planRoot);
    expect(status.state).toBe('in-sync');
    expect(status.marker?.synced_sha).toBe(head);
    expect(status.code_commits_since_marker).toBe(0);
    expect(status.plan_changes_since_marker).toBe(0);
    expect(status.plan_dirty).toBe(false);
  });

  it('drifts with a clear error when the sync marker is unreachable', async () => {
    await writeFile(
      path.join(planRoot, '.sync.json'),
      JSON.stringify(
        {
          synced_sha: '0000000000000000000000000000000000000000',
          synced_at: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
    const status = await computeSyncStatus(planRoot);
    expect(status.state).toBe('drifted');
    expect(status.marker_error).toContain('Sync marker 000000000000');
  });

  it('drifts when code is committed past the marker', async () => {
    await writeSyncPoint(planRoot);
    await writeFile(path.join(repo, 'app.ts'), 'export const x = 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: add app entrypoint');
    const status = await computeSyncStatus(planRoot);
    expect(status.state).toBe('drifted');
    expect(status.code_commits_since_marker).toBe(1);
    expect(status.plan_changes_since_marker).toBe(0);
  });

  it('reports dirty when only the plan has uncommitted edits', async () => {
    // Re-anchor the marker at the current HEAD so committed history is reconciled,
    // then make an uncommitted plan edit — the only remaining signal is "dirty".
    await writeSyncPoint(planRoot);
    await writeFile(
      path.join(planRoot, 'doc', 'DOC-RUNBOOK.md'),
      '---\nname: Runbook\n---\nUncommitted ops notes.\n',
    );
    const status = await computeSyncStatus(planRoot);
    expect(status.state).toBe('dirty');
    expect(status.plan_dirty).toBe(true);
  });
});

describe('recentPlanActivity', () => {
  it('lists plan commits newest-first with the handles they touched', async () => {
    const activity = await recentPlanActivity(planRoot, 6);
    expect(activity.length).toBeGreaterThan(0);
    const initial = activity.find((a) => a.subject === 'initial plan');
    expect(initial).toBeTruthy();
    expect(initial?.cards.length).toBeGreaterThan(0);
    expect(initial?.is_sync_point).toBe(false);
  });

  it('flags a commit that moves the .sync.json marker as a sync point', async () => {
    await writeSyncPoint(planRoot);
    git('add', '-A');
    git('commit', '-q', '-m', 'chore: advance sync marker');
    const activity = await recentPlanActivity(planRoot, 6);
    expect(activity[0].subject).toBe('chore: advance sync marker');
    expect(activity[0].is_sync_point).toBe(true);
  });
});
