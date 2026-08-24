import { readFile, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  isHandleShaped,
  isKnownHandle,
  TYPE_FOLDERS,
  typeForHandle,
} from '../core/handles.js';
import { loadPlan, neighborsOf } from '../core/indexer.js';
import { lintPlan } from '../core/lint.js';
import { resolvePlanDir } from '../core/resolve.js';
import type { Card, Issue, PlanIndex, TypeName } from '../core/types.js';
import { TYPE_NAMES } from '../core/types.js';
import type { RunningServer } from '../serve/server.js';
import {
  changedFilesSince,
  diffPlan,
  formatReviewVersion,
  headSha,
  planRootsFor,
  planDirty,
  planLog,
  resolveCommit,
  stampFormatReview,
  writeSyncPoint,
} from '../core/git.js';
import { CONSTELLATION_VERSION } from '../core/version.js';
import { computeSyncStatus, packageVersion } from '../core/sync.js';
import { boundPathsForCard, boundPathsOverlap, resolveCodeForCard } from '../core/code.js';
import { computeStaleCards } from '../core/stale.js';
import { searchPlan } from './search.js';
import {
  applyCardPatch,
  bodyHeadingTexts,
  createCardFile,
  deepMerge,
  mutateCardFile,
  relPathForHandle,
  replaceBodySection,
  reservedFieldKeys,
  withAppendedNote,
} from '../core/writer.js';
import { renameCard, RenameCardError } from '../core/rename.js';
import type { CardNote } from '../core/writer.js';
import {
  connectedRepoToFm,
  codeRootFor,
  connectedReposFromFrontmatter,
  listConnectedRepos,
  readConnectedRepos,
  removeConnectedRepoEntry,
  resolveConnectedRepo,
  upsertConnectedRepo,
} from '../core/repos.js';
import type { ConnectedRepo } from '../core/types.js';

const PACKAGE_VERSION = CONSTELLATION_VERSION;
export { PACKAGE_VERSION as MCP_SERVER_VERSION };

export const INSTRUCTIONS = `# Constellation MCP

The plan in constellation/ is this project's durable, cross-session memory. Read the cards covering an area BEFORE
you change code there — you recover prior agents' understanding instead of starting fresh — and bring them back into
line after; that is part of "done." A card you can't trust is worse than no card.

One file = one card; the filename is the handle (api/API-TICKETS.md = API-TICKETS). Connections are undirected and
come from frontmatter ONLY — the connections: list and handle-shaped frontmatter values; a [[HANDLE]] body link or a
mermaid node ID is a hyperlink for readers, never an edge, so put every relationship the graph should know in
connections:. Cards hold what code can't say — intent, rejected alternatives, current state, gotchas, cross-cutting
rules; never duplicate DDL or code, never write index cards enumerating others. If tools return NO_PLAN_FOUND, call
init_plan once — never create constellation/ or hand-write plan.md yourself.

The rule: all card writes go through the Constellation tools; never edit a card file directly — hand-edits invent
fields and formats the schema doesn't support, feeding bad data to the viewer and to every future agent that loads
the plan. The writers: create_card(s), update_card, edit_section, append_note, add_connection(s), remove_connection,
set_verified, rename_card, delete_card. Each lints and returns the issues for the file it touched; the card is still
written when issues come back (lint state, not failure). When a write tool errors (STALE, NOT_FOUND, a reserved-key
rejection, a timeout), re-read the card and retry, or report the failure — never fall through to editing the file.

Prefer cheap writes: append_note appends one typed note (decision | gotcha | state | deviation | verified);
edit_section replaces one ## section. Both are byte-preserving. update_card is coarser: patch.fields deep-merges
(arrays replace, null deletes), but patch.connections and body REPLACE wholesale — send a complete body, or use
edit_section, and never bulk-rewrite plan.md. Batch scaffolds with create_cards + add_connections (intra-batch refs
resolve), sweeps with set_verified handles: [...] — each lints ONCE. rename_card rewrites every reference
plan-wide — never delete-and-recreate to rename; for bulk changes loop the singular tools (CLI: constellation
rename), never search-and-replace the plan folder. delete_card does NOT rewrite references: it returns referenced_by
and leaves E005s to clean up; remove_connection strips only the connections: list — an edge also declared by a
handle-shaped frontmatter field needs edit_section. Call describe_type before authoring an unfamiliar type, and
author in the types the plan already uses.

Call orient at session start: a small read-only briefing on the plan's shape, drift and newest notes. Retrieve lean:
summaries by default, full content only for cards you name. traverse and assemble walk the connection graph, so a
load-bearing relationship belongs in connections:, not just a [[link]]. assemble returns an INDEX by default (file-disjoint
units, seeds, bound paths, no bodies); ask hydration: "full" only when you need bodies. Hydration never truncates silently:
repeats (hydrated_elsewhere), supernodes (DIAGRAM / PLAN-PROJECT as neighbors) and over-budget cards degrade to
summaries — everything held back is named in hydration_budget, refetchable by handle. search / list_cards /
list_notes page: read total/more/next, don't raise limit. get_card returns the newest notes (notes_limit,
notes_truncated) and, with code:, the code a card is bound to. Grep on cards is allowed, but search is usually the
better first call — ranked handles not raw lines, one call not grep → map paths → get_card, and it covers notes,
path/code_refs and connected repos; search is AND, relaxing to ANY word (relaxed: true) when nothing matches all.

Plan-first applies to BEHAVIOR changes only — a new FEATURE, an API contract, a STATE change: read the neighborhood,
express the end state in cards (unbuilt work is status: planned), show that card diff as the proposal, then bring
the code up to match, bumping status planned → building → built → verified. Non-behavioral work (refactors, CSS,
deps) goes straight to code — then fix the cards it broke. "Sync the plan" means bringing code and cards into
agreement, not stamping a marker and not rewriting cards to match whatever the code does. Drift follows git: a card
is stale when its bound code has commits newer than the card's. Commit the card together with the code; stale_report
on a dirty tree flags work in progress — expected, not drift to fix. set_verified is the explicit override, stamping
verified_sha / verified_at as the baseline; never stamp dirty flags into cards — "what changed" is diff_plan /
plan_log / git.

Multi-repo: PLAN-PROJECT.connected_repos lists sibling repos (add_connected_repo / remove_connected_repo); pass
repo: to any tool to read or write THAT repo's plan. Cards never connect across repos. start_viewer serves the
plan as an editable site — post the returned URL back to the user.`;

/* ── the one-time format-upgrade review ─────────────────────────────────────
 * 0.5.0 changed what makes an edge: a [[link]] or a mermaid node ID stopped
 * being one. Plans authored before that encoded real relationships in prose and
 * would silently lose them, so the first server boot against such a plan says so
 * — once. The signal is `format_review` in .sync.json: absent (or no marker at
 * all) means never reviewed. It is provenance, not a derived flag, and only a
 * human-confirmed review (set_sync_point format_review: true) or init_plan
 * writes it.
 */

/** Appended to INSTRUCTIONS at boot when the resolved plan has no review stamp. */
export function upgradeReviewNotice(version: string): string {
  return (
    `\n\nThis is the first run on Constellation ${version} against a plan authored on an earlier version, so you ` +
    `need to understand what changed: prose [[links]] and mermaid node IDs no longer form the connection graph — ` +
    `only connections: entries and handle-shaped frontmatter values do. Make updates to the cards as necessary: ` +
    `promote real relationships into connections:, reconnect unintentional orphans, and compact wordy or ` +
    `token-heavy cards while you're in there. Confirm the plan with the user before large edits, and when the ` +
    `review is done (or the user wants this notice silenced), stamp it with set_sync_point format_review: true — ` +
    `this notice then never appears again.`
  );
}

/** One line of the same, for orient — hosts that truncate the handshake still get it. */
export function upgradeReviewHint(version: string): string {
  return (
    `First run on ${version}: plan predates the 0.5.0 connection rules — upgrade review pending. ` +
    `Prose [[links]] are no longer edges; promote real relationships into connections:, then stamp ` +
    `set_sync_point format_review: true.`
  );
}

/** True when the plan has never been reviewed under the current format rules. */
async function upgradeReviewPending(root: string): Promise<boolean> {
  return (await formatReviewVersion(root)) === null;
}

/**
 * The handshake instructions for this boot: the static string, plus the upgrade
 * notice when a plan resolves and carries no review stamp. No plan (or an
 * unreadable one) → the static string, unchanged.
 */
export async function bootInstructions(planRoot?: string | null): Promise<string> {
  try {
    // Resolve even a fixed root: a path that holds no plan must not be prompted
    // about, and the notice is never worth an error at handshake time.
    const root = await resolvePlanDir(planRoot ?? undefined);
    if (!root) return INSTRUCTIONS;
    if (!(await upgradeReviewPending(root))) return INSTRUCTIONS;
    return INSTRUCTIONS + upgradeReviewNotice(PACKAGE_VERSION);
  } catch {
    return INSTRUCTIONS;
  }
}

// The plan-from-code playbook lives in one file (skill/methodology.md), shared by the
// skill and the MCP prompts so the two can't drift. From dist/mcp/server.js (or
// src/mcp/server.ts) '../..' is the package root, where skill/, types, and schemas ship.
const PKG_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const METHODOLOGY_PATH = path.join(PKG_ROOT, 'skill', 'methodology.md');
const SCHEMAS_DIR = path.join(PKG_ROOT, 'schemas');
const TYPE_DOCS_DIR = path.join(PKG_ROOT, 'skill', 'types');

/** Parsed JSON Schema for a type's frontmatter, or null if it can't be read. */
async function readTypeSchema(folder: string): Promise<unknown> {
  try {
    return JSON.parse(
      await readFile(path.join(SCHEMAS_DIR, `${folder}.json`), 'utf8'),
    );
  } catch {
    return null;
  }
}

/** The authoring reference (field table + golden example) for a type, or null. */
async function readTypeDoc(folder: string): Promise<string | null> {
  try {
    return await readFile(path.join(TYPE_DOCS_DIR, `${folder}.md`), 'utf8');
  } catch {
    return null;
  }
}

/** First sentence of a schema's top-level description — its one-line purpose. */
function schemaPurpose(schema: unknown): string {
  const desc =
    schema && typeof schema === 'object' && 'description' in schema
      ? String((schema as { description?: unknown }).description ?? '')
      : '';
  const match = desc.match(/^.*?\.(?:\s|$)/);
  return (match ? match[0] : desc).trim();
}

let methodologyCache: string | null = null;

async function methodologyText(): Promise<string> {
  if (methodologyCache === null) {
    methodologyCache = await readFile(METHODOLOGY_PATH, 'utf8');
  }
  return methodologyCache;
}

/** A prompt body = a one-line mode intro followed by the shared methodology. */
async function planPromptBody(intro: string): Promise<string> {
  try {
    return `${intro}\n\n${await methodologyText()}`;
  } catch {
    return (
      `${intro}\n\n(Could not read the methodology file; follow the macro→micro summary ` +
      `in the server instructions: orient, follow the data, follow the user/auth, follow ` +
      `the edges, zoom in, ask only what the code can't answer, find gaps, recommend.)`
    );
  }
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(code: string, message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }],
    isError: true,
  };
}

/**
 * A per-item `failed[].error` for a write that threw. Batch rows are read by
 * code first (`NOT_FOUND`, `CARD_EXISTS`, `INVALID_CONNECTION: …`), so a raw
 * fs message — temp path and all — cannot be the whole value; it rides behind
 * the code, where it is still there to diagnose.
 */
function writeFailed(err: unknown): string {
  return `WRITE_FAILED: ${err instanceof Error ? err.message : String(err)}`;
}

async function openUrl(url: string): Promise<void> {
  try {
    const { spawn } = await import('node:child_process');
    const child =
      process.platform === 'darwin'
        ? spawn('open', [url], { stdio: 'ignore', detached: true })
        : process.platform === 'win32'
          ? spawn('cmd', ['/c', 'start', '', url], {
              stdio: 'ignore',
              detached: true,
              windowsHide: true,
            })
          : spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Opening the browser is best-effort; callers still receive the URL.
  }
}

