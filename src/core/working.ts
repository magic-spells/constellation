import { execFile } from 'node:child_process';
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { currentBranch, headSha, planRootsFor } from './git.js';
import { codeRootFor } from './repos.js';
import { findPlanUp, resolvePlanDir } from './resolve.js';
import { workingClaudeMd } from './scaffold.js';
import { withFileLock, writeAtomic } from './writer.js';

const exec = promisify(execFile);

/**
 * Working memory — the session scratchpad that lives beside the plan, not in it
 * (or at the git root when the repo has no plan: it never reads a card).
 *
 * Cards are durable architecture; this is what we are doing about it this week:
 * what is in flight, in which worktree, held by which agent, what waits on the
 * user, what was decided tonight. It is a file (not MCP process memory) because
 * the server dies on `claude --resume`, a restart or a crash, and Codex/Grok
 * agents never see that process — a file survives all of it and a SessionStart
 * hook can echo it back into context after every compaction.
 *
 * Nothing here is a card: no index, no graph, no lint, no viewer, no diff_plan.
 * The folder is dotted so every existing walk already skips it.
 */

export const WORKING_DIR = '.constellation';
export const WORKING_FILE = 'working.md';
export const WORKING_LOG_DIR = 'log';
export const WORKING_CLAUDE_FILE = 'CLAUDE.md';

/** The `.gitignore` lines that keep the scratchpad local but ship the rules. */
export const GITIGNORE_LINES = ['.constellation/*', '!.constellation/CLAUDE.md'];

/** What the SessionStart hook runs. Matched verbatim to stay idempotent. */
// `2>/dev/null || true`: the hook is installed per repo but Claude Code runs it in
// every session there, and a checkout where constellation is not installed must not
// greet the user with a failed-hook warning. Silence and exit 0 instead.
export const HOOK_COMMAND = 'npx --no-install constellation working 2>/dev/null || true';
export const HOOK_MATCHER = 'startup|resume|compact|clear';

/** Text over this is a paragraph, not a headline — written, but flagged. */
export const MAX_TEXT_CHARS = 160;
/** Past this many live items the set costs more than it saves. */
export const MAX_ITEMS = 25;

export type WorkingType = 'G' | 'C' | 'P' | 'F' | 'T' | 'Q' | 'I' | 'D';

/** Fixed order — sections are always emitted in it, empty ones omitted. */
export const WORKING_TYPES: WorkingType[] = ['G', 'C', 'P', 'F', 'T', 'Q', 'I', 'D'];

export const TYPE_LABELS: Record<WorkingType, string> = {
  G: 'GOAL',
  C: 'CONSTRAINT',
  P: 'PLAN',
  F: 'FOCUS',
  T: 'TASK',
  Q: 'QUESTION',
  I: 'IDEA',
  D: 'DECISION',
};

const LABEL_TYPES = new Map<string, WorkingType>(
  WORKING_TYPES.map((t) => [TYPE_LABELS[t], t]),
);

export interface WorkingItem {
  id: string;
  type: WorkingType;
  importance: number;
  text: string;
}

export interface WorkingHeader {
  updated: string;
  branch: string | null;
  head: string | null;
  next: Record<WorkingType, number>;
}

export interface WorkingSetItem {
  id?: string;
  type?: string;
  importance?: number;
  text?: string;
}

export class WorkingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'WorkingError';
    this.code = code;
  }
}

/** Outside git with no plan there is nothing to anchor the folder to. */
export function noWorkingRoot(from: string): WorkingError {
  return new WorkingError(
    'NO_WORKING_ROOT',
    `Working memory needs a git repository or a Constellation plan; found neither at or above ${from}.`,
  );
}

function noFolder(dir: string): WorkingError {
  return new WorkingError(
    'NO_WORKING_FOLDER',
    `No working memory at ${dir}. Call working_init (or \`constellation working install-hook\`) to create it.`,
  );
}

/* ── paths ──────────────────────────────────────────────────────────────── */

