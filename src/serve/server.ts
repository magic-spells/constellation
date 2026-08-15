import { watch } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeSyncPoint } from '../core/git.js';
import { isHandleShaped, typeForHandle } from '../core/handles.js';
import { lintPlan } from '../core/lint.js';
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

export interface ServeOptions {
  planRoot: string;
  port: number;
  readonly?: boolean;
}

export interface RunningServer {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(options: ServeOptions): Promise<RunningServer> {
  const { planRoot } = options;
  const editable = !options.readonly;
  const sseClients = new Set<http.ServerResponse>();

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

  // Watch the plan folder; tell connected browsers to refetch on any change.
  let debounce: NodeJS.Timeout | null = null;
  let watcher: ReturnType<typeof watch> | null = null;

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

  async function handleGetPlan(res: http.ServerResponse): Promise<void> {
    const lint = await lintPlan(planRoot);
    const cards = await Promise.all(
      [...lint.index.cards.values()]
        .sort((a, b) => a.handle.localeCompare(b.handle))
        .map(cardPayload),
    );
    json(res, 200, {
      editable,
      cards,
      connections: lint.index.connections,
      errors: lint.errors,
      warnings: lint.warnings,
    });
  }

  // Read-only: hands the viewer real font bytes so STYLE specimens can @font-face
  // the project's own fonts. Confined to the repo root (the plan folder's parent).
  async function handleStyleAsset(url: URL, res: http.ServerResponse): Promise<void> {
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
    const repoRoot = path.dirname(path.resolve(planRoot));
    const abs = path.resolve(repoRoot, rel);
    if (abs !== repoRoot && !abs.startsWith(repoRoot + path.sep)) {
      return failure(res, 403, 'FORBIDDEN', 'path escapes the repository');
    }
    try {
      const content = await readFile(abs);
      res.writeHead(200, { 'content-type': MIME[ext], 'cache-control': 'no-cache' });
      res.end(content);
    } catch {
      failure(res, 404, 'NOT_FOUND', `No file at ${rel}`);
    }
  }

  async function handlePatchCard(
    handle: string,
    body: Record<string, unknown>,
    res: http.ServerResponse,
  ): Promise<void> {
    const lint = await lintPlan(planRoot);
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

    const after = await lintPlan(planRoot);
    const updated = after.index.cards.get(card.handle);
    json(res, 200, {
      card: updated ? await cardPayload(updated) : null,
      issues: issuesForFile(after.issues, card.relPath),
    });
  }

  async function handleCreateCard(
    body: Record<string, unknown>,
    res: http.ServerResponse,
  ): Promise<void> {
    const handle = String(body.handle ?? '').toUpperCase();
    if (!isHandleShaped(handle) || !typeForHandle(handle)) {
      return failure(res, 400, 'INVALID_HANDLE', `${body.handle} is not a valid handle`);
    }
    const lint = await lintPlan(planRoot);
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
      planRoot,
      handle,
      fm,
      typeof body.body === 'string' ? body.body : '',
    );
    const after = await lintPlan(planRoot);
    const created = after.index.cards.get(handle);
    json(res, 201, {
      card: created ? await cardPayload(created) : null,
      issues: issuesForFile(after.issues, relPath),
    });
  }

  async function handleDeleteCard(
    handle: string,
    res: http.ServerResponse,
  ): Promise<void> {
    const lint = await lintPlan(planRoot);
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
   * cards a drift baseline, so the whole strip changes).
   */
  async function handleSetSyncPoint(res: http.ServerResponse): Promise<void> {
    let marker;
    try {
      marker = await writeSyncPoint(planRoot);
    } catch (err) {
      // No git repo (or no commits yet) — there is no HEAD to pin the plan to.
      return failure(
        res,
        409,
        'NO_GIT',
        `Cannot set a sync point: ${err instanceof Error ? err.message : 'no git HEAD'}`,
      );
    }
    json(res, 200, { marker, sync: await computeSyncStatus(planRoot) });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    const cardMatch = /^\/api\/card\/([^/]+)$/.exec(url.pathname);

    try {
      if (url.pathname === '/api/plan' && method === 'GET') {
        return await handleGetPlan(res);
      }
      if (url.pathname === '/api/sync' && method === 'GET') {
        return json(res, 200, await computeSyncStatus(planRoot));
      }
      if (url.pathname === '/api/style-asset' && method === 'GET') {
        return await handleStyleAsset(url, res);
      }
      if (url.pathname === '/events' && method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write('data: connected\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      const isWrite =
        (cardMatch && (method === 'PATCH' || method === 'DELETE')) ||
        (url.pathname === '/api/cards' && method === 'POST') ||
        (url.pathname === '/api/sync-point' && method === 'POST');
      if (isWrite) {
        if (!editable) {
          return failure(res, 405, 'READONLY', 'Server is running with --readonly');
        }
        if (url.pathname === '/api/sync-point') {
          return await handleSetSyncPoint(res);
        }
        if (cardMatch && method === 'PATCH') {
          return await handlePatchCard(
            decodeURIComponent(cardMatch[1]),
            await readJson(req),
            res,
          );
        }
        if (cardMatch && method === 'DELETE') {
          return await handleDeleteCard(decodeURIComponent(cardMatch[1]), res);
        }
        return await handleCreateCard(await readJson(req), res);
      }

      await serveStatic(url.pathname, res);
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
    watcher = watch(planRoot, { recursive: true }, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        for (const client of sseClients) client.write('data: change\n\n');
      }, 150);
    });
    watcher.on('error', (err) => {
      console.error(`constellation serve: file watcher error: ${err.message}`);
    });
  } catch (err) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw err;
  }
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;

  return {
    server,
    port,
    close: async () => {
      if (debounce) clearTimeout(debounce);
      watcher?.close();
      for (const client of sseClients) client.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
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