function summary(card: Card) {
  return {
    handle: card.handle,
    type: card.type,
    kind: card.kind ?? null,
    name: card.name ?? null,
    status: card.status ?? null,
  };
}

function full(card: Card) {
  return { ...summary(card), frontmatter: card.frontmatter, body: card.body };
}

/**
 * How many of a card's notes hydration returns by default. A long-lived card
 * accumulates a diary; the last few are the current state, the rest are history
 * `list_notes` can fetch in full. 0 means "all".
 */
const DEFAULT_NOTES_TAIL = 5;

/**
 * RESPONSE SHAPING ONLY — trim a card view's notes to the newest `limit` (and,
 * optionally, to one kind), reporting how many were left out. The card FILE is
 * never touched: this is what the caller receives, not what the plan holds.
 */
function withNotesTail(
  view: ReturnType<typeof full>,
  card: Card,
  limit: number,
  kind?: string,
): Record<string, unknown> {
  const raw = card.frontmatter.notes;
  if (!Array.isArray(raw)) return view;
  const notes = raw.filter(
    (n): n is Record<string, unknown> => Boolean(n) && typeof n === 'object',
  );
  const selected = kind ? notes.filter((n) => n.kind === kind) : notes;
  const shown = limit > 0 && selected.length > limit ? selected.slice(-limit) : selected;
  if (shown.length === notes.length && !kind) return view;
  const out: Record<string, unknown> = {
    ...view,
    frontmatter: { ...card.frontmatter, notes: shown },
  };
  if (selected.length > shown.length) out.notes_truncated = selected.length - shown.length;
  return out;
}

type Detail = 'none' | 'summary' | 'full';

type CardView = Record<string, unknown>;

/**
 * Caps on hydrated CARD text, mirroring code.ts's caps on attached FILE text.
 * Neighbor prose is denser than source, so the ceilings are lower: a single
 * neighbor over the per-card cap, or anything past the response total, comes
 * back as a summary the agent can fetch with get_card — never as silently
 * truncated text. The explicitly requested card is exempt from both.
 */
export const HYDRATION_PER_CARD_MAX = 24 * 1024;
export const HYDRATION_TOTAL_MAX = 96 * 1024;

/** Rough serialized weight of a card's hydrated content. */
function hydratedBytes(card: Card): number {
  let fmBytes = 0;
  try {
    fmBytes = Buffer.byteLength(JSON.stringify(card.frontmatter) ?? '');
  } catch {
    fmBytes = 0;
  }
  return Buffer.byteLength(card.body) + fmBytes;
}

/**
 * Cards that connect to everything. A DIAGRAM names every node it draws and
 * PLAN-PROJECT sits next to the whole plan, so hydrating one as a NEIGHBOR
 * drags in the response's whole budget for context nobody asked for. Ask for
 * either directly and you still get all of it.
 */
function isSupernode(card: Card): boolean {
  return card.type === 'DIAGRAM' || card.handle === 'PLAN-PROJECT';
}

/**
 * Per-RESPONSE hydration budget and dedupe ledger. One rule, stated once in the
 * tool descriptions: a card's full frontmatter + body appears AT MOST ONCE in a
 * response; every later appearance is that card's summary with
 * `hydrated_elsewhere: true`. Degradations (supernode, per-card cap, exhausted
 * budget) are reported per card as `degraded_to_summary` and collected in the
 * response's `hydration_budget`.
 */
class Hydrator {
  private readonly emitted = new Set<string>();
  private readonly dedupedSet = new Set<string>();
  private readonly degradedSet = new Set<string>();
  private used = 0;
  private exhausted = false;

  constructor(private readonly notesLimit: number = DEFAULT_NOTES_TAIL) {}

  /** An explicitly requested card: full content, exempt from every cap. */
  primary(card: Card, notesKind?: string): CardView {
    if (this.emitted.has(card.handle)) {
      this.dedupedSet.add(card.handle);
      return { ...summary(card), hydrated_elsewhere: true };
    }
    this.emitted.add(card.handle);
    this.used += hydratedBytes(card);
    return withNotesTail(full(card), card, this.notesLimit, notesKind);
  }

  /** A card reached BY connection: subject to dedupe, supernode and budget rules. */
  view(card: Card, detail: Detail): CardView | undefined {
    if (detail === 'none') return undefined;
    if (detail === 'summary') return summary(card);
    if (this.emitted.has(card.handle)) {
      this.dedupedSet.add(card.handle);
      return { ...summary(card), hydrated_elsewhere: true };
    }
    const reason = this.degradeReason(card);
    if (reason) {
      this.degradedSet.add(card.handle);
      return { ...summary(card), degraded_to_summary: reason };
    }
    this.emitted.add(card.handle);
    this.used += hydratedBytes(card);
    return withNotesTail(full(card), card, this.notesLimit);
  }

  private degradeReason(card: Card): string | null {
    if (isSupernode(card)) return 'supernode';
    const bytes = hydratedBytes(card);
    if (bytes > HYDRATION_PER_CARD_MAX) return 'over per-card cap';
    if (this.used + bytes > HYDRATION_TOTAL_MAX) {
      this.exhausted = true;
      return 'budget exhausted';
    }
    return null;
  }

  /** The response's hydration accounting, or undefined when nothing was held back. */
  report(): Record<string, unknown> | undefined {
    if (this.dedupedSet.size === 0 && this.degradedSet.size === 0) return undefined;
    return {
      per_card_max_bytes: HYDRATION_PER_CARD_MAX,
      total_max_bytes: HYDRATION_TOTAL_MAX,
      hydrated_bytes: this.used,
      deduped: [...this.dedupedSet].sort(),
      degraded: [...this.degradedSet].sort(),
      budget_exhausted: this.exhausted,
      note: 'Full content appears once per response. Cards listed here came back as summaries — fetch any you need with get_card.',
    };
  }
}

function connectedCards(
  index: PlanIndex,
  handle: string,
  detail: Detail,
  opts: { hydrator?: Hydrator } = {},
) {
  if (detail === 'none') return undefined;
  const hydrator = opts.hydrator ?? new Hydrator();
  const handles = [...neighborsOf(index, handle)].sort();
  const out: CardView[] = [];
  for (const h of handles) {
    const card = index.cards.get(h);
    if (!card) continue;
    const view = hydrator.view(card, detail);
    if (!view) continue;
    out.push(view);
  }
  return out;
}

function issuesForFile(issues: Issue[], relPath: string): Issue[] {
  return issues.filter((i) => i.file === relPath);
}

// Rough dependency tiers for assemble's suggested build order: data first, then
// contracts, then surfaces. Connections are undirected, so this is a heuristic
// by type, not a true topological sort.
const TYPE_TIER: Partial<Record<TypeName, number>> = {
  DB: 0, DATATYPE: 1, ROLE: 2, EXTERNAL: 2, EVENT: 2,
  API: 3, JOB: 3, STATE: 4, FLOW: 4, COMPONENT: 5, PAGE: 6,
  FILE: 7, TEST: 8, DOC: 9, DIAGRAM: 9, AGENT: 9, PLAN: 9,
};
const tierOf = (type: TypeName): number => TYPE_TIER[type] ?? 5;

/**
 * Partition seed handles into groups whose bound file sets are disjoint, so each
 * group can be handed to its own sub-agent with no risk of two agents editing
 * the same file. Seeds that share any bound file land in the same group.
 */
function partitionByFiles(
  seeds: string[],
  filesBy: Map<string, string[]>,
): Array<{ handles: string[]; files: string[] }> {
  const parent = new Map<string, string>();
  seeds.forEach((s) => parent.set(s, s));
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (parent.get(x) !== root) {
      const next = parent.get(x)!;
      parent.set(x, root);
      x = next;
    }
    return root;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));

  const fileOwner = new Map<string, string>();
  for (const s of seeds) {
    for (const f of filesBy.get(s) ?? []) {
      // Directory bindings overlap every path under them — `tests` and
      // `tests/foo.ts` must land in the same unit or fan-out assigns two
      // agents to the same files.
      for (const [existing, owner] of fileOwner) {
        if (boundPathsOverlap(existing, f)) union(owner, s);
      }
      fileOwner.set(f, s);
    }
  }

  const groups = new Map<string, { handles: string[]; files: Set<string> }>();
  for (const s of seeds) {
    const r = find(s);
    if (!groups.has(r)) groups.set(r, { handles: [], files: new Set() });
    const g = groups.get(r)!;
    g.handles.push(s);
    for (const f of filesBy.get(s) ?? []) g.files.add(f);
  }
  return [...groups.values()].map((g) => ({
    handles: g.handles.sort(),
    files: [...g.files].sort(),
  }));
}

/* ── orient: the session-start briefing ─────────────────────────────────── */

const ORIENT_SUMMARY_CHARS = 300;
const ORIENT_NOTE_CHARS = 120;
const ORIENT_NOTE_LIMIT = 10;
const ORIENT_STALE_LIMIT = 5;

/** One-line preview: collapse whitespace, cut at `max`, mark the cut. */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}…`;
}

/** PLAN-PROJECT's `summary` field, else the opening prose of its body. */
function projectSummary(card: Card | undefined): string | null {
  if (!card) return null;
  const declared = card.frontmatter.summary;
  if (typeof declared === 'string' && declared.trim()) {
    return clip(declared, ORIENT_SUMMARY_CHARS);
  }
  const prose = card.body
    .split('\n')
    .filter((line) => line.trim() && !line.trimStart().startsWith('#'))
    .join(' ');
  return prose.trim() ? clip(prose, ORIENT_SUMMARY_CHARS) : null;
}

/** Numeric semver comparison (prerelease suffixes ignored). */
function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((p) => Number.parseInt(p, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/**
 * The whole plan at a glance — what `orient` returns. Deliberately small: counts
 * and handles, never card bodies. Everything here is computed live from the
 * files and git; nothing is stored.
 */
async function orientReport(root: string): Promise<Record<string, unknown>> {
  const index = await loadPlan(root);
  const cards = [...index.cards.values()];

  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {
    planned: 0,
    building: 0,
    built: 0,
    verified: 0,
    none: 0,
  };
  for (const card of cards) {
    byType[card.type] = (byType[card.type] ?? 0) + 1;
    const status = card.status ?? 'none';
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }

  const project = index.cards.get('PLAN-PROJECT');

  // Notes carry no timestamp, so "newest" is the newest-touched card files
  // first, and within a card its latest appended notes first.
  const mtimes = new Map<string, number>();
  await Promise.all(
    cards.map(async (card) => {
      try {
        mtimes.set(card.handle, (await stat(card.filePath)).mtimeMs);
      } catch {
        mtimes.set(card.handle, 0);
      }
    }),
  );
  const noteRows: Array<{
    handle: string;
    kind: string;
    text: string;
    mtime: number;
    order: number;
  }> = [];
  for (const card of cards) {
    const list = Array.isArray(card.frontmatter.notes) ? card.frontmatter.notes : [];
    list.forEach((raw, order) => {
      if (!raw || typeof raw !== 'object') return;
      const note = raw as Record<string, unknown>;
      if (typeof note.text !== 'string') return;
      noteRows.push({
        handle: card.handle,
        kind: typeof note.kind === 'string' ? note.kind : 'note',
        text: note.text,
        mtime: mtimes.get(card.handle) ?? 0,
        order,
      });
    });
  }
  noteRows.sort((a, b) => b.mtime - a.mtime || b.order - a.order);
  const recentNotes = noteRows
    .slice(0, ORIENT_NOTE_LIMIT)
    .map((n) => ({ handle: n.handle, kind: n.kind, text: clip(n.text, ORIENT_NOTE_CHARS) }));

  let stale: Record<string, unknown> | null = null;
  try {
    const result = await computeStaleCards(root, index);
    const handles = result.stale.slice(0, ORIENT_STALE_LIMIT).map((s) => s.handle);
    stale = {
      count: result.stale.length,
      handles,
      ...(result.stale.length > handles.length
        ? { note: 'Truncated — stale_report has the full table.' }
        : {}),
    };
  } catch {
    stale = null;
  }

  let repos: Array<{ name: string; path: string; reachable: boolean }> = [];
  try {
    repos = (await listConnectedRepos(root)).map((r) => ({
      name: r.name,
      path: r.path,
      reachable: r.reachable,
    }));
  } catch {
    repos = [];
  }

  const workspace = await packageVersion(root);
  const versions: Record<string, unknown> = {
    server: PACKAGE_VERSION,
    workspace,
    version_mismatch: workspace !== null && workspace !== PACKAGE_VERSION,
  };
  if (versions.version_mismatch) {
    const older = compareVersions(PACKAGE_VERSION, workspace!) < 0;
    versions.warning = older
      ? `This MCP server is ${PACKAGE_VERSION}, older than the workspace's ${workspace} — you may be talking to a published server against an unreleased tree. Rebuild and restart it if you expect new behavior.`
      : `This MCP server is ${PACKAGE_VERSION}, ahead of the workspace's ${workspace} — the running server includes changes this tree has not released.`;
  }

  // Belt and suspenders for the boot notice: a host that truncates or hides the
  // handshake instructions still sees the pending review here.
  let pending = false;
  try {
    pending = await upgradeReviewPending(root);
  } catch {
    pending = false;
  }

  return {
    plan_root: index.root,
    project: {
      handle: 'PLAN-PROJECT',
      name: project?.name ?? null,
      summary: projectSummary(project),
    },
    cards: { total: cards.length, by_type: byType, by_status: byStatus },
    stale,
    recent_notes: recentNotes,
    connected_repos: repos,
    versions,
    ...(pending
      ? {
          upgrade_review_pending: true,
          upgrade_review: upgradeReviewHint(PACKAGE_VERSION),
        }
      : {}),
  };
}