/**
 * The working folder for a plan, resolved through the MAIN checkout.
 *
 * The folder is gitignored, and gitignored files do not exist in a linked
 * worktree — an agent working in `../repo-wt/feature` would otherwise get
 * NO_WORKING_FOLDER and a second, invisible scratchpad. `--git-common-dir`
 * points every checkout of a repo at the same `.git`, so its parent is the main
 * working tree: one scratchpad per plan, whichever checkout you call from.
 */
export async function resolveWorkingDir(planRoot: string): Promise<string> {
  const codeRoot = await codeRootFor(planRoot);
  try {
    const { gitRoot, prefix } = await planRootsFor(planRoot);
    const { stdout } = await exec('git', ['rev-parse', '--git-common-dir'], {
      cwd: planRoot,
    });
    const common = stdout.trim();
    if (!common) return path.join(codeRoot, WORKING_DIR);
    // git answers relative to the directory the command ran in (`.git`, `../.git`)
    // or absolutely from a linked worktree — resolve against that same cwd.
    const commonDir = path.resolve(planRoot, common);
    // A bare-ish or unusual layout can point somewhere without a parent tree;
    // the git root we already resolved is then the best answer available.
    const mainRoot = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : gitRoot;
    return path.join(mainRoot, prefix, WORKING_DIR);
  } catch {
    return path.join(codeRoot, WORKING_DIR);
  }
}

/**
 * Where working memory lives and where its two tracked files go. Resolved once
 * per call by `resolveWorkingAnchor` (or `anchorForPlan`); every read and write
 * below takes one. A plan root string is accepted too and resolved as a plan.
 */
export interface WorkingAnchor {
  /** The `.constellation/` folder — always in the MAIN checkout. */
  dir: string;
  /** Where `.gitignore` gets its two lines: the code root of the calling checkout. */
  codeRoot: string;
  /** Where `.claude/settings.json` goes: the git root of the calling checkout. */
  gitRoot: string;
  /** Directory the git header fields (branch, head) are read from. */
  from: string;
  /** The plan it was resolved through, or null when anchored at the git root. */
  plan: string | null;
}

export type WorkingTarget = WorkingAnchor | string;

/** Today's resolution, unchanged: the folder beside a plan, through the main checkout. */
export async function anchorForPlan(planRoot: string): Promise<WorkingAnchor> {
  const dir = await resolveWorkingDir(planRoot);
  const codeRoot = await codeRootFor(planRoot);
  let gitRoot = codeRoot;
  try {
    gitRoot = (await planRootsFor(planRoot)).gitRoot;
  } catch {
    gitRoot = codeRoot;
  }
  return { dir, codeRoot, gitRoot, from: planRoot, plan: planRoot };
}

/**
 * No plan: anchor at the git root of `start`, through `--git-common-dir` so a
 * linked worktree shares the main checkout's folder (the same rule as a plan).
 * Null outside git — there is no stable place to put it.
 */
export async function anchorForRepo(start: string): Promise<WorkingAnchor | null> {
  let gitRoot: string;
  let common: string;
  try {
    gitRoot = (await exec('git', ['rev-parse', '--show-toplevel'], { cwd: start })).stdout.trim();
    common = (await exec('git', ['rev-parse', '--git-common-dir'], { cwd: start })).stdout.trim();
  } catch {
    return null;
  }
  if (!gitRoot) return null;
  const commonDir = common ? path.resolve(start, common) : '';
  const mainRoot = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : gitRoot;
  return {
    dir: path.join(mainRoot, WORKING_DIR),
    codeRoot: gitRoot,
    gitRoot,
    from: gitRoot,
    plan: null,
  };
}

/**
 * The one resolver MCP and the CLI share. A known plan (the MCP home plan or a
 * `repo` selection) wins; otherwise `start` (default cwd) is tried as a plan
 * path, then walked up for one within its repo, then anchored at its git root.
 * Null only outside git with no plan.
 */
