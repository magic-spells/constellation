import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPlan } from '../src/core/indexer.js';

const GOLDEN = fileURLToPath(
  new URL('../examples/constellation', import.meta.url),
);

describe('loadPlan on the golden example', () => {
  it('loads one card of every type plus the root plan', async () => {
    const index = await loadPlan(GOLDEN);
    expect(index.cards.size).toBe(18);
    const types = new Set([...index.cards.values()].map((c) => c.type));
    expect(types.size).toBe(17);
  });

  it('maps root plan.md to PLAN-PROJECT', async () => {
    const index = await loadPlan(GOLDEN);
    const plan = index.cards.get('PLAN-PROJECT');
    expect(plan).toBeDefined();
    expect(plan!.type).toBe('PLAN');
    expect(plan!.relPath).toBe('plan.md');
  });

  it('has no structural issues', async () => {
    const index = await loadPlan(GOLDEN);
    expect(index.issues).toEqual([]);
  });

  it('derives connections from frontmatter fields (response_schema etc.)', async () => {
    const index = await loadPlan(GOLDEN);
    expect(index.connectedHandles.get('DATATYPE-TICKET')).toContain('API-TICKETS');
    expect(index.connectedHandles.get('DATATYPE-TICKET')).toContain(
      'COMPONENT-TICKET-CARD',
    );
  });

  it('derives connections from mermaid node IDs (reverse view answers "what points at X")', async () => {
    const index = await loadPlan(GOLDEN);
    expect(index.connectedHandles.get('EXTERNAL-EMAIL-PROVIDER')).toContain(
      'DIAGRAM-SYSTEM-OVERVIEW',
    );
  });

  it('derives connections from body wiki-links', async () => {
    const index = await loadPlan(GOLDEN);
    expect(index.connectedHandles.get('FLOW-CREATE-TICKET')).toContain(
      'EVENT-TICKET-CREATED',
    );
  });

  it('dedupes connections declared from both sides and multiple sources', async () => {
    const index = await loadPlan(GOLDEN);
    const between = index.connections.filter(
      (e) =>
        (e.a === 'API-TICKETS' && e.b === 'DB-TICKETS') ||
        (e.a === 'DB-TICKETS' && e.b === 'API-TICKETS'),
    );
    expect(between).toHaveLength(1);
  });
});
