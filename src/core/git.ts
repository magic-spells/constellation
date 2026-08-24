import { execFile } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { isHandleShaped, typeForHandle } from './handles.js';
import { parseFile } from './parse.js';
import { codeRootFor } from './repos.js';

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

export interface PlanRoots {
  /** Folder whose code the plan describes. */
  codeRoot: string;
  /** Git repository containing the plan and code root. */
  gitRoot: string;
  /** Code root's git-repo-relative path, or '' when both roots coincide. */
  prefix: string;
}

/** Resolve the code/git roots and the path prefix that translates between them. */
export async function planRootsFor(planRoot: string): Promise<PlanRoots> {
  const realPlanRoot = await realpath(planRoot);
  const codeRoot = await codeRootFor(realPlanRoot);
  const gitRoot = await repoRootFor(realPlanRoot);
  const prefix = path.relative(gitRoot, codeRoot).split(path.sep).join('/');
  return { codeRoot, gitRoot, prefix };
}

/**
 * The repo's `origin` remote as a browsable https URL (ssh forms normalized,
 * trailing `.git` stripped), or null when there is no remote or no repo.
 */
export async function repoRemoteUrl(planRoot: string): Promise<string | null> {
  let raw: string;
  try {
    raw = (await git(planRoot, 'remote', 'get-url', 'origin')).trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/.exec(raw);
  const url = ssh ? `https://${ssh[1]}/${ssh[2]}` : raw;
  if (!/^https?:\/\//.test(url)) return null;
  return url.replace(/\.git$/, '');
}

const SYNC_FILE = '.sync.json';

/**
 * Everything `.sync.json` may hold. The file is the plan's only marker file and
 * every field in it is *provenance* — a sha somebody stamped, a version somebody
 * reviewed under — never a derived value or a change flag.
 */
export interface SyncMarker {
  synced_sha?: string;
  synced_at?: string;
  /**
   * The Constellation version whose file-format rules this plan was last
   * reviewed under. Absent (or the file missing entirely) means the plan has
   * never been reviewed under the current rules, which is what the MCP server's
   * one-time upgrade-review prompt keys off.
   */
  format_review?: string;
}

/** A marker that actually pins a commit — what the drift baseline needs. */
export interface SyncPoint extends SyncMarker {
  synced_sha: string;
  synced_at: string;
}

/** The raw marker file, whatever it holds; null when absent or unparseable. */
export async function readSyncMarker(planRoot: string): Promise<SyncMarker | null> {
  try {
    const raw = await readFile(path.join(planRoot, SYNC_FILE), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as SyncMarker) : null;
  } catch {
    return null;
  }
}

/**
 * The marker, but only when it pins a commit. A file holding just
 * `format_review` is not a sync point — callers reading `synced_sha` must still
 * see "never synced".
 */
export async function readSyncPoint(planRoot: string): Promise<SyncPoint | null> {
  const parsed = await readSyncMarker(planRoot);
  return typeof parsed?.synced_sha === 'string' ? (parsed as SyncPoint) : null;
}

async function writeSyncMarker(planRoot: string, marker: SyncMarker): Promise<void> {
  await writeFile(
    path.join(planRoot, SYNC_FILE),
    `${JSON.stringify(marker, null, 2)}\n`,
    'utf8',
  );
}

export async function writeSyncPoint(
  planRoot: string,
  sha?: string,
  options: { formatReview?: string } = {},
): Promise<SyncPoint> {
  // A caller-supplied revision goes through resolveCommit, NOT a bare
  // `rev-parse --end-of-options <rev>`: rev-parse echoes that flag back as its
  // own first output line, so the bare form wrote a two-line "--end-of-options\n<sha>"
  // into the marker — a sha nothing can resolve, which reads as marker_error and
  // pins the plan at `drifted` forever. `--verify` (what resolveCommit uses)
  // prints exactly one line and fails loudly on a revision that does not exist,
  // rather than stamping garbage.
  const resolved = sha
    ? await resolveCommit(planRoot, sha)
    : (await git(planRoot, 'rev-parse', 'HEAD')).trim();
  // Merge over whatever is already there: stamping a commit must not silently
  // drop a format_review somebody recorded (and vice versa).
  const existing = (await readSyncMarker(planRoot)) ?? {};
  const point: SyncPoint = {
    ...existing,
    synced_sha: resolved,
    synced_at: new Date().toISOString(),
    ...(options.formatReview ? { format_review: options.formatReview } : {}),
  };
  await writeSyncMarker(planRoot, point);
  return point;
}

/**
 * Record that the plan has been reviewed under `version`'s format rules,
 * touching nothing else in the marker. Needs no git — `init_plan` calls it
 * before the repo has a HEAD (or in a repo that has none at all).
 */
export async function stampFormatReview(
  planRoot: string,
  version: string,
): Promise<SyncMarker> {
  const marker: SyncMarker = {
    ...((await readSyncMarker(planRoot)) ?? {}),
    format_review: version,
  };
  await writeSyncMarker(planRoot, marker);
  return marker;
}

/** The version the plan was last format-reviewed under, or null if never. */
export async function formatReviewVersion(planRoot: string): Promise<string | null> {
  const value = (await readSyncMarker(planRoot))?.format_review;
  return typeof value === 'string' && value.trim() ? value : null;
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

/** Resolve a revision to a full commit sha, verifying it actually exists. */
export async function resolveCommit(planRoot: string, rev: string): Promise<string> {
  const realRoot = await realpath(planRoot);
  const repoRoot = await repoRootFor(realRoot);
  return (
    await git(
      repoRoot,
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${safeRev(rev)}^{commit}`,
    )
  ).trim();
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

export interface PathCommit {
  /** Full sha of the newest commit that touched this path. */
  sha: string;
  /** Position in the newest-first walk; LOWER means newer. */
  order: number;
}

/**
 * The newest commit touching each given repo-relative path, in ONE git pass.
 * Directories may be passed — git reports the files under them, so callers
 * resolve folders by prefix. `order` is the path's position in the newest-first
 * walk: equal = same commit, lower = strictly newer — comparable without
 * trusting timestamps. A path absent from the result has no commit history
 * (untracked, or renamed away) — the caller's cue to fall back.
 */
export async function lastCommitByPath(
  planRoot: string,
  paths: string[],
): Promise<Map<string, PathCommit>> {
  const map = new Map<string, PathCommit>();
  if (paths.length === 0) return map;
  const realRoot = await realpath(planRoot);
  const repoRoot = await repoRootFor(realRoot);
  const out = await git(
    repoRoot,
    'log',
    '--pretty=format:%x1e%H',
    '--name-only',
    '--no-renames',
    '--',
    ...paths,
  );
  let order = 0;
  for (const record of out.split('\x1e')) {
    if (!record.trim()) continue;
    const newline = record.indexOf('\n');
    const sha = (newline === -1 ? record : record.slice(0, newline)).trim();
    if (!sha) continue;
    const files = (newline === -1 ? '' : record.slice(newline + 1))
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    // Newest first: the FIRST commit naming a path is that path's last commit.
    for (const file of files) {
      if (!map.has(file)) map.set(file, { sha, order });
    }
    order += 1;
  }
  return map;
}

/**
 * Of the given repo-relative paths, the subset with uncommitted (staged or
 * unstaged) changes against HEAD — one git call. Untracked files are not
 * reported, matching `changedFilesSince`, which git's diff also never lists.
 */
export async function dirtyFilesAmong(
  planRoot: string,
  paths: string[],
): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const realRoot = await realpath(planRoot);
  const repoRoot = await repoRootFor(realRoot);
  const out = await git(repoRoot, 'diff', '--name-only', 'HEAD', '--', ...paths);
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
  options: { detail?: boolean } = {},
): Promise<PlanDiff> {
  // detail: false skips the per-card content comparison (changed_keys /
  // body_changed), which costs two `git show` spawns per modified card —
  // callers that only need the change list (computeSyncStatus counts it)
  // must not pay seconds for it on a plan with hundreds of drifted cards.
  const detail = options.detail !== false;
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
    if (detail && (change === 'modified' || change === 'renamed')) {
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
 * Recent commits that touched ONLY files outside the plan folder, newest first —
 * the code half of the activity story (recentPlanActivity is the plan half; a
 * commit touching both counts as plan activity and is excluded here). Scans up
 * to limit*5 commits to find `limit` code-only ones; merge commits (no listed
 * files) are skipped. Returns [] when the plan root is the repo root — there is
 * no "outside the plan" to report.
 */
export async function recentCodeActivity(
  planRoot: string,
  limit = 6,
): Promise<SyncActivity[]> {
  const realRoot = await realpath(planRoot);
  const { gitRoot: repoRoot, prefix: codePrefix } = await planRootsFor(realRoot);
  const planRel = path.relative(repoRoot, realRoot) || '.';
  if (planRel === '.') return [];
  const prefix = `${planRel.split(path.sep).join('/')}/`;
  const out = await git(
    repoRoot,
    'log',
    `-n${limit * 5}`,
    '--pretty=format:%x1e%H%x1f%aI%x1f%s',
    '--name-only',
    // A pathspec turns on git's default history simplification, which drops
    // commits reachable only through the pruned side of a TREESAME merge —
    // real code commits, silently missing. Merges still list no files, so the
    // `files.length === 0` skip below keeps them out of the report.
    '--full-history',
    '--',
    codePrefix || '.',
  );
  const activity: SyncActivity[] = [];
  for (const record of out.split('\x1e')) {
    if (activity.length >= limit) break;
    if (!record.trim()) continue;
    const newline = record.indexOf('\n');
    const header = newline === -1 ? record : record.slice(0, newline);
    const [sha, date, subject] = header.split('\x1f');
    if (!sha) continue;
    const files = (newline === -1 ? '' : record.slice(newline + 1))
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
    if (files.length === 0) continue; // merge commits list no files
    if (files.some((f) => f.startsWith(prefix))) continue; // plan activity's job
    activity.push({
      sha,
      short_sha: sha.slice(0, 8),
      date: date ?? '',
      subject: subject ?? '',
      cards: [],
      is_sync_point: false,
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
  const { gitRoot: repoRoot, prefix: codePrefix } = await planRootsFor(realRoot);
  const planRel = path.relative(repoRoot, realRoot) || '.';
  const out = await git(
    repoRoot,
    'rev-list',
    '--count',
    // Same reason as recentCodeActivity: without it the pathspec prunes real
    // commits off the non-TREESAME side of merges and under-counts the drift.
    '--full-history',
    `${safeRev(sinceSha)}..HEAD`,
    '--',
    codePrefix || '.',
    `:(exclude)${planRel}`,
  );
  return Number.parseInt(out.trim(), 10) || 0;
}

/** Most recent tag by creation date, or null when the repo has no tags. */
export async function latestTag(planRoot: string): Promise<string | null> {
  const realRoot = await realpath(planRoot);
  const repoRoot = await repoRootFor(realRoot);
  const out = await git(repoRoot, 'tag', '--sort=-creatordate');
  return out.split('\n').map((t) => t.trim()).filter(Boolean)[0] ?? null;
}
