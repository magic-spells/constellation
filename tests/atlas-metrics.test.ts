import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/serve/server.js';

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

const ROUTE = 'export function listTickets() {\n  return [];\n}\n';
const TICKET_TYPE = 'export interface Ticket {\n  id: string;\n}\n';
const USER_TYPE = 'export interface User {\n  id: string;\n}\n';
const TOKENS = ':root {\n  --ink: #111827;\n}\n';

let repo: string;
let server: RunningServer;

/** Bound code only resolves against a git repo root, so the fixture is one. */
function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(repo, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
}

async function metrics(): Promise<Record<string, { files: number; bytes: number; lines: number }>> {
  const res = await fetch(`http://localhost:${server.port}/api/atlas-metrics`);
  expect(res.status).toBe(200);
  return await res.json();
}

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-atlas-metrics-'));
  const planRoot = path.join(repo, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });

  // The files the golden cards already bind to: FILE-TICKETS-ROUTE.path,
  // DATATYPE-TICKET's `path:symbol` code_ref, and the STYLE cards' token sheet.
  await write('src/api/tickets.ts', ROUTE);
  await write('src/types/ticket.ts', TICKET_TYPE);
  await write('src/types/user.ts', USER_TYPE);
  await write('src/types/node_modules/pkg.js', 'module.exports = {};\n');
  await write('src/styles/tokens.css', TOKENS);

  await write(
    'constellation/doc/DOC-ATLAS-DIR.md',
    '---\nname: Types folder\nstatus: built\ncode_refs:\n  - src/types\n---\n\nBinds a folder.\n',
  );
  await write(
    'constellation/doc/DOC-ATLAS-GONE.md',
    '---\nname: Moved code\nstatus: built\ncode_refs:\n  - src/gone.ts\n---\n\nBinds a file that moved.\n',
  );

  git('init', '-b', 'main');
  server = await startServer({ planRoot, port: 0 });
});

afterAll(async () => {
  await server.close();
  await rm(repo, { recursive: true, force: true });
});

describe('GET /api/atlas-metrics', () => {
  it('measures a card bound through a connected FILE card', async () => {
    // API-TICKETS holds no path of its own; FILE-TICKETS-ROUTE is the binding.
    expect((await metrics())['API-TICKETS']).toEqual({
      files: 1,
      bytes: Buffer.byteLength(ROUTE),
      lines: 3,
    });
  });

  it("measures a FILE card's own path", async () => {
    expect((await metrics())['FILE-TICKETS-ROUTE']).toEqual({
      files: 1,
      bytes: Buffer.byteLength(ROUTE),
      lines: 3,
    });
  });

  it('measures a card bound through its own code_refs', async () => {
    expect((await metrics())['STYLE-COLORS']).toEqual({
      files: 1,
      bytes: Buffer.byteLength(TOKENS),
      lines: 3,
    });
  });

  it('measures a path:symbol code_ref as the whole file', async () => {
    expect((await metrics())['DATATYPE-TICKET']).toEqual({
      files: 1,
      bytes: Buffer.byteLength(TICKET_TYPE),
      lines: 3,
    });
  });

  it('walks a directory binding and skips vendored trees', async () => {
    expect((await metrics())['DOC-ATLAS-DIR']).toEqual({
      files: 2,
      bytes: Buffer.byteLength(TICKET_TYPE) + Buffer.byteLength(USER_TYPE),
      lines: 6,
    });
  });

  it('reports zeros for a binding whose file is gone', async () => {
    expect((await metrics())['DOC-ATLAS-GONE']).toEqual({ files: 0, bytes: 0, lines: 0 });
  });

  it('omits cards with no bound code', async () => {
    const data = await metrics();
    expect(data).not.toHaveProperty('PLAN-PROJECT');
    expect(data).not.toHaveProperty('DB-TICKETS');
  });
});