export async function resolveWorkingAnchor(
  opts: { plan?: string | null; start?: string } = {},
): Promise<WorkingAnchor | null> {
  if (opts.plan) return anchorForPlan(opts.plan);
  const from = path.resolve(opts.start ?? process.cwd());
  const plan = (opts.start ? await resolvePlanDir(from) : null) ?? (await findPlanUp(from));
  if (plan) return anchorForPlan(plan);
  return anchorForRepo(from);
}

async function toAnchor(target: WorkingTarget): Promise<WorkingAnchor> {
  return typeof target === 'string' ? anchorForPlan(target) : target;
}

export interface WorkingPaths {
  dir: string;
  file: string;
  logDir: string;
  exists: boolean;
}

export async function workingPaths(target: WorkingTarget): Promise<WorkingPaths> {
  const { dir } = await toAnchor(target);
  let exists = true;
  try {
    await access(dir);
  } catch {
    exists = false;
  }
  return {
    dir,
    file: path.join(dir, WORKING_FILE),
    logDir: path.join(dir, WORKING_LOG_DIR),
    exists,
  };
}

/* ── time ───────────────────────────────────────────────────────────────── */

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Local `YYYY-MM-DD` — the log is a human's day, never UTC's. */
export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Local `HH:MM`. */
export function localTime(now = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function localStamp(now = new Date()): string {
  return `${localDay(now)} ${localTime(now)}`;
}

/* ── parse / serialize ──────────────────────────────────────────────────── */

// The importance bracket is optional so a hand-written `- T9 hand-edited` still counts
// as an item: it must be visible to the id-reuse guard and to working_drop. It gains an
// explicit `[3]` the next time that line is written.
const ITEM_RE = /^-\s+([GCPFTQID])(\d+)\s+(?:\[([0-9]+)\]\s+)?(.*)$/;
const HEADING_RE = /^##\s+([A-Z]+)\s*$/;
export const ID_RE = /^[GCPFTQID][0-9]+$/;

interface Line {
  raw: string;
  item?: WorkingItem;
}

interface Section {
  type: WorkingType;
  heading: string;
  lines: Line[];
}

interface WorkingDoc {
  header: WorkingHeader;
  /** Lines between the header and the first section, kept byte-for-byte. */
  preamble: string[];
  sections: Section[];
}

function emptyCounters(): Record<WorkingType, number> {
  return { G: 1, C: 1, P: 1, F: 1, T: 1, Q: 1, I: 1, D: 1 };
}

function parseHeader(line: string): WorkingHeader {
  const header: WorkingHeader = {
    updated: '',
    branch: null,
    head: null,
    next: emptyCounters(),
  };
  for (const rawSegment of line.split('·')) {
    const segment = rawSegment.trim();
    if (segment.startsWith('Updated ')) {
      header.updated = segment.slice('Updated '.length).trim();
    } else if (segment.startsWith('branch ')) {
      const rest = segment.slice('branch '.length).trim();
      const m = /^`?([^`@]*?)`?(?:\s+@\s+(\S+))?$/.exec(rest);
      if (m) {
        header.branch = m[1].trim() || null;
        header.head = m[2] ?? null;
      }
    } else if (segment.startsWith('next ')) {
      for (const m of segment.matchAll(/\b([GCPFTQID])([0-9]+)\b/g)) {
        header.next[m[1] as WorkingType] = Number.parseInt(m[2], 10);
      }
    }
  }
  return header;
}

function serializeHeader(header: WorkingHeader): string {
  const parts = [`Updated ${header.updated}`];
  if (header.branch) {
    parts.push(`branch \`${header.branch}\`${header.head ? ` @ ${header.head}` : ''}`);
  }
  parts.push(`next ${WORKING_TYPES.map((t) => `${t}${header.next[t]}`).join(' ')}`);
  return parts.join(' · ');
}

function serializeItem(item: WorkingItem): string {
  return `- ${item.id} [${item.importance}] ${item.text}`;
}

