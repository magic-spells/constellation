import { watch } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAtlasConfig, writeAtlasConfig } from '../core/atlas-config.js';
import { codeMetrics, type CodeMetric } from '../core/code.js';
import { compileDocs, prepareDocBody } from '../core/docs.js';
import { planRootsFor, repoRemoteUrl, writeSyncPoint } from '../core/git.js';
import { CONSTELLATION_VERSION } from '../core/version.js';
import { isHandleShaped, typeForHandle } from '../core/handles.js';
import { lintPlan } from '../core/lint.js';
import { parseFile } from '../core/parse.js';
import { codeRootFor } from '../core/repos.js';
import {
  countPlanCards,
  identifyPlans,
  type DiscoveredPlan,
} from '../core/resolve.js';
import { computeSyncStatus } from '../core/sync.js';
import type { Card, Issue } from '../core/types.js';
import {
  applyCardPatch,
  createCardFile,
  mutateCardFile,
  reservedFieldKeys,
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

export interface ServedPlan {
  id: string;
  aliases: string[];
  root: string;
  codeRoot: string;
  relPath: string;
  name: string;
}

export interface RunningServer {
  server: http.Server;
  port: number;
  plans: ServedPlan[];
  defaultPlan: string;
  multi: boolean;
  close: () => Promise<void>;
}

interface PlanState extends ServedPlan {
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
  const defaultPlan = normalized.defaultPlan;
  const multi = plans.length > 1;
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

  async function handleGetPlans(res: http.ServerResponse): Promise<void> {
    const roster = await Promise.all(
      plans.map(async (plan) => ({
        id: plan.id,
        aliases: plan.aliases,
        name: plan.name,
        code_path: plan.relPath,
        plan_path: toPosix(path.relative(scanRoot, plan.root)),
        cards: await cardCountFor(plan),
        default: plan.id === defaultPlan,
      })),
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
  // Resolve against the plan's code root first, then the scan/git root for shared assets.
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
    const codeAsset = containedPath(plan.codeRoot, rel);
    if (!codeAsset) {
      return failure(res, 403, 'FORBIDDEN', 'path escapes the repository');
    }
    try {
      const content = await readFile(codeAsset);
      res.writeHead(200, { 'content-type': MIME[ext], 'cache-control': 'no-cache' });
      res.end(content);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return failure(res, 404, 'NOT_FOUND', `No file at ${rel}`);
      }
    }

    if (path.resolve(plan.codeRoot) !== scanRoot) {
      const sharedAsset = containedPath(scanRoot, rel);
      if (!sharedAsset) {
        return failure(res, 403, 'FORBIDDEN', 'path escapes the repository');
      }
      try {
        const content = await readFile(sharedAsset);
        res.writeHead(200, { 'content-type': MIME[ext], 'cache-control': 'no-cache' });
        res.end(content);
        return;
      } catch {
        // Fall through to the stable not-found response below.
      }
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

    if (typeof body.if_mtime === 'number' && body.if_mtime !== 0) {
      const current = Math.round((await stat(card.filePath)).mtimeMs);
      if (current !== body.if_mtime) {
        return failure(res, 409, 'STALE', `${card.handle} changed on disk`);
      }
    }

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
    await mutateCardFile(card.filePath, (current) => ({
      frontmatter: hasPatch ? applyCardPatch(current.frontmatter, patch) : undefined,
      body: typeof patch.body === 'string' ? patch.body : undefined,
    }));

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
    const referencedBy = [
      ...(lint.index.connectedHandles.get(card.handle) ?? []),
    ].sort();
    await rm(card.filePath);
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

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

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
    for (const plan of plans) {
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

  const plans = await Promise.all(
    identified.map(async (plan): Promise<PlanState> => ({
      ...plan,
      root: path.resolve(plan.root),
      codeRoot: path.resolve(plan.codeRoot),
      name: await planName(plan.root, path.basename(plan.codeRoot)),
      repoUrl: undefined,
      codePrefix: undefined,
      metrics: null,
      cardCount: await countPlanCards(plan.root),
      sse: new Set(),
      watcher: null,
      debounce: null,
    })),
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
  return { plans, defaultPlan: defaultState.id, scanRoot };
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

function publicPlan(plan: PlanState): ServedPlan {
  return {
    id: plan.id,
    aliases: plan.aliases,
    root: plan.root,
    codeRoot: plan.codeRoot,
    relPath: plan.relPath,
    name: plan.name,
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
