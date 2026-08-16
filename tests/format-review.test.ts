import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatReviewVersion,
  readSyncMarker,
  readSyncPoint,
  stampFormatReview,
  writeSyncPoint,
} from '../src/core/git.js';
import { initPlan } from '../src/core/scaffold.js';
import {
  bootInstructions,
  createServer,
  INSTRUCTIONS,
  MCP_SERVER_VERSION,
} from '../src/mcp/server.js';
import { CONSTELLATION_VERSION } from '../src/core/version.js';

// The 0.5.0 upgrade-review marker: `format_review` in .sync.json. Absent (or no
// marker file at all) means the plan has never been reviewed under the current
// format rules, which is what the boot notice and orient's flag key off.

const GOLDEN = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let repo: string;
let planRoot: string;
const clients: Client[] = [];

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/** A repo with the golden plan committed and no marker file. */
beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-review-'));
  planRoot = path.join(repo, 'constellation');
  await cp(GOLDEN, planRoot, { recursive: true });
  git('init', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial plan');
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await rm(repo, { recursive: true, force: true });
});

async function connect(root = planRoot) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = await createServer({ planRoot: root });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

describe('the .sync.json marker', () => {
  it('carries format_review alongside the sync point, in both directions', async () => {
    expect(await readSyncMarker(planRoot)).toBeNull();
    expect(await formatReviewVersion(planRoot)).toBeNull();

    const point = await writeSyncPoint(planRoot, undefined, { formatReview: '0.5.0' });
    expect(point.format_review).toBe('0.5.0');
    expect(point.synced_sha).toMatch(/^[0-9a-f]{40}$/);

    const readBack = await readSyncPoint(planRoot);
    expect(readBack?.format_review).toBe('0.5.0');
    expect(readBack?.synced_sha).toBe(point.synced_sha);
    expect(await formatReviewVersion(planRoot)).toBe('0.5.0');
  });

  it('a later sync point keeps the review stamp, and a review keeps the sync point', async () => {
    const first = await writeSyncPoint(planRoot, undefined, { formatReview: '0.5.0' });
    // Plain re-stamp of the commit — must not drop the review.
    const second = await writeSyncPoint(planRoot);
    expect(second.format_review).toBe('0.5.0');
    expect(second.synced_sha).toBe(first.synced_sha);

    // Review-only stamp — must not drop the commit.
    const marker = await stampFormatReview(planRoot, '9.9.9');
    expect(marker.synced_sha).toBe(first.synced_sha);
    expect(marker.format_review).toBe('9.9.9');
  });

  it('a marker holding only format_review is not a sync point', async () => {
    await writeFile(
      path.join(planRoot, '.sync.json'),
      `${JSON.stringify({ format_review: '0.5.0' }, null, 2)}\n`,
    );
    expect(await readSyncPoint(planRoot)).toBeNull();
    expect(await formatReviewVersion(planRoot)).toBe('0.5.0');
  });
});

describe('set_sync_point format_review', () => {
  it('stamps the running version into the marker', async () => {
    const client = await connect();
    const before = await call(client, 'set_sync_point');
    expect(before.format_review).toBeUndefined();

    const after = await call(client, 'set_sync_point', { format_review: true });
    expect(after.format_review).toBe(MCP_SERVER_VERSION);
    expect(await formatReviewVersion(planRoot)).toBe(MCP_SERVER_VERSION);
  });

  it('records the review even with no git HEAD to pin a sync point to', async () => {
    const bare = await mkdtemp(path.join(tmpdir(), 'constellation-nogit-'));
    try {
      const { root } = await initPlan(bare);
      await rm(path.join(root, '.sync.json'));
      const client = await connect(root);
      const res = await call(client, 'set_sync_point', { format_review: true });
      expect(res.format_review).toBe(MCP_SERVER_VERSION);
      expect(res.synced_sha).toBeUndefined();
      expect(res.warning).toMatch(/no git head/i);
    } finally {
      await rm(bare, { recursive: true, force: true });
    }
  });
});

describe('init_plan', () => {
  it('stamps format_review at creation, so a new plan never prompts', async () => {
    const fresh = await mkdtemp(path.join(tmpdir(), 'constellation-init-'));
    try {
      const { root } = await initPlan(fresh);
      const marker = await readSyncMarker(root);
      expect(marker?.format_review).toBe(CONSTELLATION_VERSION);
      // A brand new plan has reconciled nothing, so there is no sync point.
      expect(marker?.synced_sha).toBeUndefined();
      expect(await bootInstructions(root)).toBe(INSTRUCTIONS);
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });
});

describe('boot instructions', () => {
  it('append the upgrade notice when the plan has no review stamp', async () => {
    const client = await connect();
    const instructions = client.getInstructions() ?? '';
    expect(instructions.startsWith(INSTRUCTIONS)).toBe(true);
    expect(instructions).toContain(`first run on Constellation ${MCP_SERVER_VERSION}`);
    expect(instructions).toContain('set_sync_point format_review: true');
    expect(instructions).toContain('no longer form the connection graph');
  });

  it('are the static string once the plan is stamped', async () => {
    await stampFormatReview(planRoot, '0.5.0');
    const client = await connect();
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
  });

  it('are the static string when no plan resolves', async () => {
    expect(await bootInstructions(path.join(repo, 'nope'))).toBe(INSTRUCTIONS);
  });
});

describe('orient', () => {
  it('flags the pending review with a one-line hint', async () => {
    const client = await connect();
    const data = await call(client, 'orient');
    expect(data.upgrade_review_pending).toBe(true);
    expect(data.upgrade_review).toContain(`First run on ${MCP_SERVER_VERSION}`);
    expect(data.upgrade_review).toContain('format_review');
  });

  it('says nothing once the plan is stamped', async () => {
    await stampFormatReview(planRoot, MCP_SERVER_VERSION);
    const client = await connect();
    const data = await call(client, 'orient');
    expect(data.upgrade_review_pending).toBeUndefined();
    expect(data.upgrade_review).toBeUndefined();
  });
});
