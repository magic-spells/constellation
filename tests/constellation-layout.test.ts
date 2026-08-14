import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  chargeStrength,
  clusterAnchors,
  createSimulation,
  fitToBounds,
  fitToCircle,
  focusRadii,
  LAYOUT,
  nodeDimensions,
} from '../viewer/app/lib/constellation-layout.js';

interface Card {
  handle: string;
  type: string;
  kind: string | null;
  name: string | null;
  status: string | null;
  relPath: string;
  mtime: number;
  frontmatter: Record<string, unknown>;
  body: string;
}

interface Connection {
  a: string;
  b: string;
}

interface GraphNode {
  handle: string;
  type: string;
  name: string | null;
  status: string | null;
  degree: number;
  w: number;
  h: number;
  r: number;
  x?: number;
  y?: number;
}

function card(handle: string): Card {
  const type = handle.split('-')[0];
  return {
    handle,
    type,
    kind: null,
    name: handle,
    status: null,
    relPath: `${type.toLowerCase()}/${handle}.md`,
    mtime: 0,
    frontmatter: {},
    body: '',
  };
}

const conn = (a: string, b: string): Connection => ({ a, b });

describe('nodeDimensions', () => {
  it('sizes readable cards deterministically and caps long handles', () => {
    const compact = nodeDimensions('API-A', null, 0);
    const detailed = nodeDimensions('DOC-WORKFLOW', 'Workflow documentation', 4);
    const detailedLeaf = nodeDimensions('DOC-WORKFLOW', 'Workflow documentation', 0);
    const long = nodeDimensions('DATATYPE-A-VERY-LONG-HANDLE-THAT-WILL-NOT-FIT', null, 0);

    expect(compact.w).toBe(LAYOUT.cardMinWidth);
    expect(compact.h).toBe(LAYOUT.cardHandleHeight);
    expect(detailed.w).toBeGreaterThan(compact.w);
    expect(detailed.h).toBe(LAYOUT.cardDetailHeight);
    expect(long.w).toBe(LAYOUT.cardMaxWidth);
    expect(detailed.r).toBeGreaterThan(detailedLeaf.r);
  });
});

describe('chargeStrength', () => {
  it('repels higher-degree hubs more strongly', () => {
    expect(chargeStrength(4)).toBeLessThan(chargeStrength(0));
  });
});

describe('buildGraph', () => {
  it('maps cards to nodes and counts degree from valid connections', () => {
    const cards = [card('API-A'), card('DB-B'), card('DOC-C')];
    const connections = [conn('API-A', 'DB-B'), conn('API-A', 'DOC-C')];
    const { nodes, links } = buildGraph(cards, connections);

    expect(nodes).toHaveLength(3);
    expect(links).toHaveLength(2);
    const byHandle = new Map(nodes.map((n) => [n.handle, n]));
    expect(byHandle.get('API-A')!.degree).toBe(2);
    expect(byHandle.get('DB-B')!.degree).toBe(1);
    expect(byHandle.get('DOC-C')!.degree).toBe(1);
    expect(byHandle.get('API-A')!.type).toBe('API');
    expect(byHandle.get('API-A')!.w).toBeGreaterThanOrEqual(LAYOUT.cardMinWidth);
    expect(byHandle.get('API-A')!.h).toBeGreaterThan(0);
    expect(byHandle.get('API-A')!.r).toBeGreaterThan(byHandle.get('API-A')!.w / 2);
  });

  it('drops connections whose endpoints are not cards (and ignores them for degree)', () => {
    const cards = [card('API-A'), card('DB-B')];
    const connections = [conn('API-A', 'DB-B'), conn('API-A', 'GHOST-X')];
    const { nodes, links } = buildGraph(cards, connections);

    expect(links).toHaveLength(1);
    const a = nodes.find((n) => n.handle === 'API-A')!;
    expect(a.degree).toBe(1); // the dangling GHOST-X edge does not inflate degree
  });

  it('handles an empty plan', () => {
    expect(buildGraph([], [])).toEqual({ nodes: [], links: [] });
  });
});

