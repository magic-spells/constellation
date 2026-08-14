import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeSyncStatus } from '../src/core/sync.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let repo: string;
let planRoot: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-syncdash-'));
  planRoot = path.join(repo, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
  await writeFile(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '9.9.9' }) + '\n',
  );
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial plan');
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('computeSyncStatus dashboard fields', () => {
  it('reports tag, package version, code activity, and stale verdict', async () => {
    git('tag', 'v9.9.0');
    await writeFile(path.join(repo, 'main.ts'), 'export const one = 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'feat: code commit');

    const status = await computeSyncStatus(planRoot);
    expect(status.latest_tag).toBe('v9.9.0');
    expect(status.package_version).toBe('9.9.9');
    expect(status.code_activity.map((a) => a.subject)).toContain('feat: code commit');
    expect(status.stale).not.toBeNull();
    expect(status.stale?.checked).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(status.stale?.stale)).toBe(true);
  });

  it('degrades to empty/null fields outside a git repo', async () => {
    const bare = await mkdtemp(path.join(tmpdir(), 'constellation-nogit-'));
    try {
      const barePlan = path.join(bare, 'constellation');
      await cp(GOLDEN, barePlan, { recursive: true });
      const status = await computeSyncStatus(barePlan);
      expect(status.state).toBe('no-git');
      expect(status.code_activity).toEqual([]);
      expect(status.latest_tag).toBeNull();
      expect(status.package_version).toBeNull();
      expect(status.stale).toBeNull();
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});
