import { readFile, rm, stat } from 'node:fs/promises';
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
import { loadPlan } from '../core/indexer.js';
import { lintPlan } from '../core/lint.js';
import { resolvePlanDir } from '../core/resolve.js';
import type { Card, Issue, PlanIndex, TypeName } from '../core/types.js';
import { TYPE_NAMES } from '../core/types.js';
import type { RunningServer } from '../serve/server.js';
import {
  changedFilesSince,
  diffPlan,
  headSha,
  planDirty,
  planLog,
  readSyncPoint,
  writeSyncPoint,
} from '../core/git.js';
import { computeSyncStatus } from '../core/sync.js';
import { boundPathsForCard, resolveCodeForCard } from '../core/code.js';
import { searchCards } from './search.js';
import {
  applyCardPatch,
  bodyHeadingTexts,
  createCardFile,
  deepMerge,
  relPathForHandle,
  replaceBodySection,
  reservedFieldKeys,
  updateCardFile,
  withAppendedNote,
} from '../core/writer.js';
import type { CardNote } from '../core/writer.js';
import {
  connectedRepoToFm,
  listConnectedRepos,
  readConnectedRepos,
  removeConnectedRepoEntry,
  resolveConnectedRepo,
  upsertConnectedRepo,
} from '../core/repos.js';
import type { ConnectedRepo } from '../core/types.js';

