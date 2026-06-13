import { describe, it, expect } from 'vitest';
import type { Card, Connection } from '../viewer/src/lib/types';
import {
  buildGraph,
  clusterAnchors,
  createSimulation,
  enterFocus,
  fitToBounds,
  focusRadii,
  focusTargetRadius,
  focusTargets,
  LAYOUT,
  nodeDimensions,
  nodeRadius,
  ringRadius,
  seedFocusTargets,
  type GraphNode,
} from '../viewer/src/lib/constellation-layout';

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
    const long = nodeDimensions('DATATYPE-A-VERY-LONG-HANDLE-THAT-WILL-NOT-FIT', null, 0);

    expect(compact.w).toBe(LAYOUT.cardMinWidth);
    expect(compact.h).toBe(LAYOUT.cardHandleHeight);
    expect(detailed.w).toBeGreaterThan(compact.w);
    expect(detailed.h).toBe(LAYOUT.cardDetailHeight);
    expect(long.w).toBe(LAYOUT.cardMaxWidth);
    expect(nodeRadius(4, detailed.w, detailed.h)).toBeGreaterThan(nodeRadius(0, detailed.w, detailed.h));
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

describe('ringRadius', () => {
  it('scales with hop-distance and keeps deep or unreachable nodes bounded', () => {
    expect(ringRadius(0, 100)).toBe(0);
    expect(ringRadius(1, 100)).toBe(100);
    expect(ringRadius(3, 100)).toBe(300);
    expect(ringRadius(99, 100)).toBe(300); // maxFocusHop (3) * gap
    expect(ringRadius(undefined, 100)).toBe(400); // peripheryRings (4) * gap
    expect(ringRadius(Infinity, 100)).toBe(400);
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

describe('focusTargets', () => {
  const mk = (handle: string, type: string): GraphNode => ({
    handle,
    type,
    name: null,
    status: null,
    degree: 0,
    ...nodeDimensions(handle, null, 0),
  });

  it('places nodes by type sector and hop-distance lane', () => {
    const focused = mk('API-F', 'API');
    const nodes = [focused, mk('DB-A', 'DB'), mk('DB-B', 'DB'), mk('DOC-C', 'DOC'), mk('DB-D', 'DB')];
    const hops = new Map<string, number>([
      ['API-F', 0],
      ['DB-A', 1],
      ['DB-B', 1],
      ['DOC-C', 1],
      ['DB-D', 2],
    ]);
    const targets = focusTargets(nodes, focused, hops, ['API', 'DB', 'DOC'], { x: 0, y: 0 }, 100);
    const ang = (h: string) => Math.atan2(targets.get(h)!.y, targets.get(h)!.x);
    const dbBase = (1 / 3) * Math.PI * 2 - Math.PI / 2;
    const dbLane = (h: string) => targets.get(h)!.x * Math.cos(dbBase) + targets.get(h)!.y * Math.sin(dbBase);

    // radial lane encodes hop-distance: connected nodes sit on the inner lane
    expect(dbLane('DB-A')).toBeCloseTo(100, 5);
    expect(dbLane('DB-B')).toBeGreaterThan(100);
    expect(dbLane('DB-B')).toBeLessThan(200);
    expect(dbLane('DB-D')).toBeCloseTo(200, 5);
    expect(Math.hypot(targets.get('DOC-C')!.x, targets.get('DOC-C')!.y)).toBeCloseTo(100, 5);

    // the focused node gets no target — enterFocus pins it to the centre
    expect(targets.has('API-F')).toBe(false);

    // same type+lane packs into distinct positions inside the same sector.
    expect(Math.hypot(targets.get('DB-A')!.x - targets.get('DB-B')!.x, targets.get('DB-A')!.y - targets.get('DB-B')!.y)).toBeGreaterThan(50);
    expect(Math.abs(ang('DB-A') - ang('DB-D'))).toBeLessThan(0.8);
    expect(Math.abs(ang('DB-B') - ang('DB-D'))).toBeLessThan(0.8);

    // a different type lands in a different angular wedge
    expect(Math.abs(ang('DOC-C') - ang('DB-D'))).toBeGreaterThan(0.5);
  });

  it('sends unreachable nodes to the periphery but keeps their type angle', () => {
    const focused = mk('API-F', 'API');
    const nodes = [focused, mk('DB-X', 'DB'), mk('DB-Y', 'DB')];
    const hops = new Map<string, number>([
      ['API-F', 0],
      ['DB-Y', 1],
    ]); // DB-X is unreachable (absent from hops)
    const targets = focusTargets(nodes, focused, hops, ['API', 'DB'], { x: 0, y: 0 }, 100);
    expect(Math.hypot(targets.get('DB-X')!.x, targets.get('DB-X')!.y)).toBeCloseTo(400, 5); // 4 * gap
    expect(Math.hypot(targets.get('DB-Y')!.x, targets.get('DB-Y')!.y)).toBeCloseTo(100, 5);
  });

  it('computes a framing radius from card footprints and target positions', () => {
    const focused = mk('API-F', 'API');
    const far = mk('DB-X', 'DB');
    const targets = new Map([['DB-X', { x: 400, y: 0 }]]);
    expect(focusTargetRadius([focused, far], targets, { x: 0, y: 0 })).toBeGreaterThan(400);
    expect(focusTargetRadius([focused, far], new Map(), { x: 0, y: 0 })).toBe(LAYOUT.ringGap);
  });
});

describe('seedFocusTargets', () => {
  it('writes target positions onto nodes and zeroes velocity', () => {
    const nodes: GraphNode[] = [
      { handle: 'A', type: 'API', name: null, status: null, degree: 0, ...nodeDimensions('A', null, 0), vx: 9, vy: 9 },
    ];
    seedFocusTargets(nodes, new Map([['A', { x: 12, y: 34 }]]));
    expect(nodes[0].x).toBe(12);
    expect(nodes[0].y).toBe(34);
    expect(nodes[0].vx).toBe(0);
    expect(nodes[0].vy).toBe(0);
  });
});

describe('simulation (deterministic d3-force)', () => {
  it('settles, and a focused node pins exactly to the centre', () => {
    const cards = [card('API-A'), card('API-B'), card('DB-C'), card('DOC-D')];
    const connections = [conn('API-A', 'DB-C'), conn('API-A', 'DOC-D')];
    const { nodes, links } = buildGraph(cards, connections);
    const anchors = clusterAnchors(['API', 'DB', 'DOC'], 800, 600);
    const sim = createSimulation({ nodes, links, anchors });

    // stopped on creation but positions are initialised
    expect(Number.isFinite(nodes[0].x ?? NaN)).toBe(true);

    for (let i = 0; i < 200; i++) sim.tick();

    const focused = nodes.find((n) => n.handle === 'API-A')!;
    const neighbors = new Map<string, string[]>([
      ['API-A', ['DB-C', 'DOC-D']],
      ['DB-C', ['API-A']],
      ['DOC-D', ['API-A']],
      ['API-B', []],
    ]);
    enterFocus(sim, nodes, focused, focusRadii('API-A', neighbors), { x: 0, y: 0 });
    sim.alpha(0.9);
    for (let i = 0; i < 200; i++) sim.tick();

    // pinned node sits exactly at the focus centre
    expect(focused.x).toBeCloseTo(0, 6);
    expect(focused.y).toBeCloseTo(0, 6);

    // a 1-hop neighbour ends up nearer the centre than the unreachable node
    const neighbor = nodes.find((n) => n.handle === 'DB-C')!;
    const isolated = nodes.find((n) => n.handle === 'API-B')!;
    const dNeighbor = Math.hypot(neighbor.x ?? 0, neighbor.y ?? 0);
    const dIsolated = Math.hypot(isolated.x ?? 0, isolated.y ?? 0);
    expect(dIsolated).toBeGreaterThan(dNeighbor);
  });
});
