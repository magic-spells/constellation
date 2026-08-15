import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { buildServer, MCP_SERVER_VERSION } from '../src/mcp/server.js';

const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../package.json') as { version: string };

// describe_type is plan-independent, but the server still resolves a plan root for
// other tools; point it at the golden plan so construction is realistic.
const planRoot = fileURLToPath(new URL('../examples/constellation', import.meta.url));

let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const content = res.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

beforeAll(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({ planRoot });
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

describe('describe_type', () => {
  it('advertises the package version, not a hardcoded leftover', () => {
    expect(MCP_SERVER_VERSION).toBe(PACKAGE_VERSION);
    expect(MCP_SERVER_VERSION).not.toBe('0.2.2');
  });

  it('catalogs all 21 types with prefix, folder, and purpose', async () => {
    const { types } = await call('describe_type');
    expect(types).toHaveLength(21);
    const page = types.find((t: { type: string }) => t.type === 'PAGE');
    expect(page.prefix).toBe('PAGE-');
    expect(page.folder).toBe('page');
    expect(page.purpose.length).toBeGreaterThan(0);
    // post-rename types are present; the old prefixes are gone
    expect(types.map((t: { type: string }) => t.type)).toContain('DIAGRAM');
    expect(types.map((t: { type: string }) => t.type)).toContain('EXTERNAL');
    expect(types.map((t: { type: string }) => t.type)).toContain('DECISION');
    expect(types.map((t: { type: string }) => t.type)).toContain('FEATURE');
    expect(types.map((t: { type: string }) => t.type)).toContain('RELEASE');
    expect(types.map((t: { type: string }) => t.type)).toContain('STYLE');
  });

  it('describes STYLE with its token schema', async () => {
    const res = await call('describe_type', { type: 'STYLE' });
    expect(res.folder).toBe('style');
    expect(res.schema.properties.tokens).toBeDefined();
    expect(res.schema.properties.category.enum).toContain('color');
  });

  it('describes one type with its schema, reference, and reserved keys', async () => {
    const res = await call('describe_type', { type: 'PAGE' });
    expect(res.type).toBe('PAGE');
    expect(res.prefix).toBe('PAGE-');
    expect(res.folder).toBe('page');
    expect(res.reserved).toContain('connections');
    expect(res.schema && typeof res.schema).toBe('object');
    expect(typeof res.reference).toBe('string');
    expect(res.reference.length).toBeGreaterThan(0);
  });
});