/**
 * Parse `working.md`. Anything that is not the header, a `## SECTION` heading or
 * an item line is kept verbatim inside the section it was found in, so a hand
 * written note between two items survives a tool write untouched.
 */
export function parseWorking(raw: string): WorkingDoc {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  // A trailing newline produces one empty final element; it is re-added on write.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  let index = 0;
  let header: WorkingHeader;
  if (lines[0]?.startsWith('Updated ')) {
    header = parseHeader(lines[0]);
    index = 1;
  } else {
    header = { updated: '', branch: null, head: null, next: emptyCounters() };
  }

  const preamble: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;

  for (; index < lines.length; index++) {
    const line = lines[index];
    const heading = HEADING_RE.exec(line);
    if (heading && LABEL_TYPES.has(heading[1])) {
      current = { type: LABEL_TYPES.get(heading[1])!, heading: line, lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      preamble.push(line);
      continue;
    }
    const m = ITEM_RE.exec(line);
    if (m) {
      const type = m[1] as WorkingType;
      current.lines.push({
        raw: line,
        item: {
          id: `${type}${m[2]}`,
          type,
          importance: clampImportance(m[3] === undefined ? 3 : Number.parseInt(m[3], 10)),
          text: m[4].trim(),
        },
      });
    } else {
      current.lines.push({ raw: line });
    }
  }

  // The header's counters are a convenience, not the truth: a hand-edited file
  // may hold an id past them, and reusing an id is the one thing ids must never do.
  for (const item of docItems({ header, preamble, sections })) {
    const n = Number.parseInt(item.id.slice(1), 10);
    if (n >= header.next[item.type]) header.next[item.type] = n + 1;
  }

  return { header, preamble, sections };
}

function docItems(doc: WorkingDoc): WorkingItem[] {
  const out: WorkingItem[] = [];
  for (const type of WORKING_TYPES) {
    for (const section of doc.sections) {
      if (section.type !== type) continue;
      for (const line of section.lines) if (line.item) out.push(line.item);
    }
  }
  return out;
}

function serializeWorking(doc: WorkingDoc): string {
  const out: string[] = [serializeHeader(doc.header)];
  out.push(...doc.preamble);
  const hasSections = doc.sections.some((s) => s.lines.some((l) => l.item));
  // The header reads as a header only with air under it; a file that already has
  // a preamble keeps whatever it had.
  if (hasSections && doc.preamble.length === 0) out.push('');
  for (const type of WORKING_TYPES) {
    for (const section of doc.sections) {
      if (section.type !== type) continue;
      // An empty section is noise on every re-read; drop the heading with the
      // last item (its stray blank lines go with it) — but never when somebody
      // left prose in there, which is theirs and outlives the items.
      const hasItems = section.lines.some((l) => l.item);
      const hasProse = section.lines.some((l) => !l.item && l.raw.trim() !== '');
      if (!hasItems && !hasProse) continue;
      out.push(section.heading);
      for (const line of section.lines) out.push(line.raw);
    }
  }
  while (out.length > 1 && out[out.length - 1].trim() === '') out.pop();
  return `${out.join('\n')}\n`;
}

function sectionFor(doc: WorkingDoc, type: WorkingType): Section {
  const found = doc.sections.find((s) => s.type === type);
  if (found) return found;
  const section: Section = { type, heading: `## ${TYPE_LABELS[type]}`, lines: [] };
  doc.sections.push(section);
  return section;
}

/* ── reads ──────────────────────────────────────────────────────────────── */

export interface WorkingSet {
  exists: boolean;
  path: string;
  header: WorkingHeader;
  items: WorkingItem[];
}

async function readDoc(file: string): Promise<WorkingDoc> {
  let raw = '';
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    raw = '';
  }
  return parseWorking(raw);
}