const detailSchema = z.enum(['none', 'summary', 'full']);
const typeSchema = z.enum(TYPE_NAMES as unknown as [TypeName, ...TypeName[]]);
const statusSchema = z.enum(['planned', 'building', 'built', 'verified']);
// Filter variant: "none" selects cards with no status at all — unset usually
// means nobody has claimed the card is built, so backlog queries want it.
const statusFilterSchema = z.enum(['planned', 'building', 'built', 'verified', 'none']);
type StatusFilter = z.infer<typeof statusFilterSchema>;
const statusesSchema = z
  .union([statusFilterSchema, z.array(statusFilterSchema).min(1)])
  .optional();

function statusSetOf(status?: StatusFilter | StatusFilter[]): Set<string> | null {
  if (status === undefined) return null;
  return new Set(Array.isArray(status) ? status : [status]);
}
/**
 * Stateless paging for the flat list tools. No cursors and no server-side state:
 * the index is rebuilt from files on every call, so a cursor could only lie.
 * offset indexes into the same deterministic order the tool already returns.
 */
const offsetSchema = z
  .number()
  .int()
  .min(0)
  .optional()
  .describe('skip this many rows before the page (default 0)');

/**
 * Truncation must ALWAYS be self-addressed: say how many rows exist, which slice
 * came back, and the exact params that fetch the rest. Never a silent cut.
 */
function pageFields(
  total: number,
  offset: number,
  limit: number,
  returned: number,
): Record<string, unknown> {
  const end = offset + returned;
  const fields: Record<string, unknown> = { offset, limit, returned };
  if (end < total) {
    fields.more = true;
    fields.next = `${total - end} more — repeat with offset: ${end} (limit: ${limit}).`;
  } else {
    fields.more = false;
  }
  return fields;
}
const noteKindSchema = z.enum(['decision', 'gotcha', 'state', 'deviation', 'verified']);
const codeModeSchema = z.enum(['none', 'paths', 'direct']);
const repoSchema = z
  .string()
  .optional()
  .describe(
    'Target a connected repo by its connected_repos name (or a path). Omit to use the current repo.',
  );

export interface ServerOptions {
  /** Fixed plan root (tests); when omitted, resolved per call by walking up from cwd. */
  planRoot?: string;
  /**
   * Handshake instructions. Defaults to the static INSTRUCTIONS; `createServer`
   * passes the boot-computed string, which may carry the upgrade-review notice.
   */
  instructions?: string;
}

