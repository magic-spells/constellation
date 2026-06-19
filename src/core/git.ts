import { execFile } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { isHandleShaped, typeForHandle } from './handles.js';
import { parseFile } from './parse.js';

const exec = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Guard a caller-supplied git revision. A value starting with `-` would be
 * parsed by git as an option, not a revision — e.g. `--output=/path` makes
 * `git diff` write an arbitrary file. We both reject leading-dash revisions here
 * and pass `--end-of-options` before every revision below, so no caller string
 * is ever interpreted as a flag.
 */
function safeRev(rev: string): string {
  if (rev.startsWith('-')) {
    throw new Error(`Refusing git revision that looks like an option: ${rev}`);
  }
  return rev;
}

export async function repoRootFor(planRoot: string): Promise<string> {
  return (await git(planRoot, 'rev-parse', '--show-toplevel')).trim();
}

const SYNC_FILE = '.sync.json';

export interface SyncPoint {
  synced_sha: string;
  synced_at: string;
}

export async function readSyncPoint(planRoot: string): Promise<SyncPoint | null> {
  try {
    const raw = await readFile(path.join(planRoot, SYNC_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.synced_sha === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeSyncPoint(
  planRoot: string,
  sha?: string,
): Promise<SyncPoint> {
  const resolved = sha
    ? (await git(planRoot, 'rev-parse', '--end-of-options', safeRev(sha))).trim()
    : (await git(planRoot, 'rev-parse', 'HEAD')).trim();
  const point: SyncPoint = {
    synced_sha: resolved,
    synced_at: new Date().toISOString(),
  };
  await writeFile(
    path.join(planRoot, SYNC_FILE),
    `${JSON.stringify(point, null, 2)}\n`,
    'utf8',
  );
  return point;
}

/**
 * True when the plan folder has uncommitted (staged or unstaged) changes,
 * ignoring the .sync.json marker itself (writing the marker shouldn't count as
 * the plan being dirty).
 */
export async function planDirty(planRoot: string): Promise<boolean> {
  const realRoot = await realpath(planRoot);
  const repoRoot = await repoRootFor(realRoot);
  const planRel = path.relative(repoRoot, realRoot) || '.';
  const out = await git(
    repoRoot,
    'status',
    '--porcelain',
    '--',
    planRel,
    `:(exclude)${path.join(planRel, SYNC_FILE)}`,
  );
  return out.trim().length > 0;
}

/** The current HEAD sha of the repo the plan lives in. */
export async function headSha(planRoot: string): Promise<string> {
  const realRoot = await realpath(planRoot);
  const repoRoot = await repoRootFor(realRoot);
  return (await git(repoRoot, 'rev-parse', 'HEAD')).trim();
}

/**
 * Of the given repo-relative paths, the subset that changed between `sinceSha`
 * and the working tree — one git call. A path absent from the result is
 * unchanged since that sha (file existence is checked separately, on disk).
 */
export async function changedFilesSince(
  planRoot: string,
  sinceSha: string,
  paths: string[],
): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const realRoot = await realpath(planRoot);
  const repoRoot = await repoRootFor(realRoot);
  const out = await git(
    repoRoot,
    'diff',
    '--name-only',
    '--end-of-options',
    safeRev(sinceSha),
    '--',
    ...paths,
  );
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
}

export type ChangeKind = 'added' | 'modified' | 'removed' | 'renamed';

export interface PlanChange {
  handle: string;
  file: string;
  change: ChangeKind;
  changed_keys?: string[];
  body_changed?: boolean;
}

export interface PlanDiff {
  base: string;
  base_source: 'argument' | 'sync-marker' | 'HEAD';
  head: string;
  changes: PlanChange[];
}

export async function diffPlan(
  planRoot: string,
  base?: string,
  head?: string,
): Promise<PlanDiff> {
  // realpath: git reports the canonical repo root, which may differ from the
  // caller's path through symlinks (e.g. /var vs /private/var on macOS).
  const realRoot = await realpath(planRoot);
  const repoRoot = await repoRootFor(realRoot);
  const planRel = path.relative(repoRoot, realRoot) || '.';

  let resolvedBase = base;
  let baseSource: PlanDiff['base_source'] = 'argument';
  if (!resolvedBase) {
    const marker = await readSyncPoint(planRoot);
    if (marker) {
      resolvedBase = marker.synced_sha;
      baseSource = 'sync-marker';
    } else {
      resolvedBase = 'HEAD';
      baseSource = 'HEAD';
    }
  }

  const args = ['diff', '--name-status', '-M', '--end-of-options', safeRev(resolvedBase)];
  if (head) args.push(safeRev(head));
  args.push('--', planRel);
  const output = await git(repoRoot, ...args);

  const changes: PlanChange[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0];
    const oldPath = parts[1];
    const newPath = parts[2] ?? parts[1];
    if (!isPlanCard(newPath, planRel) && !isPlanCard(oldPath, planRel)) continue;

    const change: ChangeKind = status.startsWith('R')
      ? 'renamed'
      : status === 'A'
        ? 'added'
        : status === 'D'
          ? 'removed'
          : 'modified';

    const file = change === 'removed' ? oldPath : newPath;
    const handle = handleForRepoPath(file, planRel);
    if (!handle) continue;

    const entry: PlanChange = { handle, file, change };
    if (change === 'modified' || change === 'renamed') {
      try {
        const oldText = await git(repoRoot, 'show', `${resolvedBase}:${oldPath}`);
        const newText = head
          ? await git(repoRoot, 'show', `${head}:${newPath}`)
          : await readFile(path.join(repoRoot, newPath), 'utf8');
        Object.assign(entry, compareVersions(oldText, newText));
      } catch {
        // Content comparison is best-effort; the change itself is still reported.
      }
    }
    changes.push(entry);
  }

  // git diff omits untracked files; a brand-new card is still an addition.
  if (!head) {
    const untracked = await git(
      repoRoot,
      'ls-files',
      '--others',
      '--exclude-standard',
      '--',
      planRel,
    );
    for (const file of untracked.split('\n').filter(Boolean)) {
      if (!isPlanCard(file, planRel)) continue;
      const handle = handleForRepoPath(file, planRel);
      if (handle) changes.push({ handle, file, change: 'added' });
    }
  }

  return {
    base: resolvedBase,
    base_source: baseSource,
    head: head ?? 'worktree',
    changes,
  };
}

function compareVersions(
  oldText: string,
  newText: string,
): { changed_keys: string[]; body_changed: boolean } {
  const oldParsed = parseFile(oldText);
  const newParsed = parseFile(newText);
  const keys = new Set([
    ...Object.keys(oldParsed.frontmatter),
    ...Object.keys(newParsed.frontmatter),
  ]);
  const changed_keys = [...keys].filter(
    (key) =>
      JSON.stringify(oldParsed.frontmatter[key]) !==
      JSON.stringify(newParsed.frontmatter[key]),
  );
  return {
    changed_keys,
    body_changed: oldParsed.body.trim() !== newParsed.body.trim(),
  };
}

function isPlanCard(repoPath: string | undefined, planRel: string): boolean {
  if (!repoPath) return false;
  const base = path.basename(repoPath);
  if (base.startsWith('.') || !base.endsWith('.md')) return false;
  return planRel === '.' || repoPath.startsWith(`${planRel}/`);
}

function handleForRepoPath(repoPath: string, planRel: string): string | null {
  const rel = planRel === '.' ? repoPath : repoPath.slice(planRel.length + 1);
  if (rel === 'plan.md') return 'PLAN-PROJECT';
  const handle = path.basename(rel, '.md');
  return isHandleShaped(handle) && typeForHandle(handle) ? handle : null;
}

export interface LogEntry {
  sha: string;
  date: string;
  subject: string;
}

export async function planLog(
  planRoot: string,
  cardRelPath: string,
  limit = 20,
): Promise<LogEntry[]> {
  const realRoot = await realpath(planRoot);
  const repoRoot = await repoRootFor(realRoot);
  const repoPath = path.join(path.relative(repoRoot, realRoot), cardRelPath);
  const output = await git(
    repoRoot,
    'log',
    `-n${limit}`,
    '--format=%h%x09%aI%x09%s',
    '--follow',
    '--',
    repoPath,
  );
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, date, ...subject] = line.split('\t');
      return { sha, date, subject: subject.join('\t') };
    });
}

