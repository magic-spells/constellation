import { watch } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAtlasConfig, writeAtlasConfig } from '../core/atlas-config.js';
import { codeMetrics, type CodeMetric } from '../core/code.js';
import { compileDocs, prepareDocBody } from '../core/docs.js';
import { planRootsFor, repoRemoteUrl, writeSyncPoint } from '../core/git.js';
import { CONSTELLATION_VERSION } from '../core/version.js';
import { isHandleShaped, typeForHandle } from '../core/handles.js';
import { structuredReferrers } from '../core/indexer.js';
import { lintPlan } from '../core/lint.js';
import { parseFile } from '../core/parse.js';
import { codeRootFor, discoverConnectedWorkspaces } from '../core/repos.js';
import {
  countPlanCards,
  identifyPlans,
  slugify,
  uniqueKey,
  type DiscoveredPlan,
  type IdentifiedPlan,
} from '../core/resolve.js';
import { computeSyncStatus } from '../core/sync.js';
import type { Card, Issue } from '../core/types.js';
import {
  applyCardPatch,
  createCardFile,
  deleteCardFile,
  mutateCardFile,
  reservedFieldKeys,
  PathEscapeError,
  StaleWriteError,
  type CardPatch,
} from '../core/writer.js';

const VIEWER_DIST = path.join(
  fileURLToPath(new URL('../..', import.meta.url)),
  'viewer',
  'dist',
);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ico': 'image/x-icon',
};

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The Host values a loopback server on `port` answers to. */
function loopbackHosts(port: number): string[] {
  return [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
}

/** A `--dev-origin` as the Host values it allows; loopback http only. */
function devOriginHosts(origin: string): string[] {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`Invalid dev origin "${origin}"`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'http:' || !loopback || !url.port) {
    throw new Error(`Dev origin must be http://localhost:<port> (got "${origin}")`);
  }
  return loopbackHosts(Number(url.port));
}

// Font files a STYLE card may bind to via a token's `src:` path.
const FONT_EXT = new Set(['.woff2', '.woff', '.ttf', '.otf']);

class RequestBodyError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RequestBodyError';
  }
}

async function cardPayload(card: Card) {
  let mtime = 0;
  try {
    mtime = Math.round((await stat(card.filePath)).mtimeMs);
  } catch {
    // deleted between index and stat; mtime 0 simply disables the stale check
  }
  return {
    handle: card.handle,
    type: card.type,
    kind: card.kind ?? null,
    name: card.name ?? null,
    status: card.status ?? null,
    relPath: card.relPath,
    mtime,
    frontmatter: card.frontmatter,
    body: card.body,
  };
}

function issuesForFile(issues: Issue[], relPath: string): Issue[] {
  return issues.filter((i) => i.file === relPath);
}

export type ServeOptions = {
  port: number;
  readonly?: boolean;
  /**
   * Extra loopback origins allowed past the Host/Origin guard, e.g. the
   * `puzzle dev` server at `http://localhost:3000`, whose proxy forwards the
   * browser's Host and Origin unchanged. Loopback http origins only.
   */
  devOrigins?: string[];
} & (
  | {
      planRoot: string;
      plans?: never;
      defaultPlan?: never;
      scanRoot?: never;
    }
  | {
      plans: DiscoveredPlan[];
      defaultPlan?: string;
      scanRoot: string;
      planRoot?: never;
    }
);

/**
 * The repo a served plan belongs to. `self` is the repo serve was launched in;
 * `connected` is one of its PLAN-PROJECT `connected_repos` (one level only).
 */
export interface PlanRepo {
  name: string;
  /** As declared in `connected_repos`; `.` for the launching repo. */
  path: string;
  /** Absolute directory the repo's plans were discovered from. */
  root: string;
  kind: 'self' | 'connected';
  description?: string;
}

export interface ServedPlan {
  id: string;
  aliases: string[];
  root: string;
  codeRoot: string;
  relPath: string;
  name: string;
  repo: PlanRepo;
}

