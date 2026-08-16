import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

  it('does NOT derive connections from body links or mermaid node IDs', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'constellation-links-'));
    try {
      await mkdir(path.join(dir, 'api'), { recursive: true });
      await mkdir(path.join(dir, 'db'), { recursive: true });
      await mkdir(path.join(dir, 'diagram'), { recursive: true });
      await writeFile(
        path.join(dir, 'api', 'API-THINGS.md'),
        '---\nname: Things\n---\n\nReads [[DB-THINGS]] on every call.\n',
      );
      await writeFile(path.join(dir, 'db', 'DB-THINGS.md'), '---\nname: things\n---\n\nA table.\n');
      await writeFile(
        path.join(dir, 'diagram', 'DIAGRAM-OVERVIEW.md'),
        '---\nname: Overview\n---\n\n```mermaid\nflowchart TD\n  API-THINGS --> DB-THINGS\n```\n',
      );

      const index = await loadPlan(dir);
      // A prose mention is a link, not a connection: the graph stays empty.
      expect(index.connections).toEqual([]);
      expect(neighborsOf(index, 'API-THINGS').size).toBe(0);
      expect(neighborsOf(index, 'DIAGRAM-OVERVIEW').size).toBe(0);
      // The refs are still extracted — the viewer renders them and lint checks them.
      expect(index.cards.get('API-THINGS')!.refs.body).toEqual(['DB-THINGS']);
      expect(index.cards.get('DIAGRAM-OVERVIEW')!.refs.mermaid).toEqual([
        'API-THINGS',
        'DB-THINGS',
      ]);
      // Every ref resolves here, so nothing to report; a dangling one would be
      // W004 (see lint.test.ts), never E005 — links are not contracts.
      expect(index.issues).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('dedupes a connection declared from both sides', async () => {
    const index = await loadPlan(GOLDEN);
    const between = index.connections.filter(
      (e) =>
        (e.a === 'API-TICKETS' && e.b === 'DB-TICKETS') ||
        (e.a === 'DB-TICKETS' && e.b === 'API-TICKETS'),
    );
    expect(between).toHaveLength(1);
  });

  it('neighborsOf agrees with the adjacency map', async () => {
    const index = await loadPlan(GOLDEN);
    expect(neighborsOf(index, 'API-TICKETS')).toEqual(
      index.connectedHandles.get('API-TICKETS'),
    );
    expect(neighborsOf(index, 'API-TICKETS')).toContain('DB-TICKETS');
  });
});
