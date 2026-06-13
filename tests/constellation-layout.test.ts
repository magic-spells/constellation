import { describe, it, expect } from 'vitest';
import type { Card, Connection } from '../viewer/src/lib/types';
import {
  buildGraph,
  clusterAnchors,
  createSimulation,
  enterFocus,
  fitToBounds,
  focusRadii,
  focusTargets,
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

describe('nodeRadius', () => {
  it('grows with degree but is capped', () => {
    expect(nodeRadius(0)).toBe(8);
    expect(nodeRadius(4)).toBeGreaterThan(nodeRadius(0));
    expect(nodeRadius(1000)).toBe(21); // 8 + min(13, …) = 8 + 13
    expect(nodeRadius(1000)).toBeLessThanOrEqual(21);
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
  it('scales with hop-distance and sends unreachable nodes to the periphery', () => {
    expect(ringRadius(0, 100)).toBe(0);
    expect(ringRadius(1, 100)).toBe(100);
    expect(ringRadius(3, 100)).toBe(300);
    expect(ringRadius(undefined, 100)).toBe(600); // peripheryRings (6) * gap
    expect(ringRadius(Infinity, 100)).toBe(600);
  });
});

describe('fitToBounds', () => {
  it('returns a neutral transform for no nodes', () => {
    expect(fitToBounds([], { width: 800, height: 600 })).toEqual({ tx: 0, ty: 0, scale: 1 });
  });

  it('centres the bounding box of the nodes in the viewport', () => {
    const nodes: GraphNode[] = [
      { handle: 'A', type: 'API', name: null, status: null, degree: 0, r: 0, x: 0, y: 0 },
      { handle: 'B', type: 'API', name: null, status: null, degree: 0, r: 0, x: 100, y: 100 },
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
    r: 8,
  });

  it('places nodes by type (angle) and hop-distance (radius)', () => {
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
    const rad = (h: string) => Math.hypot(targets.get(h)!.x, targets.get(h)!.y);
    const ang = (h: string) => Math.atan2(targets.get(h)!.y, targets.get(h)!.x);

    // radius encodes hop-distance: connected (hop 1) nodes sit on the inner ring
    expect(rad('DB-A')).toBeCloseTo(100, 5);
    expect(rad('DOC-C')).toBeCloseTo(100, 5);
    expect(rad('DB-D')).toBeCloseTo(200, 5);

    // the focused node gets no target — enterFocus pins it to the centre
    expect(targets.has('API-F')).toBe(false);

    // same type+hop fans out to distinct angles, centred on the type's wedge (where the
    // lone hop-2 DB node sits)
    expect(Math.abs(ang('DB-A') - ang('DB-B'))).toBeGreaterThan(0.1);
    expect((ang('DB-A') + ang('DB-B')) / 2).toBeCloseTo(ang('DB-D'), 5);

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
    expect(Math.hypot(targets.get('DB-X')!.x, targets.get('DB-X')!.y)).toBeCloseTo(600, 5); // 6 * gap
    expect(Math.hypot(targets.get('DB-Y')!.x, targets.get('DB-Y')!.y)).toBeCloseTo(100, 5);
  });
});

describe('seedFocusTargets', () => {
  it('writes target positions onto nodes and zeroes velocity', () => {
    const nodes: GraphNode[] = [
      { handle: 'A', type: 'API', name: null, status: null, degree: 0, r: 8, vx: 9, vy: 9 },
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