/** A declared connected repo that could not be served, and why. */
export interface UnavailableWorkspace {
  id: string;
  repo: PlanRepo;
  reason: string;
}

export interface RunningServer {
  server: http.Server;
  port: number;
  plans: ServedPlan[];
  /** Connected repos that are listed in the roster but not served. */
  unavailable: UnavailableWorkspace[];
  defaultPlan: string;
  multi: boolean;
  close: () => Promise<void>;
}

interface PlanState extends ServedPlan {
  /** Plan paths in the roster are relative to this (its repo's scan root). */
  scanRoot: string;
  /** Style-asset fallback when the code root misses: its repo's git/scan root. */
  assetRoot: string;
  repoUrl: string | null | undefined;
  codePrefix: string | undefined;
  metrics: { at: number; data: Record<string, CodeMetric> } | null;
  cardCount: number | null;
  sse: Set<http.ServerResponse>;
  watcher: ReturnType<typeof watch> | null;
  debounce: NodeJS.Timeout | null;
}

const METRICS_TTL_MS = 5_000;

export async function startServer(options: ServeOptions): Promise<RunningServer> {
  const editable = !options.readonly;

  // Fail loud if the viewer bundle is absent — otherwise the caller would print a
  // green "ready" line, open a browser, and land on a blank page served a 404.
  try {
    await stat(path.join(VIEWER_DIST, 'index.html'));
  } catch {
    throw new Error(
      `Viewer assets not found at ${VIEWER_DIST}. Reinstall @magic-spells/constellation, ` +
      'or run `npm run build:viewer` if developing from source.',
    );
  }

  const normalized = await normalizePlans(options);
  const plans = normalized.plans;
  const unavailable = normalized.unavailable;
  const rosterOrder = normalized.order;
  const defaultPlan = normalized.defaultPlan;
  let multi = plans.length > 1;
  const scanRoot = normalized.scanRoot;

  // SECURITY INVARIANT: a request's plan id is a Map lookup built at startup —
  // never joined onto a filesystem path, never resolved. The same map is the
  // allowlist for every write route.
  const planById = new Map<string, PlanState>();
  for (const plan of plans) {
    planById.set(plan.id, plan);
    for (const alias of plan.aliases) planById.set(alias, plan);
  }
  const defaultState = planById.get(defaultPlan);
  if (!defaultState) throw new Error(`Unknown default plan "${defaultPlan}"`);

  /** Take a connected plan out of service, keeping its roster slot as unavailable. */
  function dropConnectedPlan(plan: PlanState, reason: string): void {
    plan.watcher?.close();
    plan.watcher = null;
    plans.splice(plans.indexOf(plan), 1);
    for (const key of [plan.id, ...plan.aliases]) planById.delete(key);
    const down: UnavailableWorkspace = { id: plan.id, repo: plan.repo, reason };
    unavailable.push(down);
    rosterOrder.splice(rosterOrder.indexOf(plan), 1, down);
    multi = plans.length > 1;
  }

  function json(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'content-type': MIME['.json'] });
    res.end(JSON.stringify(data));
  }

  function failure(
    res: http.ServerResponse,
    status: number,
    code: string,
    message: string,
  ): void {
    json(res, status, { error: { code, message } });
  }

  // Every plan and every unavailable connected repo, in workspace order: this
  // repo's plans first, then each connected repo in declaration order. Paths
  // are relative to the plan's OWN repo, which `repo` names.
  async function handleGetPlans(res: http.ServerResponse): Promise<void> {
    const roster = await Promise.all(
      rosterOrder.map(async (entry) =>
        'reason' in entry
          ? {
              id: entry.id,
              aliases: [],
              name: entry.repo.name,
              code_path: '',
              plan_path: '',
              cards: 0,
              default: false,
              available: false,
              reason: entry.reason,
              repo: entry.repo,
            }
          : {
              id: entry.id,
              aliases: entry.aliases,
              name: entry.name,
              code_path: entry.relPath,
              plan_path: toPosix(path.relative(entry.scanRoot, entry.root)),
              cards: await cardCountFor(entry),
              default: entry.id === defaultPlan,
              available: true,
              repo: entry.repo,
            },
      ),
    );
    json(res, 200, {
      multi,
      default: defaultPlan,
      scan_root: scanRoot,
      plans: roster,
    });
  }

  async function handleGetAtlasMetrics(
    plan: PlanState,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!plan.metrics || Date.now() - plan.metrics.at > METRICS_TTL_MS) {
      const lint = await lintPlan(plan.root);
      plan.metrics = { at: Date.now(), data: await codeMetrics(lint.index) };
    }
    json(res, 200, plan.metrics.data);
  }

  async function handleGetPlan(plan: PlanState, res: http.ServerResponse): Promise<void> {
    if (plan.repoUrl === undefined) {
      plan.repoUrl = await repoRemoteUrl(plan.root).catch(() => null);
    }
    if (plan.codePrefix === undefined) {
      plan.codePrefix = await planRootsFor(plan.root)
        .then((roots) => roots.prefix)
        .catch(() => '');
    }
    const lint = await lintPlan(plan.root);
    const cards = await Promise.all(
      [...lint.index.cards.values()]
        .sort((a, b) => a.handle.localeCompare(b.handle))
        .map(cardPayload),
    );
    json(res, 200, {
      editable,
      repo_url: plan.repoUrl,
      code_prefix: plan.codePrefix,
      cards,
      connections: lint.index.connections,
      errors: lint.errors,
      warnings: lint.warnings,
    });
  }

  /**
   * The compiled document: every sectioned card, in author-intended order, with
   * each body already through the render half (`prepareDocBody`) so the heading
   * levels the viewer prints and the ones a future CLI export writes come from
   * one implementation. Link resolution stays with the renderer — it is the only
   * consumer that knows what an in-page anchor looks like.
   */
  async function handleGetDocs(plan: PlanState, res: http.ServerResponse): Promise<void> {
    const lint = await lintPlan(plan.root);
    const project = lint.index.cards.get('PLAN-PROJECT');
    json(res, 200, {
      title: project?.name ?? 'Documentation',
      sections: compileDocs(lint.index).map((section) => ({
        ...section,
        cards: section.cards.map((card) => ({
          ...card,
          body: prepareDocBody(card.body, card.name),
        })),
      })),
    });
  }

  // Read-only: hands the viewer real font bytes so STYLE specimens can @font-face.
  // Resolve against the plan's code root first, then its OWN repo's scan/git
  // root for shared assets — never the launching repo's, for a connected plan.
  async function handleStyleAsset(
    plan: PlanState,
    url: URL,
    res: http.ServerResponse,
  ): Promise<void> {
    const rel = url.searchParams.get('path') ?? '';
    const ext = path.extname(rel).toLowerCase();
    if (!rel || !FONT_EXT.has(ext)) {
      return failure(
        res,
        400,
        'INVALID_ASSET',
        'path must be a repo-relative font file (woff2/woff/ttf/otf)',
      );
    }
    const roots = [plan.codeRoot];
    if (path.resolve(plan.codeRoot) !== plan.assetRoot) roots.push(plan.assetRoot);
    for (const root of roots) {
      const found = await readContained(root, rel);
      if (found === 'escape') return failure(res, 403, 'FORBIDDEN', 'path escapes the repository');
      if (found === 'missing') continue;
      res.writeHead(200, { 'content-type': MIME[ext], 'cache-control': 'no-cache' });
      res.end(found);
      return;
    }
    failure(res, 404, 'NOT_FOUND', `No file at ${rel}`);
  }

  async function handlePatchCard(
    plan: PlanState,
    handle: string,
    body: Record<string, unknown>,
    res: http.ServerResponse,
  ): Promise<void> {
    const lint = await lintPlan(plan.root);
    const card = lint.index.cards.get(handle.toUpperCase());
    if (!card) return failure(res, 404, 'NOT_FOUND', `No card ${handle}`);

    const patch = body as CardPatch & { body?: string };
    const hasPatch = ['name', 'kind', 'status', 'connections', 'fields'].some(
      (key) => key in body,
    );
    if (!hasPatch && typeof patch.body !== 'string') {
      return failure(res, 400, 'EMPTY_UPDATE', 'Provide fields and/or body');
    }
    const reserved = reservedFieldKeys(patch.fields);
    if (reserved.length > 0) {
      return failure(
        res,
        400,
        'INVALID_FIELDS',
        `fields cannot contain reserved keys: ${reserved.join(', ')}`,
      );
    }

    // Apply the patch to the file's CURRENT frontmatter inside the write lock,
    // so a viewer edit composes with a concurrent MCP write instead of undoing it.
    // if_mtime is checked inside that lock so two callers who both sampled the
    // same T cannot both write.
    try {
      await mutateCardFile(
        card.filePath,
        (current) => ({
          frontmatter: hasPatch ? applyCardPatch(current.frontmatter, patch) : undefined,
          body: typeof patch.body === 'string' ? patch.body : undefined,
        }),
        {
          if_mtime: typeof body.if_mtime === 'number' ? body.if_mtime : undefined,
          staleMessage: `${card.handle} changed on disk`,
        },
      );
    } catch (err) {
      if (err instanceof StaleWriteError) {
        return failure(res, 409, 'STALE', err.message);
      }
      throw err;
    }

    const after = await lintPlan(plan.root);
    const updated = after.index.cards.get(card.handle);
    json(res, 200, {
      card: updated ? await cardPayload(updated) : null,
      issues: issuesForFile(after.issues, card.relPath),
    });
  }

  async function handleCreateCard(
    plan: PlanState,
    body: Record<string, unknown>,
    res: http.ServerResponse,
  ): Promise<void> {
    const handle = String(body.handle ?? '').toUpperCase();
    if (!isHandleShaped(handle) || !typeForHandle(handle)) {
      return failure(res, 400, 'INVALID_HANDLE', `${body.handle} is not a valid handle`);
    }
    const lint = await lintPlan(plan.root);
    if (lint.index.cards.has(handle)) {
      return failure(res, 409, 'CARD_EXISTS', `${handle} already exists`);
    }

    const fm: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name) fm.name = body.name;
    if (typeof body.kind === 'string' && body.kind) fm.kind = body.kind;
    if (typeof body.status === 'string' && body.status) fm.status = body.status;
    if (body.fields && typeof body.fields === 'object') {
      const fields = body.fields as Record<string, unknown>;
      const reserved = reservedFieldKeys(fields);
      if (reserved.length > 0) {
        return failure(
          res,
          400,
          'INVALID_FIELDS',
          `fields cannot contain reserved keys: ${reserved.join(', ')}`,
        );
      }
      Object.assign(fm, fields);
    }
    if (Array.isArray(body.connections) && body.connections.length > 0) {
      fm.connections = body.connections.map((c) => String(c).toUpperCase());
    }

    const relPath = await createCardFile(
      plan.root,
      handle,
      fm,
      typeof body.body === 'string' ? body.body : '',
    );
    const after = await lintPlan(plan.root);
    const created = after.index.cards.get(handle);
    json(res, 201, {
      card: created ? await cardPayload(created) : null,
      issues: issuesForFile(after.issues, relPath),
    });
  }

  async function handleDeleteCard(
    plan: PlanState,
    handle: string,
    res: http.ServerResponse,
  ): Promise<void> {
    const lint = await lintPlan(plan.root);
    const card = lint.index.cards.get(handle.toUpperCase());
    if (!card) return failure(res, 404, 'NOT_FOUND', `No card ${handle}`);
    if (card.handle === 'PLAN-PROJECT') {
      return failure(
        res,
        400,
        'INVALID_HANDLE',
        'PLAN-PROJECT (plan.md) is the plan root card and cannot be deleted.',
      );
    }
    const referencedBy = structuredReferrers(lint.index, card.handle);
    await deleteCardFile(card.filePath);
    json(res, 200, { deleted: card.handle, referenced_by: referencedBy });
  }

  /**
   * Stamp the sync marker at HEAD — the same write `set_sync_point` performs,
   * exposed so the dashboard's health strip can do it without dropping to the
   * MCP tools. Returns the recomputed status so the client can render the new
   * verdict from one round trip (the marker is what gives unverified claim
   * cards a drift baseline, so the whole strip changes). An optional
   * `format_review: true` in the body closes out the one-time format-upgrade
   * review at the same time — the same field `set_sync_point` stamps.
   */
  async function handleSetSyncPoint(
    plan: PlanState,
    body: Record<string, unknown>,
    res: http.ServerResponse,
  ): Promise<void> {
    let marker;
    try {
      marker = await writeSyncPoint(
        plan.root,
        undefined,
        body.format_review === true ? { formatReview: CONSTELLATION_VERSION } : {},
      );
    } catch (err) {
      // No git repo (or no commits yet) — there is no HEAD to pin the plan to.
      return failure(
        res,
        409,
        'NO_GIT',
        `Cannot set a sync point: ${err instanceof Error ? err.message : 'no git HEAD'}`,
      );
    }
    json(res, 200, { marker, sync: await computeSyncStatus(plan.root) });
  }

  function handleEvents(
    plan: PlanState,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write('data: connected\n\n');
    plan.sse.add(res);
    req.on('close', () => plan.sse.delete(res));
  }

  // THE REQUEST GUARD. The server listens on loopback, but a web page in the
  // same browser can still reach it: a cross-site form POST (text/plain needs
  // no preflight) or a DNS-rebound hostname. So every request must name this
  // server in Host — a rebound name never does — and every write must carry a
  // same-server Origin, which browsers send on every non-GET request and a
  // cross-site page cannot forge.
  const devHosts = (options.devOrigins ?? []).flatMap(devOriginHosts);
  function guard(req: http.IncomingMessage, method: string): string | null {
    const hosts = new Set([...loopbackHosts(boundPort()), ...devHosts]);
    const host = (req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) return `Host "${host}" is not this server`;
    if (WRITE_METHODS.has(method)) {
      const origin = (req.headers.origin ?? '').toLowerCase();
      if (!origin) return 'Writes need an Origin header';
      if (![...hosts].some((h) => origin === `http://${h}`)) {
        return `Origin "${origin}" may not write to this server`;
      }
    }
    return null;
  }
  function boundPort(): number {
    const address = server.address();
    return typeof address === 'object' && address ? address.port : options.port;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    const refused = guard(req, method);
    if (refused) return failure(res, 403, 'FORBIDDEN', refused);

    try {
      // Exact-match the roster first. The prefix regex below requires /api/p/
      // and therefore cannot match /api/plans.
      if (url.pathname === '/api/plans') {
        if (method === 'GET') return await handleGetPlans(res);
        return failure(res, 404, 'NOT_FOUND', 'API route not found');
      }

      let plan = defaultState;
      let route = url.pathname;
      const prefixMatch = /^\/api\/p\/([^/]+)(\/.*)?$/.exec(url.pathname);
      if (prefixMatch) {
        const selected = planById.get(prefixMatch[1]);
        if (!selected) {
          return failure(
            res,
            404,
            'UNKNOWN_PLAN',
            `Unknown plan "${prefixMatch[1]}". Known plans: ${plans.map((p) => p.id).join(', ')}`,
          );
        }
        plan = selected;
        const suffix = prefixMatch[2] ?? '';
        route = suffix === '/events' ? '/events' : `/api${suffix}`;
      }

      const cardMatch = /^\/api\/card\/([^/]+)$/.exec(route);
      if (route === '/api/plan' && method === 'GET') {
        return await handleGetPlan(plan, res);
      }
      if (route === '/api/sync' && method === 'GET') {
        return json(res, 200, await computeSyncStatus(plan.root));
      }
      if (route === '/api/atlas-metrics' && method === 'GET') {
        return await handleGetAtlasMetrics(plan, res);
      }
      if (route === '/api/atlas-config' && method === 'GET') {
        return json(res, 200, await readAtlasConfig(plan.root));
      }
      if (route === '/api/docs' && method === 'GET') {
        return await handleGetDocs(plan, res);
      }
      if (route === '/api/style-asset' && method === 'GET') {
        return await handleStyleAsset(plan, url, res);
      }
      if (route === '/events' && method === 'GET') {
        return handleEvents(plan, req, res);
      }

      const isWrite =
        (cardMatch && (method === 'PATCH' || method === 'DELETE')) ||
        (route === '/api/cards' && method === 'POST') ||
        (route === '/api/atlas-config' && method === 'PUT') ||
        (route === '/api/sync-point' && method === 'POST');
      if (isWrite) {
        if (!editable) {
          return failure(res, 405, 'READONLY', 'Server is running with --readonly');
        }
        if (route === '/api/sync-point') {
          return await handleSetSyncPoint(plan, await readJson(req), res);
        }
        if (route === '/api/atlas-config') {
          return json(res, 200, await writeAtlasConfig(plan.root, await readJson(req)));
        }
        if (cardMatch && method === 'PATCH') {
          return await handlePatchCard(
            plan,
            decodeURIComponent(cardMatch[1]),
            await readJson(req),
            res,
          );
        }
        if (cardMatch && method === 'DELETE') {
          return await handleDeleteCard(plan, decodeURIComponent(cardMatch[1]), res);
        }
        return await handleCreateCard(plan, await readJson(req), res);
      }

      if (url.pathname.startsWith('/api/')) {
        return failure(res, 404, 'NOT_FOUND', 'API route not found');
      }
      await serveStatic(route, res);
    } catch (err) {
      if (err instanceof PathEscapeError) {
        return failure(res, 403, 'FORBIDDEN', err.message);
      }
      if (err instanceof RequestBodyError) {
        return failure(res, err.status, err.code, err.message);
      }
      failure(res, 500, 'INTERNAL', err instanceof Error ? err.message : 'error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => resolve());
  });
  try {
    for (const plan of [...plans]) {
      try {
        plan.watcher = watch(plan.root, { recursive: true }, () => {
        plan.metrics = null;
        plan.cardCount = null;
        if (plan.debounce) clearTimeout(plan.debounce);
        plan.debounce = setTimeout(() => {
          plan.debounce = null;
          for (const client of plan.sse) client.write('data: change\n\n');
        }, 150);
      });
      plan.watcher.on('error', (err) => {
        console.error(`constellation serve: file watcher error: ${err.message}`);
      });
      } catch (err) {
        // This repo's own plans must watch or serve fails, as before. A
        // connected repo that can't be watched (EMFILE, EACCES) becomes an
        // unavailable row rather than taking the whole server down.
        if (plan.repo.kind !== 'connected') throw err;
        dropConnectedPlan(plan, `Cannot watch ${plan.repo.path}: ${errMessage(err)}`);
      }
    }
  } catch (err) {
    for (const plan of plans) plan.watcher?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw err;
  }
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;

  return {
    server,
    port,
    plans: plans.map(publicPlan),
    unavailable,
    defaultPlan,
    multi,
    close: async () => {
      for (const plan of plans) {
        if (plan.debounce) clearTimeout(plan.debounce);
        plan.debounce = null;
        plan.watcher?.close();
        plan.watcher = null;
        for (const client of plan.sse) client.end();
        plan.sse.clear();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function normalizePlans(options: ServeOptions): Promise<{
  plans: PlanState[];
  unavailable: UnavailableWorkspace[];
  order: Array<PlanState | UnavailableWorkspace>;
  defaultPlan: string;
  scanRoot: string;
}> {
  const singlePlanRoot = options.planRoot;
  const scanRoot = path.resolve(
    singlePlanRoot === undefined ? options.scanRoot : path.dirname(singlePlanRoot),
  );
  const discovered: DiscoveredPlan[] =
    singlePlanRoot !== undefined
      ? [
          {
            root: path.resolve(singlePlanRoot),
            codeRoot: await codeRootFor(singlePlanRoot),
            relPath: '',
          },
        ]
      : options.plans;
  const identified =
    singlePlanRoot !== undefined
      ? [{ ...discovered[0], id: 'root', aliases: [] }]
      : identifyPlans(discovered);
  if (identified.length === 0) throw new Error('Cannot serve an empty plan set');

  const selfRepo: PlanRepo = {
    name: path.basename(scanRoot) || scanRoot,
    path: '.',
    root: scanRoot,
    kind: 'self',
  };
  const plans = await Promise.all(
    identified.map((plan) => planState(plan, selfRepo, scanRoot, scanRoot)),
  );
  const requestedDefault = singlePlanRoot === undefined ? options.defaultPlan : 'root';
  let defaultState: PlanState;
  if (requestedDefault) {
    const selected = plans.find(
      (plan) => plan.id === requestedDefault || plan.aliases.includes(requestedDefault),
    );
    if (!selected) {
      throw new Error(
        `Unknown default plan "${requestedDefault}". Known plans: ${plans.map((p) => p.id).join(', ')}`,
      );
    }
    defaultState = selected;
  } else {
    defaultState = plans.find((plan) => plan.id === 'root') ?? plans[0];
  }
  // Connected repos come from the launching repo's root plan (else the default
  // plan), read once at startup — so the workspace set is the same whichever
  // workspace the viewer is in.
  const home = plans.find((plan) => plan.id === 'root') ?? defaultState;
  const connected = await connectedPlans(home.root, plans);
  return {
    plans: [...plans, ...connected.plans],
    unavailable: connected.unavailable,
    order: [...plans, ...connected.order],
    defaultPlan: defaultState.id,
    scanRoot,
  };
}

async function planState(
  plan: IdentifiedPlan,
  repo: PlanRepo,
  scanRoot: string,
  assetRoot: string,
): Promise<PlanState> {
  return {
    ...plan,
    root: path.resolve(plan.root),
    codeRoot: path.resolve(plan.codeRoot),
    name: await planName(plan.root, path.basename(plan.codeRoot)),
    repo,
    scanRoot: path.resolve(scanRoot),
    assetRoot: path.resolve(assetRoot),
    repoUrl: undefined,
    codePrefix: undefined,
    metrics: null,
    cardCount: await countPlanCards(plan.root),
    sse: new Set(),
    watcher: null,
    debounce: null,
  };
}

/**
 * The connected repos' plans, one level deep. Ids derive from the
 * `connected_repos` name — `<name>` for a repo's root plan, `<name>-<id>` for a
 * nested one — and never take an id or alias this repo's plans already hold;
 * a clash gets `-2`, `-3` in declaration order. An unavailable repo still
 * reserves its id, so a repo coming back never shifts its neighbours' ids. A
 * plan already served (a connected path inside this repo) is not served twice.
 */
async function connectedPlans(
  homeRoot: string,
  selfPlans: PlanState[],
): Promise<{
  plans: PlanState[];
  unavailable: UnavailableWorkspace[];
  order: Array<PlanState | UnavailableWorkspace>;
}> {
  const used = new Set<string>(['root']);
  for (const plan of selfPlans) {
    used.add(plan.id);
    for (const alias of plan.aliases) used.add(alias);
  }
  const seen = new Set(await Promise.all(selfPlans.map((plan) => realOr(plan.root))));
  const plans: PlanState[] = [];
  const unavailable: UnavailableWorkspace[] = [];
  const order: Array<PlanState | UnavailableWorkspace> = [];

  for (const ws of await discoverConnectedWorkspaces(homeRoot)) {
    const base = slugify(ws.repo.name) || 'repo';
    const repo: PlanRepo = {
      name: ws.repo.name,
      path: ws.repo.path,
      root: ws.available ? ws.scanRoot : ws.abs,
      kind: 'connected',
      ...(ws.repo.description ? { description: ws.repo.description } : {}),
    };
    if (!ws.available) {
      const down = { id: uniqueKey(base, used), repo, reason: ws.reason };
      unavailable.push(down);
      order.push(down);
      continue;
    }
    for (const plan of identifyPlans(ws.plans)) {
      const real = await realOr(plan.root);
      if (seen.has(real)) continue;
      seen.add(real);
      const id = uniqueKey(plan.id === 'root' ? base : `${base}-${plan.id}`, used);
      const aliases = plan.aliases
        .map((alias) => `${base}-${alias}`)
        .filter((alias) => !used.has(alias));
      for (const alias of aliases) used.add(alias);
      try {
        const state = await planState({ ...plan, id, aliases }, repo, ws.scanRoot, ws.gitRoot);
        plans.push(state);
        order.push(state);
      } catch (err) {
        // An unreadable plan (EACCES on a card folder) costs its own row, never
        // the server start.
        const down = { id, repo, reason: `Cannot read ${repo.path}: ${errMessage(err)}` };
        unavailable.push(down);
        order.push(down);
      }
    }
  }
  return { plans, unavailable, order };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function realOr(p: string): Promise<string> {
  return realpath(p).catch(() => path.resolve(p));
}

async function planName(planRoot: string, fallback: string): Promise<string> {
  try {
    const raw = await readFile(path.join(planRoot, 'plan.md'), 'utf8');
    const name = parseFile(raw).frontmatter.name;
    return typeof name === 'string' && name ? name : fallback;
  } catch {
    return fallback;
  }
}

async function cardCountFor(plan: PlanState): Promise<number> {
  if (plan.cardCount === null) plan.cardCount = await countPlanCards(plan.root);
  return plan.cardCount;
}

function containedPath(root: string, rel: string): string | null {
  const resolvedRoot = path.resolve(root);
  const abs = path.resolve(resolvedRoot, rel);
  return abs === resolvedRoot || abs.startsWith(resolvedRoot + path.sep) ? abs : null;
}

/**
 * Read `rel` under `root`, refusing anything that leaves it — lexically
 * (`../`, absolute paths) or through a symlink, which a lexical check alone
 * would follow: the file's REAL path must sit inside the root's real path.
 * `missing` lets the caller try its next root; any other read failure is
 * reported as missing too, never as content.
 */
async function readContained(root: string, rel: string): Promise<Buffer | 'missing' | 'escape'> {
  const candidate = containedPath(root, rel);
  if (!candidate) return 'escape';
  let real: string;
  let realRoot: string;
  try {
    [real, realRoot] = await Promise.all([realpath(candidate), realpath(root)]);
  } catch {
    return 'missing';
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return 'escape';
  try {
    return await readFile(real);
  } catch {
    return 'missing';
  }
}

function publicPlan(plan: PlanState): ServedPlan {
  return {
    id: plan.id,
    aliases: plan.aliases,
    root: plan.root,
    codeRoot: plan.codeRoot,
    relPath: plan.relPath,
    name: plan.name,
    repo: plan.repo,
  };
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 2 * 1024 * 1024) {
      throw new RequestBodyError(413, 'BODY_TOO_LARGE', 'Request body too large');
    }
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new RequestBodyError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RequestBodyError(400, 'INVALID_BODY', 'Expected a JSON object body');
  }
  return parsed as Record<string, unknown>;
}

async function serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(VIEWER_DIST, safe);
  // Allow VIEWER_DIST itself and anything strictly beneath it; the trailing
  // separator stops a sibling like `viewer/dist-evil` from passing startsWith.
  if (filePath !== VIEWER_DIST && !filePath.startsWith(VIEWER_DIST + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    // SPA fallback: unknown paths get the shell.
    filePath = path.join(VIEWER_DIST, 'index.html');
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end(
      'Viewer assets not found. Reinstall @magic-spells/constellation, or run ' +
        '`npm run build:viewer` if developing from source.',
    );
  }
}