describe('clusterAnchors', () => {
  it('returns nothing for no types', () => {
    expect(clusterAnchors([], 800, 600).size).toBe(0);
  });

  it('centres a single type', () => {
    const a = clusterAnchors(['API'], 800, 600);
    expect(a.get('API')).toEqual({ x: 400, y: 300 });
  });

  it('places multiple types on a ring around the centre, all distinct', () => {
    const types = ['API', 'DB', 'DOC', 'PAGE'];
    const anchors = clusterAnchors(types, 800, 600);
    expect(anchors.size).toBe(4);
    const radius = Math.min(800, 600) * 0.34;
    for (const t of types) {
      const p = anchors.get(t)!;
      const dist = Math.hypot(p.x - 400, p.y - 300);
      expect(dist).toBeCloseTo(radius, 5); // every anchor sits on the ring
    }
    // distinct positions
    const keys = new Set([...anchors.values()].map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`));
    expect(keys.size).toBe(4);
  });
});

describe('focusRadii', () => {
  it('computes BFS hop-distance and omits unreachable nodes', () => {
    // F — A — B ;  F — C ;  D is isolated
    const neighbors = new Map<string, string[]>([
      ['F', ['A', 'C']],
      ['A', ['F', 'B']],
      ['B', ['A']],
      ['C', ['F']],
      ['D', []],
    ]);
    const hops = focusRadii('F', neighbors);
    expect(hops.get('F')).toBe(0);
    expect(hops.get('A')).toBe(1);
    expect(hops.get('C')).toBe(1);
    expect(hops.get('B')).toBe(2);
    expect(hops.has('D')).toBe(false); // unreachable → absent
  });
});

describe('fitToBounds', () => {
  it('returns a neutral transform for no nodes', () => {
    expect(fitToBounds([], { width: 800, height: 600 })).toEqual({ tx: 0, ty: 0, scale: 1 });
  });

  it('centres the bounding box of the nodes in the viewport', () => {
    const nodes: GraphNode[] = [
      { handle: 'A', type: 'API', name: null, status: null, degree: 0, w: 10, h: 20, r: 0, x: 0, y: 0 },
      { handle: 'B', type: 'API', name: null, status: null, degree: 0, w: 10, h: 20, r: 0, x: 100, y: 100 },
    ];
    const { tx, ty, scale } = fitToBounds(nodes, { width: 800, height: 600, padding: 0, maxScale: 10 });
    // bbox centre (50,50) must map to viewport centre (400,300): screen = t + s*world
    expect(tx + scale * 50).toBeCloseTo(400, 5);
    expect(ty + scale * 50).toBeCloseTo(300, 5);
    expect(scale).toBeGreaterThan(0);
  });
});

describe('fitToCircle', () => {
  it('centres the graph-space circle in the viewport', () => {
    const center = { x: 120, y: 80 };
    const { tx, ty, scale } = fitToCircle(center, 200, {
      width: 800,
      height: 600,
      padding: 0,
      maxScale: 10,
    });

    expect(tx + scale * center.x).toBeCloseTo(400, 5);
    expect(ty + scale * center.y).toBeCloseTo(300, 5);
    expect(scale).toBeCloseTo(1.5, 5);
  });
});

describe('simulation (deterministic d3-force)', () => {
  it('settles finite node positions', () => {
    const cards = [card('API-A'), card('API-B'), card('DB-C'), card('DOC-D')];
    const connections = [conn('API-A', 'DB-C'), conn('API-A', 'DOC-D')];
    const { nodes, links } = buildGraph(cards, connections);
    const anchors = clusterAnchors(['API', 'DB', 'DOC'], 800, 600);
    const sim = createSimulation({ nodes, links, anchors });

    // stopped on creation but positions are initialised
    expect(Number.isFinite(nodes[0].x ?? NaN)).toBe(true);

    for (let i = 0; i < 200; i++) sim.tick();

    expect(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });
});
