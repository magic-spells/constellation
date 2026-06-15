import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/mcp/server.js';

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
  it('catalogs all 17 types with prefix, folder, and purpose', async () => {
    const { types } = await call('describe_type');
    expect(types).toHaveLength(17);
    const page = types.find((t: { type: string }) => t.type === 'PAGE');
    expect(page.prefix).toBe('PAGE-');
    expect(page.folder).toBe('page');
    expect(page.purpose.length).toBeGreaterThan(0);
    // post-rename types are present; the old prefixes are gone
    expect(types.map((t: { type: string }) => t.type)).toContain('DIAGRAM');
    expect(types.map((t: { type: string }) => t.type)).toContain('EXTERNAL');
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