const INSTRUCTIONS = `# Constellation MCP

Constellation is this project's durable, cross-session memory for AI agents — treat it as
memory you share with every past and future agent, not docs you skim. Before changing code
an area's cards cover, READ those cards: you're recovering prior agents' understanding, not
starting fresh. After changing that code, bring the cards back into line — that's part of
"done," like updating tests. The payoff is that understanding COMPOUNDS across sessions
instead of being re-derived from scratch each time; that only holds if you keep the cards
true. A card you can't trust is worse than no card.

Put in cards what the code can't say — intent, decisions (and the alternatives you rejected),
current built/live state, gotchas, cross-cutting rules. Do NOT duplicate what the repo already
holds — DDL, signatures, code: link to it instead; copies drift. "built"/"verified" is a
claim, not a fact — stamp it with set_verified so a later agent can re-check whether the bound
code moved (stale_report / check_sync). Durability, not distrust.

The project's architecture plan lives as markdown files in a constellation/ folder.
Each file is a **card** (the filename is the handle: api/API-TICKETS.md = API-TICKETS);
cards are linked by undirected **connections** derived from the connections: frontmatter
list, handle-shaped frontmatter values, [[HANDLE]] body links, and mermaid node IDs.

Retrieval is hydrated: get_card / search / traverse can return connected cards with
their FULL frontmatter and body in one call (connected: "full"). Use that when you are
about to work on an area; use "summary" for orientation. get_card can also hand back the
CODE a card is bound to — code: "paths" returns the resolved file paths of its connected
FILE cards (path:) plus its own code_refs; code: "direct" attaches their contents (capped,
binaries/lockfiles/generated skipped) so a background coder starts from intent + current
code in one call. assemble turns a delta (or a handle set) into a work package: the changed
cards + their neighborhood (full) + bound code + a heuristic build order + FILE-DISJOINT
units you can fan out one sub-agent per, with no two touching the same file.

Writes are validated: every write tool lints and returns issues for the file it touched.
update_card patch.fields deep-merges (arrays replace, null deletes); body replaces.
Body-only updates never reformat frontmatter. Prefer SMALL, cheap writes over rewriting a
whole card — make the honest update the easy one: append_note adds an append-only typed note
(decision / gotcha / state / deviation / verified) with no full-body rewrite; edit_section
replaces a single ## section in place. Reach for these to record a correction the moment you
learn it, so cards stay true instead of drifting.

describe_type is the type reference, served by this server: call it with no args for the
catalog of all 17 card types, or with a type (e.g. describe_type PAGE) for that type's
frontmatter schema + a golden example. Consult it before authoring a type you haven't used
this session — you don't need the authoring skill loaded to get the fields right.

Change tracking is git: diff_plan reports per-card changes since the sync marker (or HEAD).
Never stamp dirty flags or changelogs into cards — "what changed" is git's job. The one
recorded baseline that IS allowed is verification provenance: set_verified stamps verified_sha
(the git sha you checked a card against) + verified_at. That is the basis of a claim, not a
change flag — and the staleness VERDICT is always recomputed live (stale_report / check_sync),
never stored. stale_report lists built/verified cards whose bound code changed since their
verified_sha (reverse drift); check_sync rolls that per-card drift plus the plan-global state
into one definition-of-done verdict (advisory — the server reports, it can't block).

"Sync the plan" / "sync the plan to the code" = bring the CODE up to match the plan (the
plan is the source of truth — behavior changes in the plan FIRST, then in code, never the
reverse). It is NOT merely stamping the marker. The loop: diff_plan (base = marker) for what
changed → traverse the changed handles (detail: "full") for blast radius → update the
application code to match those cards → run the build/tests and bump card status → commit,
then set_sync_point to advance the marker (commit the plan first — it warns if the plan is
uncommitted). When the diff is large and the affected areas don't share files, act as the
ORCHESTRATOR rather than editing it all yourself: partition the blast radius into
independent, non-overlapping neighborhoods (split on file boundaries so no two agents touch
the same file, AND assign each plan card to exactly one agent — two agents calling
update_card on the same card race, and the later write silently clobbers the earlier) and
fan out a sub-agent per neighborhood in parallel; use one agent when the change is small or
files overlap. Delegating keeps your context clean and lets you hold the
macro view. ALWAYS verify the sub-agents' work yourself after they have all finished — re-read
each change against its cards and run the build/tests; never trust their reports alone — then
set the sync point once.

Plan-first when changing code: when asked to build a feature or change behavior in an area
this plan covers, do NOT edit code first. The plan you make leads with Constellation — read
the affected neighborhood (get_card / traverse / search, connected: "full"), then add or
update the cards so they describe the desired END STATE (work that isn't built yet is
status: planned), wiring every connection between the affected cards. Show that set of card
changes as the proposal; on approval, bring the CODE up to match via the sync loop above.
FINISH by reconciling — re-read the touched cards against the code, run check_integrity so
no affected card is left an orphan and every connection is set, bump status (planned →
building → built → verified), commit, and set_sync_point. In plan mode the write tools are
unavailable by design (the read tools — get_card, list_cards, search, traverse, assemble,
describe_type, check_integrity, diff_plan, plan_log, stale_report, check_sync,
list_connected_repos — are marked read-only and stay available), so spend plan mode READING:
pull in as much of the relevant plan as you can
(traverse from the entry points, connected: "full") to build a strong model of the project
fast, fold the intended card edits into the plan you present, and write them to
Constellation first, before any code, once the user approves.

For migrations or large scaffolds, use create_cards and add_connections (batched, one
lint pass) instead of many single calls — connections between cards in the same batch
resolve without transient "does not resolve" errors. A card is created even when issues
are returned (issues are lint state, not failure). check_integrity reports orphans
(zero-connection cards), and list_cards connected:false lists them.

The plan folder is found by walking up from the working directory, BOUNDED by the repo
root (it never adopts another repo's plan). If no plan exists in this repo (tools return
NO_PLAN_FOUND), call init_plan once — create_card works immediately after.

When building or auditing a plan, act as a senior engineer and architect advising the user,
not a scribe taking dictation: don't assume they know everything — bring expertise, name
trade-offs and risks, propose what's missing, and explain the why so they can decide. Hold
the bar high and with integrity: do it right, be honest about built-vs-planned and
verified-vs-assumed, and surface uncertainty rather than papering over it. But don't
over-engineer — there's elegance in simplicity: calibrate to the project's scope, recommend
the smallest change that most improves the plan, and don't manufacture gaps to look thorough.
The aim is a plan the user would be proud to ship. Hold it to one bar above all: if every
line of code were deleted, the app could be rebuilt from the plan alone — aim for that
coverage (not volume), and whatever you couldn't rebuild is the gap.

Work macro→micro: orient (manifest, routes, folder
layout) and seed PLAN-PROJECT + a system DIAGRAM — propose a human-readable project name
and confirm it with the user (it's plan.md's name: and the viewer's title; change it
anytime via update_card on PLAN-PROJECT); then follow the DATA (DB → DATATYPE →
API → PAGE, with FLOW/STATE for paths and lifecycles) and the USER (ROLE + auth FLOW
first, then PAGE/COMPONENT and key journeys) and the EDGES (EXTERNAL/JOB/EVENT); then zoom
into central or complex areas. For a non-trivial plan, after the macro pass act as the ORCHESTRATOR here too: partition the build into independent neighborhoods (the DATA, the USER, the EDGES) and fan out a sub-agent per neighborhood in parallel — but assign each card to exactly one agent (two agents calling update_card on the same card race, later write wins) and have them return card specs you write via batched create_cards/add_connections, then verify each agent's work and lint once; use one agent for a small plan. Read before you ask — ask the user only for intent,
priorities, and history the code can't reveal. Then find gaps IN THE PLAN: step back and
hunt blind spots the user may not have considered — missing unhappy paths and lifecycle
states, auth/permission gaps, and cross-cutting concerns plans forget (security, privacy,
observability, rate limits, pagination, migrations, testing). The mechanical checks
(check_integrity orphans, dangling refs, code-without-cards) are just hygiene. Give a
short, prioritized list of recommendations and ask about the judgment calls. For the full
method use the bootstrap_plan or audit_plan prompt. Status is planned → building → built →
verified; verify only against real code.

Connected repos (multi-repo work): a project can declare sibling repos in PLAN-PROJECT
connected_repos (name + on-disk path + description) — list_connected_repos shows them with
reachability, add_connected_repo links one (reciprocate:true also writes the reverse link
into the other repo, with the user's OK). These are REPO-level links only: cards never connect
across repos, and each repo's plan stays self-contained and lints alone. To work on a connected
repo, pass repo: "<name>" to any read or write tool (get_card, search, traverse, update_card,
…) and it reads/writes THAT repo's plan; omit repo for the current one. To answer a question
about a connected repo, first read its plan with repo:; if you need the real code (or its plan
can't answer), spawn a sub-agent scoped to that repo's path to investigate and report back —
and if its plan had the gap, fill it. For one change spanning repos: examine each repo's area,
write the per-repo card updates with repo: set on EVERY write (never omit it cross-repo, or the
write lands in the wrong place), then fan out a per-repo implementer sub-agent (each runs in
plain single-repo mode, blind to the others) and reconcile + set_sync_point per repo. Inside a
single repo, repo is unnecessary and everything behaves exactly as before.

To let the user browse the plan visually, start_viewer launches a local web server that
renders the plan as an editable site and returns its URL (it scans forward from port 4747
for a free port, so always read the actual port from the response). ALWAYS post that URL
back to the user as a clickable link, e.g. http://localhost:4747/, and tell them the port.
The viewer runs until stop_viewer or until this server process exits.`;