/** The live set. `exists: false` when the folder was never created. */
export async function readWorking(target: WorkingTarget): Promise<WorkingSet> {
  const paths = await workingPaths(target);
  if (!paths.exists) {
    return {
      exists: false,
      path: paths.file,
      header: { updated: '', branch: null, head: null, next: emptyCounters() },
      items: [],
    };
  }
  const doc = await readDoc(paths.file);
  return { exists: true, path: paths.file, header: doc.header, items: docItems(doc) };
}

/** `working.md` exactly as it sits on disk, or null when there is no folder. */
export async function readWorkingRaw(target: WorkingTarget): Promise<{
  path: string;
  text: string;
} | null> {
  const paths = await workingPaths(target);
  if (!paths.exists) return null;
  try {
    return { path: paths.file, text: await readFile(paths.file, 'utf8') };
  } catch {
    return null;
  }
}

/* ── the log ────────────────────────────────────────────────────────────── */

function logPathFor(logDir: string, day = localDay()): string {
  return path.join(logDir, `${day}.md`);
}

/** Append one `- HH:MM …` line to today's log, creating the file and folder. */
export async function appendLog(
  target: WorkingTarget,
  text: string,
): Promise<{ path: string }> {
  const paths = await workingPaths(target);
  if (!paths.exists) throw noFolder(paths.dir);
  return appendLogAt(paths.logDir, text);
}

async function appendLogAt(logDir: string, text: string): Promise<{ path: string }> {
  const flat = text.replace(/\s*\n+\s*/g, ' ').trim();
  const file = logPathFor(logDir);
  await mkdir(logDir, { recursive: true });
  await withFileLock(file, async () => {
    await appendFile(file, `- ${localTime()} ${flat}\n`, 'utf8');
  });
  return { path: file };
}

/**
 * Log lines: `"today"` is today's file; a number is the last N lines across the
 * newest files (oldest first), so a post-compaction read can ask for a tail
 * without knowing which days it spans.
 */