export interface SyncActivity {
  sha: string;
  short_sha: string;
  date: string;
  subject: string;
  cards: string[];
  is_sync_point: boolean;
}

/**
 * Recent commits that touched the plan folder, newest first. Each entry lists the
 * plan-card handles it changed and flags sync-point commits (those that moved the
 * .sync.json marker). Derived live from git — the activity log is never stored.
 */
export async function recentPlanActivity(
  planRoot: string,
  limit = 6,
): Promise<SyncActivity[]> {
  const realRoot = await realpath(planRoot);
  const repoRoot = await repoRootFor(realRoot);
  const planRel = path.relative(repoRoot, realRoot) || '.';
  // %x1e (record separator) prefixes each commit; %x1f (unit separator) splits the
  // header fields; --name-only then lists that commit's files (scoped to the plan
  // folder) on their own lines. One git call, parsed defensively.
  const out = await git(
    repoRoot,
    'log',
    `-n${limit}`,
    '--pretty=format:%x1e%H%x1f%aI%x1f%s',
    '--name-only',
    '--',
    planRel,
  );
  const activity: SyncActivity[] = [];
  for (const record of out.split('\x1e')) {
    if (!record.trim()) continue;
    const newline = record.indexOf('\n');
    const header = newline === -1 ? record : record.slice(0, newline);
    const [sha, date, subject] = header.split('\x1f');
    if (!sha) continue;
    const files = (newline === -1 ? '' : record.slice(newline + 1))
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    const cards: string[] = [];
    let isSyncPoint = false;
    for (const file of files) {
      if (path.basename(file) === SYNC_FILE) isSyncPoint = true;
      const handle = handleForRepoPath(file, planRel);
      if (handle && !cards.includes(handle)) cards.push(handle);
    }
    activity.push({
      sha,
      short_sha: sha.slice(0, 8),
      date: date ?? '',
      subject: subject ?? '',
      cards,
      is_sync_point: isSyncPoint,
    });
  }
  return activity;
}

/**
 * How many commits between `sinceSha` and HEAD touch files OUTSIDE the plan folder
 * — i.e. how far the code has moved since the plan was last reconciled.
 */
export async function countCodeCommitsSince(
  planRoot: string,
  sinceSha: string,
): Promise<number> {
  const realRoot = await realpath(planRoot);
  const repoRoot = await repoRootFor(realRoot);
  const planRel = path.relative(repoRoot, realRoot) || '.';
  const out = await git(
    repoRoot,
    'rev-list',
    '--count',
    `${sinceSha}..HEAD`,
    '--',
    '.',
    `:(exclude)${planRel}`,
  );
  return Number.parseInt(out.trim(), 10) || 0;
}
