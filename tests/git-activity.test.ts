import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { latestTag, recentCodeActivity } from '../src/core/git.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let repo: string;
let planRoot: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/**
 * Commit with an explicit timestamp. A lightweight tag's creatordate IS its
 * commit date at one-second resolution, so two commits made in the same second
 * tie and `--sort=-creatordate` falls back to refname order — which would make
 * the "newest tag" assertion below pass or fail on timing luck.
 */
function gitCommitAt(isoDate: string, message: string): void {
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate },
  });
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-gitact-'));
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

describe('latestTag', () => {
  it('returns null when the repo has no tags', async () => {
    expect(await latestTag(planRoot)).toBeNull();
  });

  it('returns the newest tag by creation date', async () => {
    git('tag', 'v0.4.0');
    // creatordate for lightweight tags is the commit date, so tag a NEWER commit
    await writeFile(path.join(repo, 'code.ts'), 'export const a = 1;\n');
    git('add', '-A');
    gitCommitAt(new Date(Date.now() + 60_000).toISOString(), 'feat: add code file');
    git('tag', 'v0.5.0');
    expect(await latestTag(planRoot)).toBe('v0.5.0');
  });
});

describe('recentCodeActivity', () => {
  it('lists code-only commits and excludes plan-touching commits', async () => {
    // plan-only commit
    await writeFile(path.join(planRoot, 'plan.md'), '# Plan\n\nUpdated body.\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'docs: tweak plan body');
    // mixed commit (plan + code) — must NOT appear in code activity
    await writeFile(path.join(repo, 'mixed.ts'), 'export const m = 1;\n');
    await writeFile(path.join(planRoot, 'plan.md'), '# Plan\n\nUpdated again.\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'chore: mixed commit');

    const activity = await recentCodeActivity(planRoot, 6);
    const subjects = activity.map((a) => a.subject);
    expect(subjects).toContain('feat: add code file'); // code-only (Task 2)
    expect(subjects).not.toContain('docs: tweak plan body'); // plan-only
    expect(subjects).not.toContain('chore: mixed commit'); // mixed
    expect(subjects).not.toContain('initial plan'); // touched the plan
    for (const entry of activity) {
      expect(entry.cards).toEqual([]);
      expect(entry.is_sync_point).toBe(false);
      expect(entry.short_sha).toHaveLength(8);
      expect(entry.date).toBeTruthy();
    }
  });

  it('respects the limit', async () => {
    for (let i = 0; i < 3; i += 1) {
      await writeFile(path.join(repo, `extra-${i}.ts`), `export const x${i} = ${i};\n`);
      git('add', '-A');
      git('commit', '-q', '-m', `feat: extra ${i}`);
    }
    const activity = await recentCodeActivity(planRoot, 2);
    expect(activity).toHaveLength(2);
    expect(activity[0].subject).toBe('feat: extra 2'); // newest first
  });
});