// The full plan-from-code playbook lives in one file (skill/methodology.md), shared by the
// skill and the MCP prompts so the two can't drift. Resolve it relative to this module:
// from dist/mcp/server.js (or src/mcp/server.ts) '../..' is the package/repo root.
// Package root: from dist/mcp/server.js (or src/mcp/server.ts) '../..' is the
// package/repo root. The skill folder, type docs, and JSON schemas all ship here.
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

type Detail = 'none' | 'summary' | 'full';

function connectedCards(index: PlanIndex, handle: string, detail: Detail) {
  if (detail === 'none') return undefined;
  const handles = [...(index.connectedHandles.get(handle) ?? [])].sort();
  const cards = handles
    .map((h) => index.cards.get(h))
    .filter((c): c is Card => Boolean(c));
  return cards.map((c) => (detail === 'full' ? full(c) : summary(c)));
}

function issuesForFile(issues: Issue[], relPath: string): Issue[] {
  return issues.filter((i) => i.file === relPath);
}

interface StaleCard {
  handle: string;
  name: string | null;
  status: string | null;
  baseline: string;
  baseline_source: 'verified_sha' | 'argument' | 'sync-marker';
  changed_files: string[];
  missing_files: string[];
}

interface StaleResult {
  checked: number;
  stale: StaleCard[];
  no_baseline: Array<{ handle: string; status: string | null; files: string[]; reason?: string }>;
}

/**
 * Code-side drift: for every card that makes a claim about code it is bound to
 * (status built/verified, or carrying a verified_sha) compare its bound files
 * against its baseline (its own verified_sha, else the passed base, else the
 * sync marker). A card whose bound code changed — or whose bound file vanished —
 * since it was verified is stale. The verdict is computed live and never stored.
 * Shared by stale_report and check_sync.
 */