export function buildServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'constellation', version: PACKAGE_VERSION },
    { instructions: options.instructions ?? INSTRUCTIONS },
  );

  server.registerPrompt(
    'bootstrap_plan',
    {
      title: 'Bootstrap a plan from the codebase',
      description:
        'Analyze this repository macro→micro and build (or extend) the Constellation plan: follow the data and the user/auth journeys, capture flows, diagrams, and state machines, ask the user what the code cannot answer, and flag gaps.',
    },
    async () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: await planPromptBody(
              'Bootstrap (or extend) the Constellation plan for THIS repository by analyzing its code. If no plan exists, call init_plan first. Work the method below end to end, then report the gaps you found and a short, prioritized list of recommendations.',
            ),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'audit_plan',
    {
      title: 'Audit the plan against the code',
      description:
        'Reconcile the existing plan with the codebase: find gaps, orphans, stale or missing cards, and dangling refs; verify card statuses against the real code; and make tasteful recommendations.',
    },
    async () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: await planPromptBody(
              'Audit the existing Constellation plan for THIS repository against its code. Lean on Steps 7–8 (find gaps, recommend) and on verifying statuses against real code, but use the whole method as a checklist. Report what is missing, stale, or orphaned, then a short, prioritized list of recommendations.',
            ),
          },
        },
      ],
    }),
  );

  async function planRoot(): Promise<string | null> {
    return options.planRoot ?? resolvePlanDir();
  }

  // A single web viewer owned by this server process; null until start_viewer runs.
  let viewer: { server: RunningServer; planRoot: string; url: string } | null = null;

  const noPlanFound = () =>
    fail(
      'NO_PLAN_FOUND',
      `No constellation/ folder found by walking up from ${process.cwd()}. This MCP ` +
        'server uses its own working directory, so set "cwd" to the project if needed. ' +
        'In a monorepo, plans typically live at packages/<name>/constellation and are ' +
        'addressed with repo=<path or name>. Otherwise call init_plan (optionally with ' +
        '{ path } pointing at the intended project root), or run `constellation init`.',
    );

  /**
   * Resolve which plan a call targets. With no `repo`, the home plan (walk up
   * from cwd); with `repo`, a connected repo selected by its connected_repos
   * name or by a path. Returns the resolved root or a ready-to-return error.
   */
  async function resolveTarget(
    repo?: string,
  ): Promise<{ root: string } | { error: ToolResult }> {
    const home = await planRoot();
    if (!repo) {
      return home ? { root: home } : { error: noPlanFound() };
    }
    if (home) {
      const resolved = await resolveConnectedRepo(home, repo);
      if (resolved) return { root: resolved.root };
      const names = (await readConnectedRepos(home)).map((r) => r.name);
      return {
        error: fail(
          'UNKNOWN_REPO',
          `Connected repo "${repo}" not found. Pass a connected_repos name ` +
            `(${names.length ? names.join(', ') : 'none declared — add one with add_connected_repo'}) ` +
            'or a path to a repo that has a constellation/ plan.',
        ),
      };
    }
    // No home plan: a name can't be looked up, but a path can still resolve.
    const byPath = await resolvePlanDir(
      path.isAbsolute(repo) ? repo : path.resolve(process.cwd(), repo),
    );
    if (byPath) return { root: byPath };
    return {
      error: fail(
        'UNKNOWN_REPO',
        `No plan found for repo "${repo}". With no plan in the current directory, pass a ` +
          'path to a repo that has a constellation/ plan.',
      ),
    };
  }

  /** Wrap a handler with plan resolution and error reporting; `repo` selects a connected repo. */
  function withPlan<A>(
    handler: (root: string, args: A) => Promise<ToolResult>,
  ): (args: A) => Promise<ToolResult> {
    return async (args: A) => {
      const target = await resolveTarget((args as { repo?: string } | undefined)?.repo);
      if ('error' in target) return target.error;
      try {
        return await handler(target.root, args);
      } catch (err) {
        return fail('INTERNAL', err instanceof Error ? err.message : String(err));
      }
    };
  }

  server.registerTool(
    'init_plan',
    {
      description:
        'Bootstrap a new plan: create a constellation/ folder with a starter plan.md. Use only when no plan exists yet (other tools return NO_PLAN_FOUND). Pass name to set the project name (shown as the viewer title); if omitted it defaults to a title-cased folder name (pyramid-server → "Pyramid Server"). Propose a name, confirm it with the user, and change it anytime via update_card on PLAN-PROJECT. After this, create_card works immediately.',
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe('directory to create constellation/ in (default: cwd)'),
        name: z
          .string()
          .optional()
          .describe('project name for plan.md (default: a title-cased folder name)'),
      },
    },
    async ({ path: target, name }: { path?: string; name?: string }) => {
      try {
        const { initPlan } = await import('../core/scaffold.js');
        const { root: created, name: projectName } = await initPlan(
          target ?? process.cwd(),
          { name },
        );
        return ok({
          created,
          name: projectName,
          next: `Plan created with project name "${projectName}" (the viewer title). Confirm the name with the user — change it anytime via update_card on PLAN-PROJECT (patch.name). Then add cards with create_card.`,
        });
      } catch (err) {
        return fail(
          'INIT_FAILED',
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );

  server.registerTool(
    'orient',
    {
      annotations: { readOnlyHint: true },
      description:
        'Call ONCE at session start: the whole plan at a glance, in one small response. What the project is (PLAN-PROJECT name + summary), how big the plan is (type histogram, status rollup), what is drifting (stale count + a few handles), the newest memory across all cards (recent notes), any connected repos, and the server-vs-workspace version check. Read-only and never hydrated — no card bodies — so it costs a fraction of the list_cards/check_sync/list_notes opening ritual it replaces. Follow it with search or get_card on whatever it points you at.',
      inputSchema: { repo: repoSchema },
    },
    withPlan(async (root) => ok(await orientReport(root))),
  );

  server.registerTool(
    'get_card',
    {
      annotations: { readOnlyHint: true },
      description:
        'Fetch one card by handle, optionally with all connected cards hydrated. Connections come from frontmatter only — the connections: list and handle-shaped field values; a [[link]] or mermaid node ID in the body is a hyperlink for readers, not a connection, so it is not listed here. connected: "full" returns the complete frontmatter and body of every connected card — use it when about to work on an area. Hydration is capped and deduped: a card\'s full content appears at most once per response, DIAGRAM cards and PLAN-PROJECT are never hydrated as neighbors (ask for them directly instead), and anything past the text budget comes back as a summary with degraded_to_summary — see hydration_budget; nothing is ever silently truncated. code: "paths" returns the resolved file paths the card is bound to (connected FILE cards plus code_refs); code: "direct" attaches their contents (over-cap files truncated with truncated:true; binaries/lockfiles/generated skipped) so a background coder starts from intent + current code in one call. Notes come back as the newest 5 per card with notes_truncated: N when older ones were left out — raise notes_limit (0 = all) for a card\'s full history, or use list_notes. The card file itself is untouched either way.',
      inputSchema: {
        handle: z.string(),
        connected: detailSchema.optional().describe('default: summary'),
        code: codeModeSchema
          .optional()
          .describe('attach bound code: none (default) | paths | direct'),
        notes_kind: noteKindSchema
          .optional()
          .describe('filter the returned card.notes to one kind'),
        notes_limit: z
          .number()
          .int()
          .min(0)
          .max(500)
          .optional()
          .describe('most recent N notes per card (default 5; 0 = all)'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { handle, connected, code, notes_kind, notes_limit }) => {
      const index = await loadPlan(root);
      const card = index.cards.get(handle.toUpperCase());
      if (!card) return fail('NOT_FOUND', `No card with handle ${handle}`);
      const hydrator = new Hydrator(notes_limit ?? DEFAULT_NOTES_TAIL);
      const result: Record<string, unknown> = {
        card: hydrator.primary(card, notes_kind),
        connected_cards: connectedCards(index, card.handle, connected ?? 'summary', {
          hydrator,
        }),
      };
      if (code && code !== 'none') {
        result.code = await resolveCodeForCard(root, index, card, code);
      }
      const hydration = hydrator.report();
      if (hydration) result.hydration_budget = hydration;
      return ok(result);
    }),
  );

  server.registerTool(
    'list_cards',
    {
      annotations: { readOnlyHint: true },
      description:
        'Catalog of cards filtered by type, kind, status, and/or connectedness. status takes one value or a list; "none" selects cards with no status at all — status: ["planned", "building", "none"] is the backlog view (everything not yet built). connected:false returns orphans (cards with zero connections). Returns summaries (handle, type, kind, name, status) in handle order, paged: total is the full count and the response reports offset/limit/returned plus more:true and the exact offset to pass for the rest. Default page is 100.',
      inputSchema: {
        types: z.array(typeSchema).optional(),
        kind: z.string().optional(),
        status: statusesSchema.describe(
          'one status or a list; "none" = cards with no status set',
        ),
        connected: z
          .boolean()
          .optional()
          .describe('false = orphans only; true = connected only'),
        limit: z.number().int().min(1).max(500).optional().describe('page size (default 100)'),
        offset: offsetSchema,
        repo: repoSchema,
      },
    },
    withPlan(async (root, { types, kind, status, connected, limit, offset }) => {
      const index = await loadPlan(root);
      const typeFilter = types && types.length > 0 ? new Set(types) : null;
      const statusFilter = statusSetOf(status);
      const isConnected = (h: string) => (index.connectedHandles.get(h)?.size ?? 0) > 0;
      const matched = [...index.cards.values()]
        .filter((c) => !typeFilter || typeFilter.has(c.type))
        .filter((c) => !kind || c.kind === kind)
        .filter((c) => !statusFilter || statusFilter.has(c.status ?? 'none'))
        .filter((c) => connected === undefined || isConnected(c.handle) === connected)
        .sort((a, b) => a.handle.localeCompare(b.handle));
      const size = limit ?? 100;
      const from = offset ?? 0;
      const page = matched.slice(from, from + size).map(summary);
      return ok({
        total: matched.length,
        ...pageFields(matched.length, from, size, page.length),
        cards: page,
      });
    }),
  );

  server.registerTool(
    'search',
    {
      annotations: { readOnlyHint: true },
      description:
        'Scored full-text search over handles, names, kinds/types, bodies, appended notes, and the frontmatter that describes or binds a card (summary, path, code_refs) — so a source path like "src/core/stale.ts" finds the card bound to it. Matching is AND: every significant word in the query must appear on the card (common words are ignored); wrap a phrase in double quotes to match it whole. If no card matches every word, the same words retry as OR — ranked by how many each card matched, flagged relaxed: true with unmatched_terms (words no card in the plan carries) — so an over-specified query lands on the neighborhood, not a bare zero. Results are paged in ranked order: total_hits is the full count, and the response reports offset/limit/returned plus more:true and the exact offset to pass for the next page (default page 20). Set connected: "full" to hydrate each match with the complete content of its connected cards — fuzzy query to working context in one call; hydration is shared across matches, so a card shared by two matches is spelled out once and then referenced by handle (hydrated_elsewhere: true), under the caps reported in hydration_budget.',
      inputSchema: {
        q: z.string(),
        types: z.array(typeSchema).optional(),
        limit: z.number().int().min(1).max(100).optional().describe('page size (default 20)'),
        offset: offsetSchema.describe(
          'skip this many RANKED hits before the page (default 0)',
        ),
        connected: detailSchema.optional().describe('default: none'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { q, types, limit, offset, connected }) => {
      const index = await loadPlan(root);
      // Rank once, page into the ranked order — offset never reshuffles a result.
      // AND that matched nothing comes back relaxed to OR rather than empty.
      const { hits: ranked, needles, relaxed, unmatched } = searchPlan(index, q, types);
      const size = limit ?? 20;
      const from = offset ?? 0;
      const hits = ranked.slice(from, from + size);
      // One hydrator across every match: neighborhoods overlap heavily, and a
      // card's body is worth paying for once per response, not once per hit.
      const hydrator = new Hydrator();
      const result: Record<string, unknown> = {
        total_hits: ranked.length,
        ...pageFields(ranked.length, from, size, hits.length),
        matches: hits.map((hit) => ({
          card: summary(hit.card),
          score: hit.score,
          excerpt: hit.excerpt,
          connected_cards: connectedCards(index, hit.card.handle, connected ?? 'none', {
            hydrator,
          }),
        })),
      };
      const hydration = hydrator.report();
      if (hydration) result.hydration_budget = hydration;
      // Matching is AND, so a long natural-language query can match nothing. Say
      // what happened rather than letting a zero read as "the plan has nothing on
      // this" — the relaxed page IS the answer to "what did you actually mean?".
      if (relaxed) {
        result.relaxed = true;
        if (unmatched.length > 0) result.unmatched_terms = unmatched;
        result.note =
          ranked.length > 0
            ? `No card matched all of: ${needles.join(', ')} — relaxed to ANY word, ranked by how many each card matched.${unmatched.length > 0 ? ` No card mentions: ${unmatched.join(', ')} — drop those words.` : ''}`
            : `No card matched any of: ${needles.join(', ')}. Nothing in the plan uses these words — try a broader term.`;
      } else if (ranked.length === 0 && needles.length > 0) {
        result.note = `No card matched: ${needles.join(', ')}. Try a broader term, or drop the quotes to match words separately.`;
      }
      return ok(result);
    }),
  );

  server.registerTool(
    'traverse',
    {
      annotations: { readOnlyHint: true },
      description:
        'Breadth-first walk of the connection graph from one or more starting handles. Seed it with diff_plan output for impact analysis. Connections come from frontmatter only (the connections: list and handle-shaped field values), so the walk travels declared relationships; a [[link]] or mermaid node ID is a hyperlink, not an edge, and is never walked. detail: "full" includes frontmatter and body of every reached card, deduped and capped: each card is spelled out at most once, DIAGRAM cards and PLAN-PROJECT are never hydrated as neighbors, and anything past the budget degrades to a summary (degraded_to_summary, see hydration_budget) rather than being truncated. status filters the RESULT only — the walk still passes through non-matching cards, so a built hub never hides the planned work behind it (status: ["planned", "building", "none"] = open work in this neighborhood). types, by contrast, prunes the walk itself.',
      inputSchema: {
        start: z.union([z.string(), z.array(z.string()).min(1)]),
        depth: z.number().int().min(0).max(5).optional().describe('default: 2'),
        types: z.array(typeSchema).optional(),
        status: statusesSchema.describe(
          'post-filter on returned cards; "none" = no status set. The walk passes through non-matching cards.',
        ),
        detail: z.enum(['summary', 'full']).optional().describe('default: summary'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { start, depth, types, status, detail }) => {
      const index = await loadPlan(root);
      const starts = (Array.isArray(start) ? start : [start]).map((s) =>
        s.toUpperCase(),
      );
      const missing = starts.filter((s) => !index.cards.has(s));
      if (missing.length === starts.length) {
        return fail('NOT_FOUND', `No cards found for: ${missing.join(', ')}`);
      }
      const typeFilter = types && types.length > 0 ? new Set(types) : null;
      const maxDepth = depth ?? 2;

      const distance = new Map<string, number>();
      let frontier = starts.filter((s) => index.cards.has(s));
      for (const s of frontier) distance.set(s, 0);
      for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
        const next: string[] = [];
        for (const handle of frontier) {
          for (const neighbor of neighborsOf(index, handle)) {
            if (distance.has(neighbor)) continue;
            const card = index.cards.get(neighbor);
            if (!card) continue;
            if (typeFilter && !typeFilter.has(card.type)) continue;
            distance.set(neighbor, d);
            next.push(neighbor);
          }
        }
        frontier = next;
      }

      // Status is a post-filter: the walk above passed THROUGH every card, so
      // a built hub in the middle never hides open work behind it.
      const statusFilter = statusSetOf(status);
      // BFS insertion order, so the nearest cards claim the hydration budget first.
      const hydrator = new Hydrator();
      const cards = [...distance.entries()]
        .filter(
          ([handle]) =>
            !statusFilter ||
            statusFilter.has(index.cards.get(handle)!.status ?? 'none'),
        )
        .map(([handle, dist]) => {
          const card = index.cards.get(handle)!;
          // The starting cards were asked for by name — they are never degraded.
          const view =
            detail === 'full'
              ? dist === 0
                ? hydrator.primary(card)
                : hydrator.view(card, 'full')!
              : summary(card);
          return { ...view, distance: dist } as CardView & {
            handle: string;
            distance: number;
          };
        })
        .sort((a, b) => a.distance - b.distance || a.handle.localeCompare(b.handle));
      const surviving = new Set(cards.map((c) => c.handle));
      const connections = index.connections.filter(
        (c) => surviving.has(c.a) && surviving.has(c.b),
      );
      const result: Record<string, unknown> = {
        cards,
        connections,
        not_found: missing,
      };
      const hydration = hydrator.report();
      if (hydration) result.hydration_budget = hydration;
      return ok(result);
    }),
  );

  server.registerTool(
    'assemble',
    {
      annotations: { readOnlyHint: true },
      description:
        'Turn a set of cards (or the plan delta since a base) into a work INDEX for orchestration: the seeds split into FILE-DISJOINT units you can hand one sub-agent each with no risk of two agents editing the same file, the code each seed is bound to, a heuristic build order (data → contracts → surfaces), and a deduped summary list of the surrounding neighbors. Omit handles to assemble everything changed since base (default: the sync marker). This is the orchestration bridge: diff_plan + traverse + code binding in one call. hydration defaults to "index" — NO card bodies: read the index, then pull the 3–5 cards a unit actually needs with get_card (connected: "full"). hydration: "full" also spells out each seed and its DIRECT connections, deduped (a card appears in full once per response, later mentions are summaries with hydrated_elsewhere: true) and capped (DIAGRAM cards and PLAN-PROJECT never hydrate as neighbors; anything past the budget degrades to a summary — see hydration_budget), plus the newest 5 notes per card (notes_limit: 0 = all). depth controls only the WALK — which handles appear in reached_handles, neighbors and suggested_order. It never widens what gets spelled out: full mode serializes each seed plus its direct connections, and units/files are computed from the seeds alone. The walk travels the connection graph, which comes from frontmatter only (the connections: list and handle-shaped field values) — [[links]] and mermaid IDs are hyperlinks, not edges.',
      inputSchema: {
        handles: z
          .array(z.string())
          .optional()
          .describe('seed handles; omit to use the plan delta since base'),
        base: z
          .string()
          .optional()
          .describe('base for the delta when handles is omitted (default: sync marker)'),
        depth: z
          .number()
          .int()
          .min(0)
          .max(3)
          .optional()
          .describe(
            'how far the walk goes around each seed — sets reached_handles / neighbors / suggested_order only (default: 1)',
          ),
        hydration: z
          .enum(['index', 'full'])
          .optional()
          .describe('index (default) = no card bodies; full = seeds + direct connections, deduped and capped'),
        code: codeModeSchema.optional().describe('attach bound code per SEED card (default: paths)'),
        notes_limit: z
          .number()
          .int()
          .min(0)
          .max(500)
          .optional()
          .describe('most recent N notes per card (default 5; 0 = all)'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { handles, base, depth, code, notes_limit, hydration }) => {
      const index = await loadPlan(root);
      const hydrationMode = hydration ?? 'index';

      let seeds: string[];
      let notFound: string[] = [];
      let delta: { base: string; base_source: string } | null = null;
      if (handles && handles.length > 0) {
        const requested = [...new Set(handles.map((h) => h.toUpperCase()))];
        seeds = requested.filter((h) => index.cards.has(h));
        notFound = requested.filter((h) => !index.cards.has(h));
      } else {
        let diff;
        try {
          diff = await diffPlan(root, base);
        } catch (err) {
          return fail(
            'BAD_BASE',
            `Could not diff against base ${base ?? '(marker/HEAD)'}: ${err instanceof Error ? err.message : String(err)}. Pass a reachable base sha, or omit it to use the sync marker.`,
          );
        }
        delta = { base: diff.base, base_source: diff.base_source };
        seeds = [...new Set(diff.changes.map((c) => c.handle))].filter((h) =>
          index.cards.has(h),
        );
      }
      if (seeds.length === 0) {
        return ok({
          hydration: hydrationMode,
          base: delta,
          seeds: [],
          not_found: notFound,
          units: [],
          note: handles
            ? 'None of the given handles exist in the plan.'
            : 'No plan changes since base — nothing to assemble.',
        });
      }

      // The walk answers "what else is in scope" — reached_handles, neighbors and
      // suggested_order. It never decides what gets SERIALIZED: full mode spells
      // out each seed plus its direct connections, whatever depth says.
      const maxDepth = depth ?? 1;
      const distance = new Map<string, number>();
      let frontier = seeds;
      for (const s of seeds) distance.set(s, 0);
      for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
        const next: string[] = [];
        for (const h of frontier) {
          for (const n of neighborsOf(index, h)) {
            if (distance.has(n) || !index.cards.has(n)) continue;
            distance.set(n, d);
            next.push(n);
          }
        }
        frontier = next;
      }
      const reached = [...distance.keys()];

      const codeMode = code ?? 'paths';
      const filesBy = new Map<string, string[]>();
      for (const s of seeds) {
        filesBy.set(
          s,
          boundPathsForCard(index, index.cards.get(s)!).map((b) => b.path),
        );
      }
      const partitions = partitionByFiles(seeds, filesBy);

      const suggestedOrder = [...reached].sort(
        (a, b) =>
          tierOf(index.cards.get(a)!.type) - tierOf(index.cards.get(b)!.type) ||
          a.localeCompare(b),
      );

      const tail = notes_limit ?? DEFAULT_NOTES_TAIL;
      const hydrator = new Hydrator(tail);
      // Seeds claim their full content first, so a seed is never reduced to a
      // back-reference because an earlier unit's neighborhood happened to reach it.
      const seedViews = new Map<string, CardView>();
      if (hydrationMode === 'full') {
        for (const part of partitions) {
          for (const h of part.handles) {
            seedViews.set(h, hydrator.primary(index.cards.get(h)!));
          }
        }
      }

      // Resolved once for the whole assembly — resolveCodeForCard otherwise
      // re-reads PLAN-PROJECT for every seed card.
      let codeRoot: string | null = null;
      if (codeMode !== 'none') {
        try {
          codeRoot = await codeRootFor(await realpath(root));
        } catch {
          codeRoot = null;
        }
      }
      const units = [];
      for (const part of partitions) {
        const cards = [];
        for (const h of part.handles) {
          const card = index.cards.get(h)!;
          const entry: Record<string, unknown> =
            hydrationMode === 'full'
              ? {
                  ...seedViews.get(h)!,
                  connected_cards: connectedCards(index, h, 'full', { hydrator }),
                }
              : { ...summary(card) };
          if (codeMode !== 'none') {
            entry.code = await resolveCodeForCard(root, index, card, codeMode, {
              codeRoot,
            });
          }
          cards.push(entry);
        }
        units.push({ handles: part.handles, files: part.files, cards });
      }

      const seedSet = new Set(seeds);
      const result: Record<string, unknown> = {
        hydration: hydrationMode,
        base: delta,
        seeds,
        not_found: notFound,
        reached_handles: reached,
        suggested_order: suggestedOrder,
        units,
        fanout: {
          unit_count: units.length,
          note:
            units.length > 1
              ? `${units.length} file-disjoint units — assign one sub-agent each; no two share a bound file. Still assign each card to exactly one agent.`
              : 'One unit — the seeds share bound files (or have none); do not split across agents.',
        },
      };
      if (hydrationMode === 'index') {
        // The neighborhood as an index: who is nearby, deduped, no bodies.
        result.neighbors = reached
          .filter((h) => !seedSet.has(h))
          .sort()
          .map((h) => summary(index.cards.get(h)!));
        result.next =
          'Index only — no card bodies. Fetch the few cards a unit actually needs with get_card (connected: "full"), or re-run with hydration: "full".';
      }
      const hydrationReport = hydrator.report();
      if (hydrationReport) result.hydration_budget = hydrationReport;
      return ok(result);
    }),
  );

  server.registerTool(
    'describe_type',
    {
      annotations: { readOnlyHint: true },
      description:
        'The card-type reference, served straight from this package. Call with no args for the catalog — all 21 types with their prefix, folder, and one-line purpose. Call with a type for everything needed to author one: the frontmatter JSON Schema (fields, which are required, descriptions) plus the golden example and authoring guidance. Use it before writing a card of a type you have not authored this session — it is the contract create_card/create_cards/update_card validate against (W002/W003), so you do not need the authoring skill loaded to get the fields right.',
      inputSchema: {
        type: typeSchema.optional().describe('omit for the full catalog'),
      },
    },
    async ({ type }: { type?: TypeName }) => {
      if (!type) {
        const types = await Promise.all(
          TYPE_NAMES.map(async (t) => {
            const folder = TYPE_FOLDERS[t];
            return {
              type: t,
              prefix: `${t}-`,
              folder,
              purpose: schemaPurpose(await readTypeSchema(folder)),
            };
          }),
        );
        return ok({ types });
      }
      const folder = TYPE_FOLDERS[type];
      const [schema, reference] = await Promise.all([
        readTypeSchema(folder),
        readTypeDoc(folder),
      ]);
      return ok({
        type,
        prefix: `${type}-`,
        folder,
        reserved: ['name', 'kind', 'status', 'connections'],
        schema,
        reference,
      });
    },
  );

  server.registerTool(
    'create_card',
    {
      description:
        'Create a new card. The handle determines type and file location. fields = type-specific frontmatter — call describe_type(type) first for its field schema and a golden example; body = markdown. The card IS created even when issues are returned — issues are the current lint state, not a failure. Set validate:false to skip linting during bulk import (then run check_integrity once at the end). For many cards at once, prefer create_cards.',
      inputSchema: {
        handle: z.string(),
        name: z.string().optional(),
        kind: z.string().optional(),
        status: statusSchema.optional(),
        connections: z.array(z.string()).optional(),
        fields: z.record(z.string(), z.unknown()).optional(),
        body: z.string().optional(),
        validate: z
          .boolean()
          .optional()
          .describe('default true; false skips lint and returns no issues'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, args) => {
      const handle = args.handle.toUpperCase();
      if (!isHandleShaped(handle) || !typeForHandle(handle)) {
        return fail(
          'INVALID_HANDLE',
          `${args.handle} is not a valid handle (uppercase PREFIX-NAME with a canonical prefix)`,
        );
      }
      const index = await loadPlan(root);
      if (index.cards.has(handle)) {
        return fail('CARD_EXISTS', `${handle} already exists`);
      }
      const badConnections = (args.connections ?? []).filter(
        (c) => !isKnownHandle(c.toUpperCase()),
      );
      if (badConnections.length > 0) {
        return fail(
          'INVALID_CONNECTION',
          `Not valid handles: ${badConnections.join(', ')}`,
        );
      }
      const reserved = reservedFieldKeys(args.fields);
      if (reserved.length > 0) {
        return fail(
          'INVALID_FIELDS',
          `fields cannot contain reserved keys: ${reserved.join(', ')}`,
        );
      }

      const fm: Record<string, unknown> = {};
      if (args.name !== undefined) fm.name = args.name;
      if (args.kind !== undefined) fm.kind = args.kind;
      if (args.status !== undefined) fm.status = args.status;
      Object.assign(fm, args.fields ?? {});
      if (args.connections && args.connections.length > 0) {
        fm.connections = args.connections.map((c) => c.toUpperCase());
      }

      const relPath = await createCardFile(root, handle, fm, args.body ?? '');
      if (args.validate === false) {
        const written = await loadPlan(root);
        const card = written.cards.get(handle);
        return ok({ card: card ? full(card) : null, file: relPath });
      }
      const lint = await lintPlan(root);
      const card = lint.index.cards.get(handle);
      return ok({
        card: card ? full(card) : null,
        file: relPath,
        issues: issuesForFile(lint.issues, relPath),
      });
    }),
  );

  server.registerTool(
    'create_cards',
    {
      description:
        'Create many cards in one call (migrations, large scaffolds). Validates every handle up front, writes all valid cards, then lints ONCE — so connections between cards in the same batch resolve without transient "does not resolve" errors. Cards are created even if issues are returned. Returns { created, failed, cards, issues }.',
      inputSchema: {
        cards: z
          .array(
            z.object({
              handle: z.string(),
              name: z.string().optional(),
              kind: z.string().optional(),
              status: statusSchema.optional(),
              connections: z.array(z.string()).optional(),
              fields: z.record(z.string(), z.unknown()).optional(),
              body: z.string().optional(),
            }),
          )
          .min(1)
          .max(500),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { cards }) => {
      const index = await loadPlan(root);
      const existing = new Set(index.cards.keys());
      const created: string[] = [];
      const failed: Array<{ handle: string; error: string }> = [];

      for (const spec of cards) {
        const handle = spec.handle.toUpperCase();
        if (!isHandleShaped(handle) || !typeForHandle(handle)) {
          failed.push({ handle: spec.handle, error: 'INVALID_HANDLE' });
          continue;
        }
        if (existing.has(handle)) {
          failed.push({ handle, error: 'CARD_EXISTS' });
          continue;
        }
        const badConns = (spec.connections ?? []).filter(
          (c) => !isKnownHandle(c.toUpperCase()),
        );
        if (badConns.length > 0) {
          failed.push({ handle, error: `INVALID_CONNECTION: ${badConns.join(', ')}` });
          continue;
        }
        const reserved = reservedFieldKeys(spec.fields);
        if (reserved.length > 0) {
          failed.push({
            handle,
            error: `INVALID_FIELDS: fields cannot contain reserved keys: ${reserved.join(', ')}`,
          });
          continue;
        }

        const fm: Record<string, unknown> = {};
        if (spec.name !== undefined) fm.name = spec.name;
        if (spec.kind !== undefined) fm.kind = spec.kind;
        if (spec.status !== undefined) fm.status = spec.status;
        Object.assign(fm, spec.fields ?? {});
        if (spec.connections && spec.connections.length > 0) {
          fm.connections = spec.connections.map((c) => c.toUpperCase());
        }
        try {
          await createCardFile(root, handle, fm, spec.body ?? '');
          existing.add(handle);
          created.push(handle);
        } catch (err) {
          failed.push({ handle, error: writeFailed(err) });
        }
      }

      const lint = await lintPlan(root);
      const createdFiles = new Set(created.map((h) => relPathForHandle(h)));
      const createdSet = new Set(created);
      return ok({
        created: created.length,
        failed,
        cards: [...lint.index.cards.values()]
          .filter((c) => createdSet.has(c.handle))
          .map(summary),
        issues: lint.issues.filter((i) => createdFiles.has(i.file)),
      });
    }),
  );

  server.registerTool(
    'add_connections',
    {
      description:
        'Add many connections in one call. Each {from,to} is appended to the source card’s connections list (idempotent and undirected — already-connected pairs are skipped). Lints once at the end. Returns { added, failed, errors }.',
      inputSchema: {
        connections: z
          .array(z.object({ from: z.string(), to: z.string() }))
          .min(1)
          .max(1000),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { connections }) => {
      const index = await loadPlan(root);
      const failed: Array<{ from: string; to: string; error: string }> = [];
      const additions = new Map<string, Set<string>>();
      const queuedPairs = new Set<string>();

      for (const { from, to } of connections) {
        const f = from.toUpperCase();
        const t = to.toUpperCase();
        const fromCard = index.cards.get(f);
        const toCard = index.cards.get(t);
        if (!fromCard || !toCard) {
          failed.push({ from, to, error: `NOT_FOUND: ${!fromCard ? from : to}` });
          continue;
        }
        if (f === t) continue;
        const pair = f < t ? `${f}|${t}` : `${t}|${f}`;
        if (index.connectedHandles.get(f)?.has(t) || queuedPairs.has(pair)) continue;
        queuedPairs.add(pair);
        if (!additions.has(f)) additions.set(f, new Set());
        additions.get(f)!.add(t);
      }

      let added = 0;
      const touched = new Set<string>();
      for (const [src, targets] of additions) {
        const card = index.cards.get(src)!;
        // Merge against the file's CURRENT list inside the lock, not the index
        // snapshot — a concurrent write must not be clobbered.
        await mutateCardFile(card.filePath, (current) => {
          const existingList = Array.isArray(current.frontmatter.connections)
            ? current.frontmatter.connections.filter(
                (c): c is string => typeof c === 'string',
              )
            : [];
          const merged = [...new Set([...existingList, ...targets])];
          return {
            frontmatter: applyCardPatch(current.frontmatter, { connections: merged }),
          };
        });
        touched.add(card.relPath);
        added += targets.size;
      }

      const lint = await lintPlan(root);
      return ok({ added, failed, issues: lint.issues.filter((i) => touched.has(i.file)) });
    }),
  );

  server.registerTool(
    'update_card',
    {
      description:
        'Update a card. patch.name/kind/status set or delete (null); patch.connections replaces the list; patch.fields deep-merges into type-specific frontmatter (arrays replace, null deletes). body replaces the whole body. Body-only updates never reformat frontmatter.',
      inputSchema: {
        handle: z.string(),
        patch: z
          .object({
            name: z.string().nullable().optional(),
            kind: z.string().nullable().optional(),
            status: statusSchema.nullable().optional(),
            connections: z.array(z.string()).nullable().optional(),
            fields: z.record(z.string(), z.unknown()).optional(),
          })
          .optional(),
        body: z.string().optional(),
        if_mtime: z
          .number()
          .optional()
          .describe(
            'optional stale-write guard: current rounded file mtime from a client-side stat or viewer payload',
          ),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { handle, patch, body, if_mtime }) => {
      const index = await loadPlan(root);
      const card = index.cards.get(handle.toUpperCase());
      if (!card) return fail('NOT_FOUND', `No card with handle ${handle}`);
      if (!patch && body === undefined) {
        return fail('EMPTY_UPDATE', 'Provide patch and/or body');
      }
      const reserved = reservedFieldKeys(patch?.fields);
      if (reserved.length > 0) {
        return fail(
          'INVALID_FIELDS',
          `fields cannot contain reserved keys: ${reserved.join(', ')}`,
        );
      }
      if (typeof if_mtime === 'number' && if_mtime !== 0) {
        const current = Math.round((await stat(card.filePath)).mtimeMs);
        if (current !== if_mtime) {
          return fail('STALE', `${card.handle} changed on disk`);
        }
      }

      // Apply the patch to the file's CURRENT frontmatter inside the lock —
      // patch semantics compose with a concurrent write instead of undoing it.
      await mutateCardFile(card.filePath, (current) => ({
        frontmatter: patch ? applyCardPatch(current.frontmatter, patch) : undefined,
        body,
      }));
      const lint = await lintPlan(root);
      const updated = lint.index.cards.get(card.handle);
      return ok({
        card: updated ? full(updated) : null,
        issues: issuesForFile(lint.issues, card.relPath),
      });
    }),
  );

  server.registerTool(
    'append_note',
    {
      description:
        'Append one typed note to a card\'s memory — append-only, NO full-body rewrite (cheap, so the honest path stays the cheap path). kind: decision (a choice + why) | gotcha (a non-obvious trap) | state (current built/live reality) | deviation (where code intentionally differs from the card) | verified (a verification note). Capture what the code can\'t say; do NOT paste code/DDL/signatures that live in the repo — link to them. Notes are queryable by kind (get_card notes_kind) and ordered newest-last.',
      inputSchema: {
        handle: z.string(),
        kind: noteKindSchema,
        text: z.string().min(1).max(4000),
        sha: z
          .string()
          .optional()
          .describe('optional git sha this note was recorded against'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { handle, kind, text, sha }) => {
      const index = await loadPlan(root);
      const card = index.cards.get(handle.toUpperCase());
      if (!card) return fail('NOT_FOUND', `No card with handle ${handle}`);
      const note: CardNote = { kind, text };
      if (sha) note.sha = sha;
      // Append to the CURRENT notes list inside the lock so two concurrent
      // appends both land — the memory tool must never lose a note.
      await mutateCardFile(card.filePath, (current) => ({
        frontmatter: withAppendedNote(current.frontmatter, note),
      }));
      const lint = await lintPlan(root);
      const updated = lint.index.cards.get(card.handle);
      return ok({
        card: updated ? full(updated) : null,
        note_count: Array.isArray(updated?.frontmatter.notes)
          ? updated!.frontmatter.notes.length
          : 0,
        issues: issuesForFile(lint.issues, card.relPath),
      });
    }),
  );

  server.registerTool(
    'list_notes',
    {
      annotations: { readOnlyHint: true },
      description:
        'All typed notes across the plan (the memory recorded via append_note), in handle order and newest-last within each card. Filter by kind — "show me every gotcha" / "every decision" in one call — and/or by handles. Paged: total is every matching note, and the response reports offset/limit/returned plus more:true and the exact offset to pass for the rest (default page 50, max 500). The cross-card view of the plan\'s memory; for one card\'s notes use get_card notes_kind/notes_limit.',
      inputSchema: {
        kind: noteKindSchema.optional().describe('return only notes of this kind'),
        handles: z
          .array(z.string())
          .optional()
          .describe('restrict to these cards; omit for the whole plan'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('page size (default 50)'),
        offset: offsetSchema,
        repo: repoSchema,
      },
    },
    withPlan(async (root, { kind, handles, limit, offset }) => {
      const index = await loadPlan(root);
      const wanted =
        handles && handles.length > 0
          ? new Set(handles.map((h) => h.toUpperCase()))
          : null;
      const notes: Array<{ handle: string; kind: string; text: string; sha?: string }> =
        [];
      const sorted = [...index.cards.values()].sort((a, b) =>
        a.handle.localeCompare(b.handle),
      );
      for (const card of sorted) {
        if (wanted && !wanted.has(card.handle)) continue;
        const list = Array.isArray(card.frontmatter.notes)
          ? card.frontmatter.notes
          : [];
        for (const n of list) {
          if (!n || typeof n !== 'object') continue;
          const note = n as Record<string, unknown>;
          if (typeof note.text !== 'string') continue;
          const noteKind = typeof note.kind === 'string' ? note.kind : 'note';
          if (kind && noteKind !== kind) continue;
          notes.push({
            handle: card.handle,
            kind: noteKind,
            text: note.text,
            ...(typeof note.sha === 'string' ? { sha: note.sha } : {}),
          });
        }
      }
      const size = limit ?? 50;
      const from = offset ?? 0;
      const page = notes.slice(from, from + size);
      return ok({
        total: notes.length,
        ...pageFields(notes.length, from, size, page.length),
        notes: page,
      });
    }),
  );

  server.registerTool(
    'edit_section',
    {
      description:
        'Replace the content under one markdown heading in a card\'s body, keeping every other section byte-for-byte — a cheap, surgical alternative to rewriting the whole body. Match the heading by its text (case-insensitive, no #). Errors if no such heading exists (use update_card to set the whole body or add a section).',
      inputSchema: {
        handle: z.string(),
        section: z
          .string()
          .describe('heading text to replace under, e.g. "Notes" or "Current state"'),
        text: z.string().describe('new markdown content for that section (heading kept)'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { handle, section, text }) => {
      const index = await loadPlan(root);
      const card = index.cards.get(handle.toUpperCase());
      if (!card) return fail('NOT_FOUND', `No card with handle ${handle}`);
      // Replace against the CURRENT body inside the lock — concurrent edits to
      // different sections compose instead of the later one clobbering.
      let failure: ToolResult | null = null;
      await mutateCardFile(card.filePath, (current) => {
        const body = replaceBodySection(current.body, section, text);
        if (body === null) {
          const headings = bodyHeadingTexts(current.body);
          const target = section.trim().replace(/^#+\s*/, '').toLowerCase();
          const matchCount = headings.filter((h) => h.toLowerCase() === target).length;
          failure =
            matchCount > 1
              ? fail(
                  'AMBIGUOUS_SECTION',
                  `${card.handle} has ${matchCount} headings called "${section}"; edit_section can't tell them apart. Use update_card to set the whole body.`,
                )
              : fail(
                  'SECTION_NOT_FOUND',
                  `No heading "${section}" in ${card.handle}. Headings present: ${headings.length ? headings.join(', ') : '(none)'}. Use update_card to set the whole body or add the section.`,
                );
          return null;
        }
        return { body };
      });
      if (failure) return failure;
      const lint = await lintPlan(root);
      const updated = lint.index.cards.get(card.handle);
      return ok({
        card: updated ? full(updated) : null,
        issues: issuesForFile(lint.issues, card.relPath),
      });
    }),
  );

  server.registerTool(
    'set_verified',
    {
      description:
        'Mark one card (handle) or many (handles) verified against the real code: stamp verified_sha (the git sha you checked it at, default HEAD) + verified_at, set status to verified, and optionally append a verified note. The verified_sha is the BASELINE for code-side drift (stale_report / check_sync): later, if the card\'s bound code changed since this sha, the claim is flagged for re-verification. This is durability, not distrust — verify only against code you actually checked. A re-verification sweep belongs in ONE handles call — one sha resolution, one dirty check, one lint — returning { verified, failed, cards, issues }; unknown handles land in failed rather than failing the batch.',
      inputSchema: {
        handle: z.string().optional().describe('one card; exactly one of handle / handles'),
        handles: z
          .array(z.string())
          .min(1)
          .max(500)
          .optional()
          .describe(
            'verify many cards in one call (one sha resolve, one lint pass); exactly one of handle / handles',
          ),
        sha: z
          .string()
          .optional()
          .describe('git sha verified against (default: current HEAD)'),
        note: z
          .string()
          .optional()
          .describe('optional verification note appended to the card'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { handle, handles, sha, note }) => {
      if ((handle === undefined) === (handles === undefined)) {
        return fail(
          'INVALID_INPUT',
          'Pass exactly one of handle (one card) or handles (a batch).',
        );
      }
      const batch = handles !== undefined;
      const index = await loadPlan(root);
      // Unknown handles are reported per item (create_cards' convention), never
      // a failed batch — one typo must not cost a 50-card sweep.
      const targets: Card[] = [];
      const failed: Array<{ handle: string; error: string }> = [];
      const seen = new Set<string>();
      for (const requested of handles ?? [handle!]) {
        const key = requested.toUpperCase();
        // Dedupe BEFORE the lookup, so a repeated typo reports once — the same
        // way a repeated real handle is verified once.
        if (seen.has(key)) continue;
        seen.add(key);
        const found = index.cards.get(key);
        if (!found) {
          failed.push({ handle: requested, error: 'NOT_FOUND' });
          continue;
        }
        targets.push(found);
      }
      if (!batch && targets.length === 0) {
        return fail('NOT_FOUND', `No card with handle ${handle}`);
      }
      const warnings: string[] = [];
      let resolvedSha = sha;
      if (resolvedSha) {
        // Normalize to the full commit sha; a typo'd baseline would otherwise
        // surface only later, as an unreachable baseline in stale_report.
        try {
          resolvedSha = await resolveCommit(root, resolvedSha);
        } catch {
          warnings.push(
            `sha ${resolvedSha} does not resolve to a commit in this repo; stamped as given — stale_report will report this card's baseline as unreachable until it does.`,
          );
        }
      } else {
        try {
          resolvedSha = await headSha(root);
        } catch {
          warnings.push(
            'Not a git repo (or no commits): stamped verified_at + status only. Drift detection needs a verified_sha baseline — pass sha or commit first.',
          );
        }
      }
      // A verified_sha is a claim about COMMITTED code. Uncommitted edits to the
      // bound files are not covered by it — mirror set_sync_point's dirty warning.
      // One git call over the UNION of every target's bound paths, attributed back.
      const dirtyByCard = new Map<string, string[]>();
      if (resolvedSha && targets.length > 0) {
        try {
          const boundByCard = new Map(
            targets.map((c) => [c.handle, boundPathsForCard(index, c).map((b) => b.path)]),
          );
          const allBound = [...new Set([...boundByCard.values()].flat())];
          if (allBound.length > 0) {
            const { prefix } = await planRootsFor(root);
            const gitBound = allBound.map((p) => (prefix ? `${prefix}/${p}` : p));
            const dirty = await changedFilesSince(root, 'HEAD', gitBound);
            const changed = [...dirty].map((p) =>
              prefix && p.startsWith(`${prefix}/`) ? p.slice(prefix.length + 1) : p,
            );
            for (const [h, bound] of boundByCard) {
              const dirtyBound = changed.filter((c) =>
                bound.some((p) => boundPathsOverlap(p, c)),
              );
              if (dirtyBound.length > 0) dirtyByCard.set(h, dirtyBound);
            }
          }
        } catch {
          // Best-effort: no git repo or nothing bound — nothing to warn about.
        }
      }
      if (dirtyByCard.size > 0) {
        const detail = batch
          ? [...dirtyByCard].map(([h, files]) => `${h}: ${files.join(', ')}`).join('; ')
          : [...dirtyByCard.values()][0].join(', ');
        warnings.push(
          `Bound file(s) have uncommitted changes the baseline does not include: ${detail}. Commit first, then set_verified.`,
        );
      }
      const verifiedAt = new Date().toISOString();
      const fields: Record<string, unknown> = { verified_at: verifiedAt };
      if (resolvedSha) fields.verified_sha = resolvedSha;
      const verified = new Set<string>();
      const touched = new Set<string>();
      for (const card of targets) {
        try {
          await mutateCardFile(card.filePath, (current) => {
            let frontmatter = applyCardPatch(current.frontmatter, {
              status: 'verified',
              fields,
            });
            if (note) {
              const n: CardNote = { kind: 'verified', text: note };
              if (resolvedSha) n.sha = resolvedSha;
              frontmatter = withAppendedNote(frontmatter, n);
            }
            return { frontmatter };
          });
          verified.add(card.handle);
          touched.add(card.relPath);
        } catch (err) {
          // One bad file must not abandon the rest of a sweep; a single-handle
          // call keeps today's behaviour and surfaces the failure as an error.
          if (!batch) throw err;
          // Coded like every other failed row (NOT_FOUND, CARD_EXISTS): the
          // caller branches on the code, the raw message stays for diagnosis.
          failed.push({ handle: card.handle, error: writeFailed(err) });
        }
      }
      // ONE lint for the whole call — the whole point of the batch.
      const lint = await lintPlan(root);
      const warning = warnings.length > 0 ? warnings.join(' ') : undefined;
      if (!batch) {
        const card = targets[0];
        const updated = lint.index.cards.get(card.handle);
        return ok({
          card: updated ? full(updated) : null,
          verified_sha: resolvedSha ?? null,
          verified_at: verifiedAt,
          warning,
          issues: issuesForFile(lint.issues, card.relPath),
        });
      }
      return ok({
        verified: verified.size,
        failed,
        cards: [...lint.index.cards.values()]
          .filter((c) => verified.has(c.handle))
          .map(summary),
        verified_sha: resolvedSha ?? null,
        verified_at: verifiedAt,
        warning,
        issues: lint.issues.filter((i) => touched.has(i.file)),
      });
    }),
  );

  server.registerTool(
    'delete_card',
    {
      description:
        'Delete a card file. Returns the handles that referenced it (their references are now dangling) plus resulting lint issues.',
      inputSchema: { handle: z.string(), repo: repoSchema },
    },
    withPlan(async (root, { handle }) => {
      const index = await loadPlan(root);
      const card = index.cards.get(handle.toUpperCase());
      if (!card) return fail('NOT_FOUND', `No card with handle ${handle}`);
      if (card.handle === 'PLAN-PROJECT') {
        return fail(
          'INVALID_HANDLE',
          'PLAN-PROJECT (plan.md) is the plan root card and cannot be deleted.',
        );
      }
      const referencedBy = [...(index.connectedHandles.get(card.handle) ?? [])].sort();
      await rm(card.filePath);
      const lint = await lintPlan(root);
      // Exact-token match so deleting API-USER doesn't surface API-USERS' issues;
      // handles only contain [A-Z0-9-], so those chars delimit a whole handle.
      const handleToken = new RegExp(`(?<![A-Z0-9-])${card.handle}(?![A-Z0-9-])`);
      return ok({
        deleted: card.handle,
        referenced_by: referencedBy,
        issues: lint.issues.filter((i) => handleToken.test(i.message)),
      });
    }),
  );

  server.registerTool(
    'rename_card',
    {
      description:
        'Rename a card\'s handle and rewrite every reference to it across the plan — connections lists, handle-shaped frontmatter values, [[links]], mermaid nodes, and prose mentions (whole-token matches only; API-USER never touches API-USERS). The file moves to the new handle\'s path, so a cross-type rename (new prefix) also moves folders and the card\'s fields are then validated against the new type\'s schema. Returns the handles whose references were rewritten plus lint issues for every touched file.',
      inputSchema: { from: z.string(), to: z.string(), repo: repoSchema },
    },
    withPlan(async (root, args) => {
      let result;
      try {
        result = await renameCard(root, args.from, args.to);
      } catch (err) {
        if (err instanceof RenameCardError) return fail(err.code, err.message);
        throw err;
      }
      if (result.noop) {
        return ok({ renamed: null, note: 'from and to are the same handle — nothing to do.' });
      }
      const lint = await lintPlan(root);
      const touched = new Set([result.file]);
      for (const h of result.references_updated) {
        const rel = lint.index.cards.get(h)?.relPath;
        if (rel) touched.add(rel);
      }
      const renamed = lint.index.cards.get(result.to);
      return ok({
        renamed: { from: result.from, to: result.to },
        file: result.file,
        references_updated: result.references_updated,
        card: renamed ? full(renamed) : null,
        issues: lint.issues.filter((i) => touched.has(i.file)),
      });
    }),
  );

  server.registerTool(
    'add_connection',
    {
      description:
        'Connect two cards by appending `to` to `from`’s connections list. Connections are undirected, so declaring it on one side is enough; no-op if they are already connected (by either card’s connections list or a handle-shaped frontmatter value). A [[link]] between the two is a hyperlink, not a connection — promote it here if the graph should know about the relationship.',
      inputSchema: { from: z.string(), to: z.string(), repo: repoSchema },
    },
    withPlan(async (root, args) => {
      const index = await loadPlan(root);
      const from = index.cards.get(args.from.toUpperCase());
      const to = index.cards.get(args.to.toUpperCase());
      if (!from || !to) {
        return fail('NOT_FOUND', `No card: ${!from ? args.from : args.to}`);
      }
      if (index.connectedHandles.get(from.handle)?.has(to.handle)) {
        return ok({ already_connected: true, between: [from.handle, to.handle] });
      }
      await mutateCardFile(from.filePath, (current) => {
        const existing = Array.isArray(current.frontmatter.connections)
          ? current.frontmatter.connections.filter(
              (c): c is string => typeof c === 'string',
            )
          : [];
        if (existing.includes(to.handle)) return null; // raced: already added
        return {
          frontmatter: deepMerge(current.frontmatter, {
            connections: [...existing, to.handle],
          }),
        };
      });
      const lint = await lintPlan(root);
      return ok({
        connected: [from.handle, to.handle],
        declared_on: from.handle,
        issues: issuesForFile(lint.issues, from.relPath),
      });
    }),
  );

  server.registerTool(
    'remove_connection',
    {
      description:
        'Remove a connection by deleting it from either card’s connections list. Reports if the cards remain connected through a handle-shaped value in another frontmatter field, which must be edited manually. Body [[links]] and mermaid node IDs are hyperlinks, not connections, so they never keep two cards connected.',
      inputSchema: { a: z.string(), b: z.string(), repo: repoSchema },
    },
    withPlan(async (root, args) => {
      const index = await loadPlan(root);
      const cardA = index.cards.get(args.a.toUpperCase());
      const cardB = index.cards.get(args.b.toUpperCase());
      if (!cardA || !cardB) {
        return fail('NOT_FOUND', `No card: ${!cardA ? args.a : args.b}`);
      }

      const removedFrom: string[] = [];
      for (const [card, other] of [
        [cardA, cardB.handle],
        [cardB, cardA.handle],
      ] as const) {
        let removed = false;
        await mutateCardFile(card.filePath, (current) => {
          // Keep malformed (non-string) entries as-is — lint owns reporting them.
          const list = Array.isArray(current.frontmatter.connections)
            ? current.frontmatter.connections
            : [];
          if (!list.includes(other)) return null;
          removed = true;
          const next = list.filter((h) => h !== other);
          return {
            frontmatter: deepMerge(current.frontmatter, {
              connections: next.length > 0 ? next : null,
            }),
          };
        });
        if (removed) removedFrom.push(card.handle);
      }

      const lint = await lintPlan(root);
      const after = lint.index;
      const stillConnected =
        after.connectedHandles.get(cardA.handle)?.has(cardB.handle) ?? false;
      const remainingSources: string[] = [];
      if (stillConnected) {
        for (const [card, other] of [
          [after.cards.get(cardA.handle)!, cardB.handle],
          [after.cards.get(cardB.handle)!, cardA.handle],
        ] as const) {
          // Only frontmatter makes an edge — a [[link]] or mermaid node ID left
          // behind is a hyperlink, and never keeps two cards connected.
          if (card.refs.frontmatter.includes(other))
            remainingSources.push(`frontmatter field on ${card.handle}`);
        }
      }
      const touched = new Set(
        removedFrom
          .map((h) => after.cards.get(h)?.relPath)
          .filter((p): p is string => Boolean(p)),
      );
      return ok({
        removed_from: removedFrom,
        still_connected: stillConnected,
        remaining_sources: remainingSources,
        issues: lint.issues.filter((i) => touched.has(i.file)),
      });
    }),
  );

  server.registerTool(
    'list_connected_repos',
    {
      annotations: { readOnlyHint: true },
      description:
        'List the sibling repos declared on PLAN-PROJECT connected_repos, each with its path, description, and whether it is reachable on this machine. Use a name as the `repo` selector on other tools to read or write that repo. Repo-level links only — not card connections.',
      inputSchema: { repo: repoSchema },
    },
    withPlan(async (root) => {
      const repos = await listConnectedRepos(root);
      return ok({
        connected_repos: repos.map((r) => ({
          name: r.name,
          path: r.path,
          description: r.description ?? null,
          reachable: r.reachable,
        })),
      });
    }),
  );

  server.registerTool(
    'add_connected_repo',
    {
      description:
        'Declare a sibling repo on PLAN-PROJECT connected_repos (a repo-level link, not a card connection). name is the lowercase `repo` selector; path is relative to this repo root (e.g. ../pyramid-server). reciprocate:true also writes the reverse link into the target repo — only do this with the user’s OK, since it edits the other repo. Upserts by name.',
      inputSchema: {
        name: z
          .string()
          .describe('lowercase id used as the `repo` selector (e.g. pyramid-server)'),
        path: z
          .string()
          .describe('path to the connected repo root, relative to this repo (e.g. ../pyramid-server)'),
        description: z.string().optional(),
        reciprocate: z
          .boolean()
          .optional()
          .describe('also add the reverse link into the target repo (writes there). default false'),
        reverse_description: z
          .string()
          .optional()
          .describe('description for the reverse link when reciprocate is set; defaults to none'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, args) => {
      const { name, path: repoPath, description, reciprocate, reverse_description } = args;
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
        return fail(
          'INVALID_NAME',
          `"${name}" is not a valid repo name (lowercase letters, digits, and hyphens).`,
        );
      }
      const index = await loadPlan(root);
      const planCard = index.cards.get('PLAN-PROJECT');
      if (!planCard) {
        return fail(
          'NO_PLAN_PROJECT',
          'No plan.md (PLAN-PROJECT) at the plan root to record connected_repos on.',
        );
      }
      const entry: ConnectedRepo = { name, path: repoPath, description };
      let next: ConnectedRepo[] = [];
      await mutateCardFile(planCard.filePath, (current) => {
        next = upsertConnectedRepo(
          connectedReposFromFrontmatter(current.frontmatter),
          entry,
        );
        return {
          frontmatter: applyCardPatch(current.frontmatter, {
            fields: { connected_repos: next.map(connectedRepoToFm) },
          }),
        };
      });

      let reciprocated: unknown;
      if (reciprocate) {
        const target = await resolveConnectedRepo(root, repoPath);
        if (!target) {
          reciprocated = { ok: false, reason: 'target repo not reachable (no plan found at path)' };
        } else {
          const targetPlan = (await loadPlan(target.root)).cards.get('PLAN-PROJECT');
          if (!targetPlan) {
            reciprocated = { ok: false, reason: 'target repo has no plan.md (PLAN-PROJECT)' };
          } else {
            const homeRepoRoot = path.dirname(root);
            const reverseName =
              path
                .basename(homeRepoRoot)
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '-')
                .replace(/^-+|-+$/g, '') || 'home';
            const reverseEntry: ConnectedRepo = {
              name: reverseName,
              path: path.relative(target.repoRoot, homeRepoRoot) || '.',
              description: reverse_description,
            };
            await mutateCardFile(targetPlan.filePath, (current) => ({
              frontmatter: applyCardPatch(current.frontmatter, {
                fields: {
                  connected_repos: upsertConnectedRepo(
                    connectedReposFromFrontmatter(current.frontmatter),
                    reverseEntry,
                  ).map(connectedRepoToFm),
                },
              }),
            }));
            reciprocated = {
              ok: true,
              repo_root: target.repoRoot,
              entry: connectedRepoToFm(reverseEntry),
            };
          }
        }
      }

      const lint = await lintPlan(root);
      return ok({
        connected_repos: next.map(connectedRepoToFm),
        reciprocated,
        issues: issuesForFile(lint.issues, planCard.relPath),
      });
    }),
  );

  server.registerTool(
    'remove_connected_repo',
    {
      description:
        'Remove a sibling repo from PLAN-PROJECT connected_repos by name. Does not touch the other repo.',
      inputSchema: { name: z.string(), repo: repoSchema },
    },
    withPlan(async (root, { name }) => {
      const planCard = (await loadPlan(root)).cards.get('PLAN-PROJECT');
      if (!planCard) {
        return fail('NO_PLAN_PROJECT', 'No plan.md (PLAN-PROJECT) at the plan root.');
      }
      const existing = await readConnectedRepos(root);
      if (!existing.some((r) => r.name === name)) {
        return ok({ removed: false, connected_repos: existing.map(connectedRepoToFm) });
      }
      let next: ConnectedRepo[] = [];
      await mutateCardFile(planCard.filePath, (current) => {
        next = removeConnectedRepoEntry(
          connectedReposFromFrontmatter(current.frontmatter),
          name,
        );
        return {
          frontmatter: applyCardPatch(current.frontmatter, {
            fields: {
              connected_repos: next.length > 0 ? next.map(connectedRepoToFm) : null,
            },
          }),
        };
      });
      const lint = await lintPlan(root);
      return ok({
        removed: true,
        connected_repos: next.map(connectedRepoToFm),
        issues: issuesForFile(lint.issues, planCard.relPath),
      });
    }),
  );

  server.registerTool(
    'check_integrity',
    {
      annotations: { readOnlyHint: true },
      description:
        'Lint the whole plan: broken handles, dangling references, wrong folders, schema violations, plus orphans (cards with zero connections). Errors break the graph; warnings and orphans are quality signals.',
      inputSchema: { repo: repoSchema },
    },
    withPlan(async (root) => {
      const lint = await lintPlan(root);
      const orphans = [...lint.index.cards.keys()]
        .filter((h) => (lint.index.connectedHandles.get(h)?.size ?? 0) === 0)
        .sort();
      return ok({
        cards: lint.index.cards.size,
        connections: lint.index.connections.length,
        errors: lint.errors,
        warnings: lint.warnings,
        orphans,
      });
    }),
  );

  server.registerTool(
    'diff_plan',
    {
      annotations: { readOnlyHint: true },
      description:
        'Per-card plan changes from git. base defaults to the sync marker (constellation/.sync.json) or HEAD; head defaults to the working tree. Returns added/modified/removed cards with changed frontmatter keys. Feed the handles to traverse for blast radius.',
      inputSchema: {
        base: z.string().optional(),
        head: z.string().optional(),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { base, head }) => {
      return ok(await diffPlan(root, base, head));
    }),
  );

  server.registerTool(
    'plan_log',
    {
      annotations: { readOnlyHint: true },
      description: 'Git history of one card: the commits that touched its file.',
      inputSchema: {
        handle: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { handle, limit }) => {
      const index = await loadPlan(root);
      const card = index.cards.get(handle.toUpperCase());
      const relPath = card?.relPath ?? relPathForHandle(handle.toUpperCase());
      return ok({
        handle: handle.toUpperCase(),
        commits: await planLog(root, relPath, limit ?? 20),
      });
    }),
  );

  server.registerTool(
    'set_sync_point',
    {
      description:
        'Record that code has been reconciled with the plan as of a commit (default HEAD). diff_plan uses this marker as its default base. Commit the plan first: if constellation/ has uncommitted changes, the marker points at a commit that lacks them and the response includes a warning. Pass format_review: true only to close out the one-time format-upgrade review the server prompts for on first run against an older plan — it records that this plan has been reviewed under the running version\'s rules and silences that prompt for good.',
      inputSchema: {
        sha: z.string().optional(),
        format_review: z
          .boolean()
          .optional()
          .describe(
            "record this plan as reviewed under the running version's format rules (silences the upgrade-review prompt)",
          ),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { sha, format_review }) => {
      const stampReview = format_review === true;
      let point;
      try {
        point = await writeSyncPoint(
          root,
          sha,
          stampReview ? { formatReview: PACKAGE_VERSION } : {},
        );
      } catch (err) {
        // No HEAD to pin to (a repo with no commits, or no repo at all). The
        // review stamp is git-independent, so honor it rather than failing.
        if (!stampReview || sha) throw err;
        const marker = await stampFormatReview(root, PACKAGE_VERSION);
        return ok({
          ...marker,
          warning:
            'No git HEAD to pin a sync point to; recorded the format review only. ' +
            'Run set_sync_point again once the repo has a commit.',
        });
      }
      const dirty = await planDirty(root);
      return ok({
        ...point,
        warning: dirty
          ? `constellation/ has uncommitted changes; marker ${point.synced_sha.slice(0, 8)} does not include them — commit the plan first, then set_sync_point.`
          : undefined,
      });
    }),
  );

  server.registerTool(
    'stale_report',
    {
      annotations: { readOnlyHint: true },
      description:
        'Code-side drift: cards that claim something about code (status built/verified, or carrying a verified_sha) whose BOUND code moved on without them. Binding = directly-connected FILE cards (path:) + the card\'s own code_refs. Each card\'s baseline is its verified_sha, else THE CARD\'S OWN LAST COMMIT (code committed after the card is drift; a card and its code committed together is not), else base, else the sync marker for cards git has never seen change. Uncommitted changes to bound code always count. Reports changed_files and vanished missing_files per stale card (with baseline_source), plus cards with no baseline to check against. This makes a "built/verified" claim re-verifiable instead of taken on faith. Feed the handles to traverse or assemble.',
      inputSchema: {
        base: z
          .string()
          .optional()
          .describe(
            'fallback baseline sha, used only for cards with no verified_sha and no commit of their own',
          ),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { base }) => {
      const index = await loadPlan(root);
      const r = await computeStaleCards(root, index, base);
      return ok({
        checked: r.checked,
        stale_count: r.stale.length,
        stale: r.stale,
        no_baseline: r.no_baseline,
      });
    }),
  );

  server.registerTool(
    'check_sync',
    {
      annotations: { readOnlyHint: true },
      description:
        'Definition-of-done check: one glanceable verdict on whether the plan and code are in sync. Combines the plan-global state (in-sync / drifted / dirty / never-synced) — plan changes and code commits since the marker, lint integrity, status rollup — with the per-card code-side drift from stale_report. Advisory only: the server reports, it cannot block; treat code changed without its bound cards re-verified as "not done yet".',
      inputSchema: {
        base: z
          .string()
          .optional()
          .describe(
            "fallback baseline sha for per-card drift, used only for cards with no verified_sha and no commit of their own (default: sync marker)",
          ),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { base }) => {
      const lint = await lintPlan(root);
      // Compute the drift verdict once, honoring an explicit `base`, and hand
      // both it and the lint result to computeSyncStatus — it would otherwise
      // redo the whole claim-card pass (stat per bound path + a git diff per
      // baseline) for a `status.stale` this tool never reads.
      const r = await computeStaleCards(root, lint.index, base);
      const status = await computeSyncStatus(root, { lint, stale: r });
      return ok({
        advisory:
          'Advisory only — the MCP server reports sync state, it cannot block. Use as a definition-of-done gate before calling work complete.',
        state: status.state,
        marker: status.marker,
        plan_dirty: status.plan_dirty,
        plan_changes_since_marker: status.plan_changes_since_marker,
        code_commits_since_marker: status.code_commits_since_marker,
        integrity: status.integrity,
        status_rollup: status.status_rollup,
        total_cards: status.total_cards,
        stale_cards: r.stale,
        cards_without_baseline: r.no_baseline,
      });
    }),
  );

  server.registerTool(
    'start_viewer',
    {
      description:
        'Start a local web server that renders this plan as a browsable, editable site, and return its URL (e.g. http://localhost:4747/). Idempotent: if the viewer is already running, returns the existing URL. The server runs until stop_viewer or until this MCP process exits. ALWAYS reply to the user with the returned url as a clickable link and state the port it bound to.',
      inputSchema: {
        port: z
          .number()
          .int()
          .min(0)
          .max(65535)
          .optional()
          .describe('default 4747; 0 picks any free port'),
        readonly: z
          .boolean()
          .optional()
          .describe('disable editing from the browser (default false)'),
        open: z
          .boolean()
          .optional()
          .describe('open the URL in the local default browser (default false)'),
      },
    },
    withPlan(async (root, { port, readonly, open }) => {
      if (viewer) {
        return ok({ already_running: true, url: viewer.url, plan_root: viewer.planRoot });
      }
      const { startServer } = await import('../serve/server.js');
      const requested = port ?? 4747;
      // With the default port, walk forward until one is free so concurrent viewers
      // (each project runs its own MCP process) land on distinct, predictable URLs.
      // An explicitly requested port is honored exactly — a collision is an error.
      const span = port === undefined ? 20 : 1;
      let running: RunningServer | null = null;
      let lastErr: unknown = null;
      for (let p = requested; p < requested + span; p++) {
        try {
          running = await startServer({ planRoot: root, port: p, readonly: readonly ?? false });
          break;
        } catch (err) {
          lastErr = err;
          if ((err as NodeJS.ErrnoException)?.code === 'EADDRINUSE') continue;
          return fail('VIEWER_FAILED', err instanceof Error ? err.message : String(err));
        }
      }
      if (!running) {
        return fail(
          'PORT_IN_USE',
          port === undefined
            ? `No free port found in ${requested}–${requested + span - 1}.`
            : `Port ${requested} is already in use. Pass a different port, or 0 for any free port.`,
        );
      }
      const url = `http://localhost:${running.port}/`;
      viewer = { server: running, planRoot: root, url };
      if (open) {
        await openUrl(url);
      }
      return ok({ url, port: running.port, plan_root: root, editable: !(readonly ?? false) });
    }),
  );

  server.registerTool(
    'stop_viewer',
    {
      description: 'Stop the web viewer started by start_viewer. No-op if it is not running.',
      inputSchema: {},
    },
    async () => {
      if (!viewer) return ok({ running: false });
      const { url } = viewer;
      await viewer.server.close();
      viewer = null;
      return ok({ stopped: true, was: url });
    },
  );

  return server;
}

/**
 * buildServer, plus the one thing that must be known before the handshake: does
 * the plan this server will serve still need the format-upgrade review? The
 * instructions are fixed at construction time, so the check happens here.
 */
export async function createServer(options: ServerOptions = {}): Promise<McpServer> {
  return buildServer({
    ...options,
    instructions: options.instructions ?? (await bootInstructions(options.planRoot)),
  });
}

export async function startMcpServer(): Promise<void> {
  const server = await createServer();
  await server.connect(new StdioServerTransport());
  // stdout belongs to the protocol; greet on stderr.
  console.error('constellation mcp: ready (stdio)');
}