export async function readLog(
  target: WorkingTarget,
  spec: 'today' | number,
): Promise<string[]> {
  const paths = await workingPaths(target);
  if (!paths.exists) throw noFolder(paths.dir);
  let files: string[];
  try {
    files = (await readdir(paths.logDir)).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
  if (spec === 'today') {
    const today = `${localDay()}.md`;
    if (!files.includes(today)) return [];
    files = [today];
  }
  const limit = spec === 'today' ? Number.POSITIVE_INFINITY : Math.max(0, spec);
  if (limit === 0) return [];
  const lines: string[] = [];
  for (const name of files.slice(spec === 'today' ? 0 : -8)) {
    const text = await readFile(path.join(paths.logDir, name), 'utf8').catch(() => '');
    for (const line of text.split('\n')) if (line.trim()) lines.push(line);
  }
  return Number.isFinite(limit) ? lines.slice(-limit) : lines;
}

/* ── writes ─────────────────────────────────────────────────────────────── */

async function freshHeaderFields(
  from: string,
): Promise<{ updated: string; branch: string | null; head: string | null }> {
  let branch: string | null = null;
  let head: string | null = null;
  try {
    branch = await currentBranch(from);
  } catch {
    branch = null;
  }
  try {
    head = (await headSha(from)).slice(0, 7);
  } catch {
    head = null;
  }
  return { updated: localStamp(), branch, head };
}

function warningsFor(doc: WorkingDoc, touched: WorkingItem[]): string[] {
  const warnings: string[] = [];
  for (const item of touched) {
    if (item.text.length > MAX_TEXT_CHARS) warnings.push(`long: ${item.id}`);
  }
  const count = docItems(doc).length;
  if (count > MAX_ITEMS) {
    warnings.push(`crowded: ${count} items — run the keep test`);
  }
  return warnings;
}

function clampImportance(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 3;
  return Math.min(5, Math.max(1, n));
}

function validateText(text: string): string {
  if (/[\r\n]/.test(text)) {
    throw new WorkingError(
      'BAD_TEXT',
      'Working memory items are one line — newlines are not allowed. Keep it a headline (aim under 100 chars).',
    );
  }
  return text.trim();
}

/**
 * Run a read→modify→write against `working.md` under the per-file lock. The log
 * dir comes back with the result so callers append AFTER the write lands — a log
 * line for a write that then failed would be a lie in the one place that is
 * supposed to be the history.
 */
async function mutate<T>(
  target: WorkingTarget,
  fn: (doc: WorkingDoc) => Promise<T> | T,
): Promise<{ result: T; header: WorkingHeader; doc: WorkingDoc; logDir: string }> {
  const anchor = await toAnchor(target);
  const paths = await workingPaths(anchor);
  if (!paths.exists) throw noFolder(paths.dir);
  const fields = await freshHeaderFields(anchor.from);
  return withFileLock(paths.file, async () => {
    const doc = await readDoc(paths.file);
    const result = await fn(doc);
    Object.assign(doc.header, fields);
    await writeAtomic(paths.file, serializeWorking(doc));
    return { result, header: doc.header, doc, logDir: paths.logDir };
  });
}

export interface WorkingSetResult {
  ids: string[];
  header: WorkingHeader;
  warnings: string[];
  superseded: string[];
}

/**
 * Create and/or update items in one locked pass. Without an `id` the item is
 * created and given the next id for its type; with one it replaces that item's
 * importance and text. Type is fixed at creation — changing it is a drop plus a
 * create, so the id keeps meaning what it said.
 */
export async function setItems(
  target: WorkingTarget,
  items: WorkingSetItem[],
): Promise<WorkingSetResult> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new WorkingError('BAD_ITEMS', 'Pass at least one item.');
  }
  const superseded: string[] = [];
  const supersedeLogs: string[] = [];

  const { result, header, logDir } = await mutate(target, async (doc) => {
    const byId = new Map<string, { line: Line; section: Section }>();
    for (const section of doc.sections) {
      for (const line of section.lines) {
        if (line.item) byId.set(line.item.id, { line, section });
      }
    }

    const ids: string[] = [];
    const touched: WorkingItem[] = [];

    for (const raw of items) {
      const text = raw.text === undefined ? undefined : validateText(String(raw.text));
      if (raw.id !== undefined) {
        const id = String(raw.id).trim().toUpperCase();
        if (!ID_RE.test(id)) {
          throw new WorkingError('BAD_ID', `"${raw.id}" is not a working memory id (e.g. T12).`);
        }
        const found = byId.get(id);
        if (!found) {
          throw new WorkingError('NOT_FOUND', `No working memory item ${id}.`);
        }
        const type = found.line.item!.type;
        if (raw.type !== undefined && String(raw.type).trim().toUpperCase() !== type) {
          throw new WorkingError(
            'TYPE_IMMUTABLE',
            `${id} is a ${TYPE_LABELS[type]} item; type is fixed at creation. Drop it and create a new one instead.`,
          );
        }
        const item: WorkingItem = {
          id,
          type,
          importance:
            raw.importance === undefined
              ? found.line.item!.importance
              : clampImportance(raw.importance),
          text: text ?? found.line.item!.text,
        };
        found.line.item = item;
        found.line.raw = serializeItem(item);
        ids.push(id);
        touched.push(item);
        continue;
      }

      if (raw.type === undefined) {
        throw new WorkingError('BAD_TYPE', 'A new item needs a type (G C P F T Q I D).');
      }
      const type = String(raw.type).trim().toUpperCase() as WorkingType;
      if (!WORKING_TYPES.includes(type)) {
        throw new WorkingError(
          'BAD_TYPE',
          `"${raw.type}" is not a working memory type. Use one of ${WORKING_TYPES.join(' ')}.`,
        );
      }
      if (text === undefined || text === '') {
        throw new WorkingError('BAD_TEXT', 'A new item needs text.');
      }
      const id = `${type}${doc.header.next[type]}`;
      doc.header.next[type] += 1;
      const item: WorkingItem = {
        id,
        type,
        importance: clampImportance(raw.importance ?? 3),
        text,
      };

      // FOCUS is singular: which step are we on right now. A new one replaces
      // the old rather than stacking a history of steps nobody is on.
      if (type === 'F') {
        for (const section of doc.sections) {
          for (const line of [...section.lines]) {
            if (line.item?.type === 'F') {
              superseded.push(line.item.id);
              supersedeLogs.push(`supersede ${line.item.id} → ${id}`);
              section.lines.splice(section.lines.indexOf(line), 1);
              byId.delete(line.item.id);
            }
          }
        }
      }

      const section = sectionFor(doc, type);
      const line: Line = { raw: serializeItem(item), item };
      // Keep trailing blank lines trailing.
      let at = section.lines.length;
      while (at > 0 && section.lines[at - 1].raw.trim() === '') at -= 1;
      section.lines.splice(at, 0, line);
      byId.set(id, { line, section });
      ids.push(id);
      touched.push(item);
    }

    return { ids, warnings: warningsFor(doc, touched) };
  });

  for (const text of supersedeLogs) await appendLogAt(logDir, text);
  return { ids: result.ids, header, warnings: result.warnings, superseded };
}

