import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPlan, neighborsOf } from '../src/core/indexer.js';

const GOLDEN = fileURLToPath(
  new URL('../examples/constellation', import.meta.url),
);

describe('loadPlan on the golden example', () => {
  it('loads every card type including the root plan', async () => {
    const index = await loadPlan(GOLDEN);
    expect(index.cards.size).toBe(25);
    const types = new Set([...index.cards.values()].map((c) => c.type));
    expect(types.size).toBe(21);
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

  it('wires a FEATURE to its RELEASE via the release: field', async () => {
    const index = await loadPlan(GOLDEN);
    expect(index.connectedHandles.get('FEATURE-AUTO-ASSIGNMENT')).toContain('RELEASE-V1-1-0');
    expect(index.connectedHandles.get('RELEASE-V1-1-0')).toContain('FEATURE-AUTO-ASSIGNMENT');
    expect(index.connectedHandles.get('FEATURE-AUTO-ASSIGNMENT')).toContain('JOB-AUTO-ASSIGN');
  });

  it('wires DECISION cards to the cards they shaped', async () => {
    const index = await loadPlan(GOLDEN);
    expect(index.connectedHandles.get('DECISION-NO-HARD-DELETE')).toContain('DB-TICKETS');
    expect(index.connectedHandles.get('DB-TICKETS')).toContain('DECISION-NO-HARD-DELETE');
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

  it('records where each connection came from', async () => {
    const index = await loadPlan(GOLDEN);
    const sources = (a: string, b: string) =>
      index.connections.find(
        (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
      )?.sources;
    // connections: only.
    expect(sources('API-TICKETS', 'DB-TICKETS')).toEqual(['structured']);
    // connections: plus a [[link]] — one edge carrying both sources.
    expect(sources('API-TICKETS', 'FILE-TICKETS-ROUTE')).toEqual([
      'structured',
      'prose',
    ]);
    // A mermaid node ID only.
    expect(sources('API-TICKETS', 'DIAGRAM-SYSTEM-OVERVIEW')).toEqual(['prose']);
  });

  it('splits the adjacency by source so a walk can skip prose edges', async () => {
    const index = await loadPlan(GOLDEN);
    expect(neighborsOf(index, 'API-TICKETS', 'structured')).toContain('DB-TICKETS');
    expect(neighborsOf(index, 'API-TICKETS', 'structured')).not.toContain(
      'DIAGRAM-SYSTEM-OVERVIEW',
    );
    expect(neighborsOf(index, 'API-TICKETS', 'prose')).toContain(
      'DIAGRAM-SYSTEM-OVERVIEW',
    );
    expect(neighborsOf(index, 'API-TICKETS', 'both')).toEqual(
      index.connectedHandles.get('API-TICKETS'),
    );
    // Every structured/prose neighbor is also in the union.
    for (const h of neighborsOf(index, 'API-TICKETS', 'prose')) {
      expect(index.connectedHandles.get('API-TICKETS')).toContain(h);
    }
  });
});
