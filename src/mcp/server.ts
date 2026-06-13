import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { isHandleShaped, isKnownHandle, typeForHandle } from '../core/handles.js';
import { loadPlan } from '../core/indexer.js';
import { lintPlan } from '../core/lint.js';
import { resolvePlanDir } from '../core/resolve.js';
import type { Card, Issue, PlanIndex, TypeName } from '../core/types.js';
import { TYPE_NAMES } from '../core/types.js';
import type { RunningServer } from '../serve/server.js';
import { diffPlan, planDirty, planLog, writeSyncPoint } from './git.js';
import { searchCards } from './search.js';
import {
  applyCardPatch,
  createCardFile,
  deepMerge,
  relPathForHandle,
  reservedFieldKeys,
  updateCardFile,
} from '../core/writer.js';

const INSTRUCTIONS = `# Constellation MCP

The project's architecture plan lives as markdown files in a constellation/ folder.
Each file is a **card** (the filename is the handle: api/API-TICKETS.md = API-TICKETS);
cards are linked by undirected **connections** derived from the connections: frontmatter
list, handle-shaped frontmatter values, [[HANDLE]] body links, and mermaid node IDs.

Retrieval is hydrated: get_card / search / traverse can return connected cards with
their FULL frontmatter and body in one call (connected: "full"). Use that when you are
about to work on an area; use "summary" for orientation.

Writes are validated: every write tool lints and returns issues for the file it touched.
update_card patch.fields deep-merges (arrays replace, null deletes); body replaces.
Body-only updates never reformat frontmatter.

Change tracking is git: diff_plan reports per-card changes since the sync marker (or HEAD).
Never stamp dirty flags into cards.

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
into central or complex areas. Read before you ask — ask the user only for intent,
priorities, and history the code can't reveal. Then find gaps IN THE PLAN: step back and
hunt blind spots the user may not have considered — missing unhappy paths and lifecycle
states, auth/permission gaps, and cross-cutting concerns plans forget (security, privacy,
observability, rate limits, pagination, migrations, testing). The mechanical checks
(check_integrity orphans, dangling refs, code-without-cards) are just hygiene. Give a
short, prioritized list of recommendations and ask about the judgment calls. For the full
method use the bootstrap_plan or audit_plan prompt. Status is planned → building → built →
verified; verify only against real code.

To let the user browse the plan visually, start_viewer launches a local web server that
renders the plan as an editable site and returns its URL (it scans forward from port 4747
for a free port, so always read the actual port from the response). ALWAYS post that URL
back to the user as a clickable link, e.g. http://localhost:4747/, and tell them the port.
The viewer runs until stop_viewer or until this server process exits.`;

// The full plan-from-code playbook lives in one file (skill/methodology.md), shared by the
// skill and the MCP prompts so the two can't drift. Resolve it relative to this module:
// from dist/mcp/server.js (or src/mcp/server.ts) '../..' is the package/repo root.
const METHODOLOGY_PATH = path.join(
  fileURLToPath(new URL('../..', import.meta.url)),
  'skill',
  'methodology.md',
);

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

const detailSchema = z.enum(['none', 'summary', 'full']);
const typeSchema = z.enum(TYPE_NAMES as unknown as [TypeName, ...TypeName[]]);
const statusSchema = z.enum(['planned', 'building', 'built', 'verified']);

export interface ServerOptions {
  /** Fixed plan root (tests); when omitted, resolved per call by walking up from cwd. */
  planRoot?: string;
}

export function buildServer(options: ServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'constellation', version: '0.1.1' },
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

  /** Wrap a handler with plan resolution and error reporting. */
  function withPlan<A>(
    handler: (root: string, args: A) => Promise<ToolResult>,
  ): (args: A) => Promise<ToolResult> {
    return async (args: A) => {
      const root = await planRoot();
      if (!root) {
        return fail(
          'NO_PLAN_FOUND',
          `No constellation/ folder found by walking up from ${process.cwd()}. This MCP ` +
            `server uses its own working directory — if that isn't your repo, set "cwd" to ` +
            'the repo root in your MCP client config. Otherwise call init_plan (optionally ' +
            'with { path } pointing at the repo root), or run `constellation init`.',
        );
      }
      try {
        return await handler(root, args);
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
      description:
        'Fetch one card by handle, optionally with all connected cards hydrated. connected: "full" returns the complete frontmatter and body of every connected card — use it when about to work on an area.',
      inputSchema: {
        handle: z.string(),
        connected: detailSchema.optional().describe('default: summary'),
      },
    },
    withPlan(async (root, { handle, connected }) => {
      const index = await loadPlan(root);
      const card = index.cards.get(handle.toUpperCase());
      if (!card) return fail('NOT_FOUND', `No card with handle ${handle}`);
      return ok({
        card: full(card),
        connected_cards: connectedCards(index, card.handle, connected ?? 'summary'),
      });
    }),
  );

  server.registerTool(
    'list_cards',
    {
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
      description:
        'Scored full-text search over handles, names, kinds, and bodies. Set connected: "full" to hydrate each match with the complete content of its connected cards — fuzzy query to working context in one call.',
      inputSchema: {
        q: z.string(),
        types: z.array(typeSchema).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        connected: detailSchema.optional().describe('default: none'),
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
      description:
        'Breadth-first walk of the connection graph from one or more starting handles. Seed it with diff_plan output for impact analysis. detail: "full" includes frontmatter and body of every reached card.',
      inputSchema: {
        start: z.union([z.string(), z.array(z.string()).min(1)]),
        depth: z.number().int().min(0).max(5).optional().describe('default: 2'),
        types: z.array(typeSchema).optional(),
        detail: z.enum(['summary', 'full']).optional().describe('default: summary'),
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
    'create_card',
    {
      description:
        'Create a new card. The handle determines type and file location. fields = type-specific frontmatter (see the type schemas); body = markdown. The card IS created even when issues are returned — issues are the current lint state, not a failure. Set validate:false to skip linting during bulk import (then run check_integrity once at the end). For many cards at once, prefer create_cards.',
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
          ? (card.frontmatter.connections as string[])
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
      },
    },
    withPlan(async (root, { handle, patch, body }) => {
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
    'delete_card',
    {
      description:
        'Delete a card file. Returns the handles that referenced it (their references are now dangling) plus resulting lint issues.',
      inputSchema: { handle: z.string() },
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
      inputSchema: { from: z.string(), to: z.string() },
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
      inputSchema: { a: z.string(), b: z.string() },
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
    'check_integrity',
    {
      description:
        'Lint the whole plan: broken handles, dangling references, wrong folders, schema violations, plus orphans (cards with zero connections). Errors break the graph; warnings and orphans are quality signals.',
      inputSchema: {},
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
      description:
        'Per-card plan changes from git. base defaults to the sync marker (constellation/.sync.json) or HEAD; head defaults to the working tree. Returns added/modified/removed cards with changed frontmatter keys. Feed the handles to traverse for blast radius.',
      inputSchema: {
        base: z.string().optional(),
        head: z.string().optional(),
      },
    },
    withPlan(async (root, { base, head }) => {
      return ok(await diffPlan(root, base, head));
    }),
  );

  server.registerTool(
    'plan_log',
    {
      description: 'Git history of one card: the commits that touched its file.',
      inputSchema: {
        handle: z.string(),
        limit: z.number().int().min(1).max(100).optional(),
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
      inputSchema: { sha: z.string().optional() },
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
        const { spawn } = await import('node:child_process');
        const cmd =
          process.platform === 'darwin'
            ? 'open'
            : process.platform === 'win32'
              ? 'start'
              : 'xdg-open';
        spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
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