export interface WorkingDropResult {
  dropped: string[];
  header: WorkingHeader;
  logged: boolean;
}

/** Remove items. With a reason, the drop is logged — that is the history. */
export async function dropItems(
  target: WorkingTarget,
  ids: string[],
  reason?: string,
): Promise<WorkingDropResult> {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new WorkingError('BAD_ID', 'Pass at least one id to drop.');
  }
  const wanted = ids.map((id) => String(id).trim().toUpperCase());
  for (const id of wanted) {
    if (!ID_RE.test(id)) {
      throw new WorkingError('BAD_ID', `"${id}" is not a working memory id (e.g. T12).`);
    }
  }

  const { result, header, logDir } = await mutate(target, async (doc) => {
    const present = new Set(docItems(doc).map((i) => i.id));
    const missing = wanted.filter((id) => !present.has(id));
    if (missing.length > 0) {
      throw new WorkingError(
        'NOT_FOUND',
        `No working memory item${missing.length > 1 ? 's' : ''} ${missing.join(', ')}.`,
      );
    }
    const target = new Set(wanted);
    const dropped: string[] = [];
    for (const section of doc.sections) {
      section.lines = section.lines.filter((line) => {
        if (line.item && target.has(line.item.id)) {
          dropped.push(line.item.id);
          return false;
        }
        return true;
      });
    }
    const logged = Boolean(reason && reason.trim());
    return { dropped, logged };
  });

  if (result.logged) {
    await appendLogAt(logDir, `drop ${result.dropped.join(', ')} — ${(reason as string).trim()}`);
  }
  return { dropped: result.dropped, header, logged: result.logged };
}

/* ── init ───────────────────────────────────────────────────────────────── */