async function computeStaleCards(
  root: string,
  index: PlanIndex,
  base?: string,
): Promise<StaleResult> {
  let marker: string | null = null;
  try {
    marker = (await readSyncPoint(root))?.synced_sha ?? null;
  } catch {
    marker = null;
  }
  const fallback = base ?? marker ?? null;

  const stale: StaleCard[] = [];
  const noBaseline: StaleResult['no_baseline'] = [];
  let checked = 0;

  for (const card of index.cards.values()) {
    const verifiedSha =
      typeof card.frontmatter.verified_sha === 'string'
        ? card.frontmatter.verified_sha
        : undefined;
    const isClaim =
      card.status === 'built' || card.status === 'verified' || Boolean(verifiedSha);
    if (!isClaim) continue;
    if (boundPathsForCard(index, card).length === 0) continue;
    checked++;

    const baseline = verifiedSha ?? fallback ?? undefined;
    const resolved = await resolveCodeForCard(root, index, card, 'paths');
    const paths = resolved.files.map((f) => f.path);
    const missing = resolved.files.filter((f) => !f.exists).map((f) => f.path);

    if (!baseline) {
      noBaseline.push({ handle: card.handle, status: card.status ?? null, files: paths });
      continue;
    }
    let changed: Set<string>;
    try {
      changed = await changedFilesSince(root, baseline, paths);
    } catch {
      noBaseline.push({
        handle: card.handle,
        status: card.status ?? null,
        files: paths,
        reason: `baseline ${baseline.slice(0, 8)} unreachable in git history`,
      });
      continue;
    }
    const changedFiles = paths.filter((p) => changed.has(p));
    if (changedFiles.length > 0 || missing.length > 0) {
      stale.push({
        handle: card.handle,
        name: card.name ?? null,
        status: card.status ?? null,
        baseline: baseline.slice(0, 12),
        baseline_source: verifiedSha ? 'verified_sha' : base ? 'argument' : 'sync-marker',
        changed_files: changedFiles,
        missing_files: missing,
      });
    }
  }
  return { checked, stale, no_baseline: noBaseline };
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
      const owner = fileOwner.get(f);
      if (owner) union(owner, s);
      else fileOwner.set(f, s);
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

const detailSchema = z.enum(['none', 'summary', 'full']);
const typeSchema = z.enum(TYPE_NAMES as unknown as [TypeName, ...TypeName[]]);
const statusSchema = z.enum(['planned', 'building', 'built', 'verified']);
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
}

export function buildServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'constellation', version: '0.2.2' },
    { instructions: INSTRUCTIONS },
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
        `server uses its own working directory — if that isn't your repo, set "cwd" to ` +
        'the repo root in your MCP client config. Otherwise call init_plan (optionally ' +
        'with { path } pointing at the repo root), or run `constellation init`.',
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
    'get_card',
    {
      annotations: { readOnlyHint: true },
      description:
        'Fetch one card by handle, optionally with all connected cards hydrated. connected: "full" returns the complete frontmatter and body of every connected card — use it when about to work on an area. code: "paths" returns the resolved file paths the card is bound to (connected FILE cards plus code_refs); code: "direct" attaches their contents (capped, binaries/lockfiles/generated skipped) so a background coder starts from intent + current code in one call.',
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
          .min(1)
          .max(100)
          .optional()
          .describe('return only the most recent N notes'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { handle, connected, code, notes_kind, notes_limit }) => {
      const index = await loadPlan(root);
      const card = index.cards.get(handle.toUpperCase());
      if (!card) return fail('NOT_FOUND', `No card with handle ${handle}`);
      let cardView = full(card);
      if ((notes_kind || notes_limit) && Array.isArray(card.frontmatter.notes)) {
        let notes = card.frontmatter.notes.filter(
          (n): n is Record<string, unknown> => Boolean(n) && typeof n === 'object',
        );
        if (notes_kind) notes = notes.filter((n) => n.kind === notes_kind);
        if (notes_limit) notes = notes.slice(-notes_limit);
        cardView = { ...cardView, frontmatter: { ...card.frontmatter, notes } };
      }
      const result: Record<string, unknown> = {
        card: cardView,
        connected_cards: connectedCards(index, card.handle, connected ?? 'summary'),
      };
      if (code && code !== 'none') {
        result.code = await resolveCodeForCard(root, index, card, code);
      }
      return ok(result);
    }),
  );

  server.registerTool(
    'list_cards',
    {
      annotations: { readOnlyHint: true },
      description:
        'Catalog of cards filtered by type, kind, status, and/or connectedness. connected:false returns orphans (cards with zero connections). Returns summaries (handle, type, kind, name, status).',
      inputSchema: {
        types: z.array(typeSchema).optional(),
        kind: z.string().optional(),
        status: statusSchema.optional(),
        connected: z
          .boolean()
          .optional()
          .describe('false = orphans only; true = connected only'),
        limit: z.number().int().min(1).max(500).optional(),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { types, kind, status, connected, limit }) => {
      const index = await loadPlan(root);
      const typeFilter = types && types.length > 0 ? new Set(types) : null;
      const isConnected = (h: string) => (index.connectedHandles.get(h)?.size ?? 0) > 0;
      const matched = [...index.cards.values()]
        .filter((c) => !typeFilter || typeFilter.has(c.type))
        .filter((c) => !kind || c.kind === kind)
        .filter((c) => !status || c.status === status)
        .filter((c) => connected === undefined || isConnected(c.handle) === connected)
        .sort((a, b) => a.handle.localeCompare(b.handle));
      return ok({
        total: matched.length,
        cards: matched.slice(0, limit ?? 200).map(summary),
      });
    }),
  );

  server.registerTool(
    'search',
    {
      annotations: { readOnlyHint: true },
      description:
        'Scored full-text search over handles, names, kinds, and bodies. Set connected: "full" to hydrate each match with the complete content of its connected cards — fuzzy query to working context in one call.',
      inputSchema: {
        q: z.string(),
        types: z.array(typeSchema).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        connected: detailSchema.optional().describe('default: none'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { q, types, limit, connected }) => {
      const index = await loadPlan(root);
      const hits = searchCards(index, q, types).slice(0, limit ?? 20);
      return ok({
        matches: hits.map((hit) => ({
          card: summary(hit.card),
          score: hit.score,
          excerpt: hit.excerpt,
          connected_cards: connectedCards(index, hit.card.handle, connected ?? 'none'),
        })),
      });
    }),
  );

  server.registerTool(
    'traverse',
    {
      annotations: { readOnlyHint: true },
      description:
        'Breadth-first walk of the connection graph from one or more starting handles. Seed it with diff_plan output for impact analysis. detail: "full" includes frontmatter and body of every reached card.',
      inputSchema: {
        start: z.union([z.string(), z.array(z.string()).min(1)]),
        depth: z.number().int().min(0).max(5).optional().describe('default: 2'),
        types: z.array(typeSchema).optional(),
        detail: z.enum(['summary', 'full']).optional().describe('default: summary'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { start, depth, types, detail }) => {
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
          for (const neighbor of index.connectedHandles.get(handle) ?? []) {
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

      const cards = [...distance.entries()]
        .map(([handle, dist]) => {
          const card = index.cards.get(handle)!;
          return {
            ...(detail === 'full' ? full(card) : summary(card)),
            distance: dist,
          };
        })
        .sort((a, b) => a.distance - b.distance || a.handle.localeCompare(b.handle));
      const connections = index.connections.filter(
        (c) => distance.has(c.a) && distance.has(c.b),
      );
      return ok({ cards, connections, not_found: missing });
    }),
  );

  server.registerTool(
    'assemble',
    {
      annotations: { readOnlyHint: true },
      description:
        'Turn a set of cards (or the plan delta since a base) into a ready-to-work package: the seed cards plus their connected neighborhood (full), the code each is bound to (code: paths|direct), a heuristic build order (data → contracts → surfaces), and — the key bit — the seeds split into FILE-DISJOINT units so you can hand one sub-agent per unit with no risk of two agents editing the same file. Omit handles to assemble everything changed since base (default: the sync marker). This is the orchestration bridge: diff_plan + traverse + code attach in one call.',
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
          .describe('neighborhood depth around each seed (default: 1)'),
        code: codeModeSchema.optional().describe('attach bound code per card (default: paths)'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { handles, base, depth, code }) => {
      const index = await loadPlan(root);

      let seeds: string[];
      let delta: { base: string; base_source: string } | null = null;
      if (handles && handles.length > 0) {
        seeds = [...new Set(handles.map((h) => h.toUpperCase()))].filter((h) =>
          index.cards.has(h),
        );
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
          base: delta,
          seeds: [],
          units: [],
          note: handles
            ? 'None of the given handles exist in the plan.'
            : 'No plan changes since base — nothing to assemble.',
        });
      }

      const maxDepth = depth ?? 1;
      const distance = new Map<string, number>();
      let frontier = seeds;
      for (const s of seeds) distance.set(s, 0);
      for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
        const next: string[] = [];
        for (const h of frontier) {
          for (const n of index.connectedHandles.get(h) ?? []) {
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

      const units = [];
      for (const part of partitions) {
        const cards = [];
        for (const h of part.handles) {
          const card = index.cards.get(h)!;
          const entry: Record<string, unknown> = {
            ...full(card),
            connected_cards: connectedCards(index, h, 'full'),
          };
          if (codeMode !== 'none') {
            entry.code = await resolveCodeForCard(root, index, card, codeMode);
          }
          cards.push(entry);
        }
        units.push({ handles: part.handles, files: part.files, cards });
      }

      return ok({
        base: delta,
        seeds,
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
      });
    }),
  );

  server.registerTool(
    'describe_type',
    {
      annotations: { readOnlyHint: true },
      description:
        'The card-type reference, served straight from this package. Call with no args for the catalog — all 17 types with their prefix, folder, and one-line purpose. Call with a type for everything needed to author one: the frontmatter JSON Schema (fields, which are required, descriptions) plus the golden example and authoring guidance. Use it before writing a card of a type you have not authored this session — it is the contract create_card/create_cards/update_card validate against (W002/W003), so you do not need the authoring skill loaded to get the fields right.',
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
          failed.push({ handle, error: err instanceof Error ? err.message : String(err) });
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
        const existingList = Array.isArray(card.frontmatter.connections)
          ? card.frontmatter.connections.filter((c): c is string => typeof c === 'string')
          : [];
        const merged = [...new Set([...existingList, ...targets])];
        const frontmatter = applyCardPatch(card.frontmatter, { connections: merged });
        await updateCardFile(card.filePath, { frontmatter });
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

      const frontmatter = patch
        ? applyCardPatch(card.frontmatter, patch)
        : undefined;

      await updateCardFile(card.filePath, { frontmatter, body });
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
      const frontmatter = withAppendedNote(card.frontmatter, note);
      await updateCardFile(card.filePath, { frontmatter });
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
      const body = replaceBodySection(card.body, section, text);
      if (body === null) {
        const headings = bodyHeadingTexts(card.body);
        const target = section.trim().replace(/^#+\s*/, '').toLowerCase();
        const matchCount = headings.filter((h) => h.toLowerCase() === target).length;
        if (matchCount > 1) {
          return fail(
            'AMBIGUOUS_SECTION',
            `${card.handle} has ${matchCount} headings called "${section}"; edit_section can't tell them apart. Use update_card to set the whole body.`,
          );
        }
        return fail(
          'SECTION_NOT_FOUND',
          `No heading "${section}" in ${card.handle}. Headings present: ${headings.length ? headings.join(', ') : '(none)'}. Use update_card to set the whole body or add the section.`,
        );
      }
      await updateCardFile(card.filePath, { body });
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
        'Mark a card verified against the real code: stamp verified_sha (the git sha you checked it at, default HEAD) + verified_at, set status to verified, and optionally append a verified note. The verified_sha is the BASELINE for code-side drift (stale_report / check_sync): later, if the card\'s bound code changed since this sha, the claim is flagged for re-verification. This is durability, not distrust — verify only against code you actually checked.',
      inputSchema: {
        handle: z.string(),
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
    withPlan(async (root, { handle, sha, note }) => {
      const index = await loadPlan(root);
      const card = index.cards.get(handle.toUpperCase());
      if (!card) return fail('NOT_FOUND', `No card with handle ${handle}`);
      let resolvedSha = sha;
      let warning: string | undefined;
      if (!resolvedSha) {
        try {
          resolvedSha = await headSha(root);
        } catch {
          warning =
            'Not a git repo (or no commits): stamped verified_at + status only. Drift detection needs a verified_sha baseline — pass sha or commit first.';
        }
      }
      const verifiedAt = new Date().toISOString();
      const fields: Record<string, unknown> = { verified_at: verifiedAt };
      if (resolvedSha) fields.verified_sha = resolvedSha;
      let frontmatter = applyCardPatch(card.frontmatter, { status: 'verified', fields });
      if (note) {
        const n: CardNote = { kind: 'verified', text: note };
        if (resolvedSha) n.sha = resolvedSha;
        frontmatter = withAppendedNote(frontmatter, n);
      }
      await updateCardFile(card.filePath, { frontmatter });
      const lint = await lintPlan(root);
      const updated = lint.index.cards.get(card.handle);
      return ok({
        card: updated ? full(updated) : null,
        verified_sha: resolvedSha ?? null,
        verified_at: verifiedAt,
        warning,
        issues: issuesForFile(lint.issues, card.relPath),
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
    'add_connection',
    {
      description:
        'Connect two cards by appending `to` to `from`’s connections list. No-op if they are already connected through any source.',
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
      const existing = Array.isArray(from.frontmatter.connections)
        ? (from.frontmatter.connections as string[])
        : [];
      const frontmatter = deepMerge(from.frontmatter, {
        connections: [...existing, to.handle],
      });
      await updateCardFile(from.filePath, { frontmatter });
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
        'Remove a connection by deleting it from either card’s connections list. Reports if the cards remain connected through other sources (frontmatter fields, body links, mermaid) that must be edited manually.',
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
        const list = Array.isArray(card.frontmatter.connections)
          ? (card.frontmatter.connections as string[])
          : [];
        if (list.includes(other)) {
          const next = list.filter((h) => h !== other);
          const frontmatter = deepMerge(card.frontmatter, {
            connections: next.length > 0 ? next : null,
          });
          await updateCardFile(card.filePath, { frontmatter });
          removedFrom.push(card.handle);
        }
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
          if (card.refs.frontmatter.includes(other))
            remainingSources.push(`frontmatter field on ${card.handle}`);
          if (card.refs.body.includes(other))
            remainingSources.push(`[[link]] in body of ${card.handle}`);
          if (card.refs.mermaid.includes(other))
            remainingSources.push(`mermaid block in ${card.handle}`);
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
      const next = upsertConnectedRepo(await readConnectedRepos(root), entry);
      const frontmatter = applyCardPatch(planCard.frontmatter, {
        fields: { connected_repos: next.map(connectedRepoToFm) },
      });
      await updateCardFile(planCard.filePath, { frontmatter });

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
            const targetNext = upsertConnectedRepo(
              await readConnectedRepos(target.root),
              reverseEntry,
            );
            await updateCardFile(targetPlan.filePath, {
              frontmatter: applyCardPatch(targetPlan.frontmatter, {
                fields: { connected_repos: targetNext.map(connectedRepoToFm) },
              }),
            });
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
      const next = removeConnectedRepoEntry(existing, name);
      await updateCardFile(planCard.filePath, {
        frontmatter: applyCardPatch(planCard.frontmatter, {
          fields: { connected_repos: next.length > 0 ? next.map(connectedRepoToFm) : null },
        }),
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
        'Record that code has been reconciled with the plan as of a commit (default HEAD). diff_plan uses this marker as its default base. Commit the plan first: if constellation/ has uncommitted changes, the marker points at a commit that lacks them and the response includes a warning.',
      inputSchema: { sha: z.string().optional(), repo: repoSchema },
    },
    withPlan(async (root, { sha }) => {
      const point = await writeSyncPoint(root, sha);
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
        'Code-side drift: cards that claim something about code (status built/verified, or carrying a verified_sha) whose BOUND code changed since they were verified. Binding = directly-connected FILE cards (path:) + the card\'s own code_refs. Each card\'s baseline is its verified_sha, else base, else the sync marker. Reports changed_files and vanished missing_files per stale card, plus cards with no baseline to check against. This makes a "built/verified" claim re-verifiable instead of taken on faith. Feed the handles to traverse or assemble.',
      inputSchema: {
        base: z
          .string()
          .optional()
          .describe('fallback baseline sha for cards without verified_sha'),
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
          .describe('fallback baseline sha for per-card drift (default: sync marker)'),
        repo: repoSchema,
      },
    },
    withPlan(async (root, { base }) => {
      const status = await computeSyncStatus(root);
      const index = await loadPlan(root);
      const r = await computeStaleCards(root, index, base);
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

export async function startMcpServer(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  // stdout belongs to the protocol; greet on stderr.
  console.error('constellation mcp: ready (stdio)');
}