export interface WorkingInitResult {
  dir: string;
  created: string[];
  gitignore: 'added' | 'present';
  hook?: 'installed' | 'present' | 'skipped';
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** The starting `working.md`: a header and nothing to read yet. */
async function emptyWorkingFile(from: string): Promise<string> {
  const fields = await freshHeaderFields(from);
  return `${serializeHeader({ ...fields, next: emptyCounters() })}\n`;
}

/**
 * Create the working folder, its rules file, an empty `working.md` and the two
 * `.gitignore` lines. Idempotent: run it twice and the second run creates
 * nothing. The SessionStart hook is opt-in — editing a user's settings.json is
 * invasive enough to be asked for, and it is reported either way.
 */
export async function initWorking(
  target: WorkingTarget,
  opts: { hook?: boolean } = {},
): Promise<WorkingInitResult> {
  // The scratchpad resolves through the MAIN checkout (one per plan or repo), but
  // the two TRACKED files do not: .gitignore and .claude/settings.json belong to
  // the checkout this call was made from, or a worktree would silently edit main's
  // files. .gitignore sits at the code root (it ignores a sibling of the plan);
  // settings.json sits at the git root, which is where Claude Code reads it.
  // Without a plan both are the calling checkout's git root.
  const { dir, codeRoot, gitRoot, from } = await toAnchor(target);
  const created: string[] = [];

  await mkdir(dir, { recursive: true });
  await mkdir(path.join(dir, WORKING_LOG_DIR), { recursive: true });

  const claudeFile = path.join(dir, WORKING_CLAUDE_FILE);
  if (!(await fileExists(claudeFile))) {
    await writeAtomic(claudeFile, workingClaudeMd());
    created.push(claudeFile);
  }

  const workingFile = path.join(dir, WORKING_FILE);
  if (!(await fileExists(workingFile))) {
    await writeAtomic(workingFile, await emptyWorkingFile(from));
    created.push(workingFile);
  }

  const gitignore = await ensureGitignore(codeRoot);
  const result: WorkingInitResult = { dir, created, gitignore };
  if (opts.hook) result.hook = await installHook(gitRoot);
  return result;
}

/** Add the two ignore lines to `<codeRoot>/.gitignore`, once. */
export async function ensureGitignore(codeRoot: string): Promise<'added' | 'present'> {
  const file = path.join(codeRoot, '.gitignore');
  return withFileLock(file, async () => {
    let raw = '';
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      raw = '';
    }
    const present = new Set(raw.split('\n').map((l) => l.trim()));
    const missing = GITIGNORE_LINES.filter((l) => !present.has(l));
    if (missing.length === 0) return 'present' as const;
    const prefix = raw === '' || raw.endsWith('\n') ? '' : '\n';
    const block = `${prefix}${raw === '' ? '' : '\n'}# Constellation working memory (local scratchpad; the rules file is committed)\n${missing.join('\n')}\n`;
    await writeAtomic(file, raw + block);
    return 'added' as const;
  });
}

interface HookEntry {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string }>;
}

/**
 * Merge the SessionStart hook into `<gitRoot>/.claude/settings.json` — the REPO
 * root, because that is where Claude Code reads project settings; in a monorepo a
 * package's plan still installs the hook once, at the top.
 *
 * The hook is the guarantee: compaction is a summarizer call with no tool
 * access, so nothing can steer what the summary keeps — but a SessionStart hook
 * prints the file back under it every time. The merge is surgical: unknown keys,
 * other events and other SessionStart entries are left exactly as they were.
 */
export async function installHook(
  gitRoot: string,
): Promise<'installed' | 'present' | 'skipped'> {
  const dir = path.join(gitRoot, '.claude');
  const file = path.join(dir, 'settings.json');
  return withFileLock(file, async () => {
    let settings: Record<string, unknown> = {};
    let raw: string | null = null;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      raw = null;
    }
    if (raw !== null && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          // Never rewrite a settings file we cannot understand.
          return 'skipped' as const;
        }
        settings = parsed as Record<string, unknown>;
      } catch {
        return 'skipped' as const;
      }
    }

    const hooks =
      settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks)
        ? (settings.hooks as Record<string, unknown>)
        : {};
    const sessionStart = Array.isArray(hooks.SessionStart)
      ? ([...hooks.SessionStart] as HookEntry[])
      : [];
    const already = sessionStart.some((entry) =>
      (entry?.hooks ?? []).some((h) => h?.command === HOOK_COMMAND),
    );
    if (already) return 'present' as const;

    sessionStart.push({
      matcher: HOOK_MATCHER,
      hooks: [{ type: 'command', command: HOOK_COMMAND }],
    });
    settings.hooks = { ...hooks, SessionStart: sessionStart };
    await mkdir(dir, { recursive: true });
    await writeAtomic(file, `${JSON.stringify(settings, null, 2)}\n`);
    return 'installed' as const;
  });
}

/** The one-line preamble the CLI prints above the file. */
export function workingPreamble(file: string): string {
  return `Working memory · ${file} · authoritative for what is in flight; verify against git/worktrees before acting`;
}
