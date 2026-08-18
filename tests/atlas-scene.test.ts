import { describe, expect, it } from 'vitest';
import {
  assignDistricts,
  bodySections,
  boundPaths,
  buildingFloors,
  buildScene,
  CELL,
  flowStops,
  gridFor,
  hash,
  routeBetween,
} from '../viewer/app/lib/atlas-scene.js';
import { heightFromUnit, lensModel, normalizeLens, normalizeLog } from '../viewer/app/lib/atlas-lenses.js';

interface TestCard {
  handle: string;
  type: string;
  name?: string;
  status?: string | null;
  mtime?: number;
  frontmatter?: Record<string, unknown>;
  body?: string;
}

const card = (handle: string, type: string, extra: Partial<TestCard> = {}): TestCard => ({
  handle,
  type,
  name: extra.name ?? handle,
  status: extra.status ?? null,
  mtime: extra.mtime ?? 0,
  frontmatter: extra.frontmatter ?? {},
  body: extra.body ?? '',
});

/** Undirected adjacency, the shape planIndex hands the views. */
function adjacency(edges: [string, string][]) {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const [a, b] of edges) {
    add(a, b);
    add(b, a);
  }
  return map;
}

describe('hash', () => {
  it('is stable and varies with input', () => {
    expect(hash('DB-CORE')).toBe(hash('DB-CORE'));
    expect(hash('DB-CORE')).not.toBe(hash('DB-CORF'));
  });
});

describe('flowStops', () => {
  it('reads handles from top-level ordered items, in order, deduped', () => {
    const body = [
      'Intro prose with [[API-IGNORED]] that is not a step.',
      '',
      '1. Requester submits via [[PAGE-NEW]]',
      '2. [[API-TICKETS]] validates and writes [[DB-TICKETS]]',
      '   - invalid → 422 via [[API-TICKETS]]',
      '3. [[EVENT-CREATED]] fires',
    ].join('\n');
    expect(flowStops(body)).toEqual([
      'PAGE-NEW',
      'API-TICKETS',
      'DB-TICKETS',
      'EVENT-CREATED',
    ]);
  });

  it('ignores indented (branch) items and returns [] with no list', () => {
    expect(flowStops('   1. [[API-NESTED]]')).toEqual([]);
    expect(flowStops('Just prose [[API-X]].')).toEqual([]);
    expect(flowStops('')).toEqual([]);
  });

  it('accepts both `1.` and `1)` markers', () => {
    expect(flowStops('1) [[API-A]]\n2) [[API-B]]')).toEqual(['API-A', 'API-B']);
  });
});

describe('bodySections', () => {
  it('collects ## headings only, in order', () => {
    const body = '# Title\n\n## First\ntext\n### Deeper\n## Second\n';
    expect(bodySections(body)).toEqual(['First', 'Second']);
  });
});

describe('boundPaths', () => {
  const files = new Map([
    ['FILE-SERVE', card('FILE-SERVE', 'FILE', { frontmatter: { path: 'src/serve/server.ts' } })],
    ['FILE-CLI', card('FILE-CLI', 'FILE', { frontmatter: { path: 'src/cli/index.ts' } })],
  ]);

  it('unions connected FILE paths with the card own code_refs', () => {
    const subject = card('PAGE-X', 'PAGE', { frontmatter: { code_refs: ['viewer/app/x.pzl'] } });
    const all = new Map(files);
    all.set(subject.handle, subject);
    const paths = boundPaths(subject, adjacency([['PAGE-X', 'FILE-SERVE']]), all as never);
    expect(paths.map((p) => p.path).sort()).toEqual([
      'src/serve/server.ts',
      'viewer/app/x.pzl',
    ]);
  });

  it('splits `path:symbol` into a symbol-bearing binding', () => {
    const subject = card('API-X', 'API', {
      frontmatter: { code_refs: ['src/core/code.ts:boundPathsForCard'] },
    });
    const [entry] = boundPaths(subject, new Map(), new Map([[subject.handle, subject]]) as never);
    expect(entry).toEqual({ path: 'src/core/code.ts', symbol: 'boundPathsForCard' });
  });

  it('does not mistake a path containing a colon for a symbol', () => {
    const subject = card('API-Y', 'API', { frontmatter: { code_refs: ['C:/repo/src'] } });
    const [entry] = boundPaths(subject, new Map(), new Map([[subject.handle, subject]]) as never);
    expect(entry.symbol).toBeNull();
  });

  it('a FILE card binds its own path', () => {
    const file = files.get('FILE-SERVE')!;
    const paths = boundPaths(file, new Map(), files as never);
    expect(paths.map((p) => p.path)).toEqual(['src/serve/server.ts']);
  });

  it('dedupes when a path arrives from both directions', () => {
    const subject = card('PAGE-D', 'PAGE', { frontmatter: { code_refs: ['src/serve/server.ts'] } });
    const all = new Map(files);
    all.set(subject.handle, subject);
    const paths = boundPaths(subject, adjacency([['PAGE-D', 'FILE-SERVE']]), all as never);
    expect(paths).toHaveLength(1);
  });
});

describe('buildingFloors', () => {
  it('labels a symbol binding by its symbol and a file binding by basename', () => {
    const floors = buildingFloors(
      card('X', 'PAGE'),
      [
        { path: 'src/core/code.ts', symbol: 'resolveCode' },
        { path: 'src/serve/server.ts', symbol: null },
      ],
      [],
    );
    expect(floors).toEqual([
      { label: 'resolveCode', detail: 'src/core/code.ts', source: 'symbol' },
      { label: 'server.ts', detail: 'src/serve/server.ts', source: 'file' },
    ]);
  });

  // Otherwise a card with code AND prose grows floors for its headings, and the
  // tower stops meaning "this much code".
  it('falls back to sections only when nothing binds', () => {
    expect(buildingFloors(card('X', 'DOC'), [], ['Why', 'How'])).toEqual([
      { label: 'Why', detail: null, source: 'section' },
      { label: 'How', detail: null, source: 'section' },
    ]);
    expect(
      buildingFloors(card('X', 'DOC'), [{ path: 'a.ts', symbol: null }], ['Why']),
    ).toHaveLength(1);
  });

  it('caps runaway floor counts', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ path: `f${i}.ts`, symbol: null }));
    expect(buildingFloors(card('X', 'FILE'), many, [])).toHaveLength(12);
  });
});

describe('assignDistricts', () => {
  const cards = [
    card('FEATURE-BIG', 'FEATURE', { name: 'Big feature', body: 'Does a lot of things. More.' }),
    card('FEATURE-SMALL', 'FEATURE', { name: 'Small feature' }),
    card('API-SHARED', 'API'),
    card('DB-ONE', 'DB'),
    card('DB-TWO', 'DB'),
    card('DOC-LONE', 'DOC'),
  ];

  // A card connected to two features is the normal case, not an edge case.
  it('gives a contested card to the smallest claiming feature', () => {
    const neighbors = adjacency([
      ['FEATURE-BIG', 'API-SHARED'],
      ['FEATURE-BIG', 'DB-ONE'],
      ['FEATURE-BIG', 'DB-TWO'],
      ['FEATURE-SMALL', 'API-SHARED'],
    ]);
    const districts = assignDistricts(cards, neighbors);
    const small = districts.find((d) => d.id === 'FEATURE-SMALL');
    expect(small?.cards).toEqual(['API-SHARED']);
    expect(districts.find((d) => d.id === 'FEATURE-BIG')?.cards).toEqual(['DB-ONE', 'DB-TWO']);
  });

  it('files unclaimed cards into a district per type', () => {
    const districts = assignDistricts(cards, new Map());
    expect(districts.find((d) => d.id === 'type:DB')?.cards).toEqual(['DB-ONE', 'DB-TWO']);
    expect(districts.find((d) => d.id === 'type:DOC')?.cards).toEqual(['DOC-LONE']);
  });

  it('never places a FEATURE, RELEASE or PLAN as a building', () => {
    const withMeta = [...cards, card('RELEASE-V1', 'RELEASE'), card('PLAN-PROJECT', 'PLAN')];
    const placed = assignDistricts(withMeta, new Map()).flatMap((d) => d.cards);
    expect(placed).not.toContain('FEATURE-BIG');
    expect(placed).not.toContain('RELEASE-V1');
    expect(placed).not.toContain('PLAN-PROJECT');
  });

  it('carries the feature first sentence as the district summary', () => {
    const neighbors = adjacency([['FEATURE-BIG', 'DB-ONE']]);
    const district = assignDistricts(cards, neighbors).find((d) => d.id === 'FEATURE-BIG');
    expect(district?.label).toBe('Big feature');
    expect(district?.summary).toBe('Does a lot of things.');
  });
});

describe('gridFor', () => {
  it('is the squarest rectangle that holds n', () => {
    expect(gridFor(0)).toEqual({ cols: 1, rows: 1 });
    expect(gridFor(1)).toEqual({ cols: 1, rows: 1 });
    expect(gridFor(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridFor(5)).toEqual({ cols: 3, rows: 2 });
    expect(gridFor(9)).toEqual({ cols: 3, rows: 3 });
  });
});

describe('routeBetween', () => {
  it('is a straight segment when the points already share an axis', () => {
    expect(routeBetween({ x: 0, y: 0 }, { x: 0, y: 50 }, 'k')).toHaveLength(2);
    expect(routeBetween({ x: 0, y: 0 }, { x: 50, y: 0 }, 'k')).toHaveLength(2);
  });

  it('is orthogonal — every segment moves in exactly one axis', () => {
    const points = routeBetween({ x: 0, y: 0 }, { x: 40, y: 60 }, 'k');
    for (let i = 1; i < points.length; i++) {
      const dx = Math.abs(points[i].x - points[i - 1].x);
      const dy = Math.abs(points[i].y - points[i - 1].y);
      expect(dx < 1e-9 || dy < 1e-9).toBe(true);
    }
  });

  it('starts and ends exactly on its endpoints', () => {
    const from = { x: 3, y: 7 };
    const to = { x: 41, y: 62 };
    const points = routeBetween(from, to, 'k');
    expect(points[0]).toEqual(from);
    expect(points[points.length - 1]).toEqual(to);
  });

  // A road that runs straight between two building centres is drawn under the
  // buildings and is invisible; the gutter is the gap between district plates.
  it('travels the given gutter lane when one is supplied', () => {
    const points = routeBetween({ x: 0, y: 0 }, { x: 40, y: 400 }, 'k', 120);
    const laneYs = points.slice(1, -1).map((p) => p.y);
    expect(laneYs).toHaveLength(2);
    expect(laneYs[0]).toBe(laneYs[1]);
    expect(Math.abs(laneYs[0] - 120)).toBeLessThan(CELL * 0.3);
  });

  // Parallel roads between the same districts must not stack into one line.
  it('offsets its lane by the key', () => {
    const a = routeBetween({ x: 0, y: 0 }, { x: 40, y: 60 }, 'FLOW-A:0');
    const b = routeBetween({ x: 0, y: 0 }, { x: 40, y: 60 }, 'FLOW-Q:3');
    expect(a).not.toEqual(b);
  });
});

describe('buildScene', () => {
  const cards = [
    card('FEATURE-AUTH', 'FEATURE', { name: 'Auth', body: 'Signing in. Details follow.' }),
    card('API-LOGIN', 'API'),
    card('DB-USERS', 'DB'),
    card('PAGE-LOGIN', 'PAGE'),
    card('FILE-AUTH', 'FILE', { frontmatter: { path: 'src/auth.ts' } }),
    card('FLOW-SIGN-IN', 'FLOW', {
      body: '1. [[PAGE-LOGIN]] posts\n2. [[API-LOGIN]] checks [[DB-USERS]]\n',
    }),
  ];
  const edges: [string, string][] = [
    ['FEATURE-AUTH', 'API-LOGIN'],
    ['FEATURE-AUTH', 'DB-USERS'],
    ['FEATURE-AUTH', 'PAGE-LOGIN'],
    ['API-LOGIN', 'FILE-AUTH'],
    ['API-LOGIN', 'DB-USERS'],
  ];
  const scene = () =>
    buildScene({
      cards,
      connections: edges.map(([a, b]) => ({ a, b })),
      neighbors: adjacency(edges),
    });

  // The whole value of a map is that things stay where they were.
  it('is deterministic — same input, byte-identical scene', () => {
    expect(JSON.stringify(scene())).toBe(JSON.stringify(scene()));
  });

  it('places every non-meta card exactly once', () => {
    const handles = scene().buildings.map((b) => b.handle).sort();
    expect(handles).toEqual(['API-LOGIN', 'DB-USERS', 'FILE-AUTH', 'FLOW-SIGN-IN', 'PAGE-LOGIN']);
  });

  it('gives each type its silhouette', () => {
    const shapes = new Map(scene().buildings.map((b) => [b.handle, b.shape]));
    expect(shapes.get('DB-USERS')).toBe('cylinder');
    expect(shapes.get('API-LOGIN')).toBe('portal');
    expect(shapes.get('FILE-AUTH')).toBe('plate');
  });

  it('turns a FLOW into a route through its stops', () => {
    const [route] = scene().routes;
    expect(route.id).toBe('FLOW-SIGN-IN');
    expect(route.stops).toEqual(['PAGE-LOGIN', 'API-LOGIN', 'DB-USERS']);
    expect(route.points.length).toBeGreaterThanOrEqual(3);
  });

  it('drops flow stops that name no card', () => {
    const withGhost = cards.map((c) =>
      c.handle === 'FLOW-SIGN-IN'
        ? { ...c, body: '1. [[PAGE-LOGIN]]\n2. [[API-GHOST]]\n3. [[DB-USERS]]\n' }
        : c,
    );
    const built = buildScene({
      cards: withGhost,
      connections: [],
      neighbors: adjacency(edges),
    });
    expect(built.routes[0].stops).toEqual(['PAGE-LOGIN', 'DB-USERS']);
  });

  it('gives a bound card floors from its code', () => {
    const api = scene().buildings.find((b) => b.handle === 'API-LOGIN')!;
    expect(api.floors.map((f) => f.detail)).toContain('src/auth.ts');
  });

  it('honours hide, pin and shape overrides', () => {
    const built = buildScene({
      cards,
      connections: [],
      neighbors: adjacency(edges),
      hide: new Set(['FILE-AUTH']),
      pin: new Map([['DB-USERS', [2, 3]]]),
      shape: new Map([['PAGE-LOGIN', 'plant']]),
    });
    expect(built.buildings.find((b) => b.handle === 'FILE-AUTH')).toBeUndefined();
    expect(built.buildings.find((b) => b.handle === 'PAGE-LOGIN')?.shape).toBe('plant');
    const db = built.buildings.find((b) => b.handle === 'DB-USERS')!;
    expect(db.pinned).toBe(true);
  });

  it('drops edges whose endpoint is not on the map', () => {
    const built = buildScene({
      cards,
      connections: [{ a: 'API-LOGIN', b: 'NOWHERE-X' }, { a: 'API-LOGIN', b: 'DB-USERS' }],
      neighbors: adjacency(edges),
    });
    expect(built.edges).toHaveLength(1);
  });

  it('keeps buildings inside their district bounds', () => {
    const built = scene();
    const districts = new Map(built.districts.map((d) => [d.id, d]));
    for (const building of built.buildings) {
      const d = districts.get(building.district)!;
      expect(building.x).toBeGreaterThanOrEqual(d.x);
      expect(building.x).toBeLessThanOrEqual(d.x + d.w);
      expect(building.y).toBeGreaterThanOrEqual(d.y);
      expect(building.y).toBeLessThanOrEqual(d.y + d.h);
    }
  });

  it('districts never overlap', () => {
    const built = buildScene({
      cards: Array.from({ length: 40 }, (_, i) =>
        card(`DB-${String(i).padStart(2, '0')}`, i % 2 ? 'DB' : 'API'),
      ),
      connections: [],
      neighbors: new Map(),
    });
    const ds = built.districts;
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        const a = ds[i];
        const b = ds[j];
        const apart =
          a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('survives an empty plan', () => {
    const built = buildScene({ cards: [], connections: [], neighbors: new Map() });
    expect(built.buildings).toEqual([]);
    expect(built.districts).toEqual([]);
    expect(built.bounds.maxX).toBe(CELL);
  });
});

describe('lenses', () => {
  const cards = [
    card('API-HUB', 'API', { status: 'verified', mtime: 1_000 }),
    card('DB-COLD', 'DB', { status: 'planned', mtime: 0 }),
  ];

  it('falls back to status for an unknown lens', () => {
    expect(normalizeLens('nonsense')).toBe('status');
    expect(normalizeLens('drift')).toBe('drift');
  });

  it('normalizeLog compresses without dividing by zero', () => {
    expect(normalizeLog(0, 10)).toBe(0);
    expect(normalizeLog(5, 0)).toBe(0);
    expect(normalizeLog(10, 10)).toBeCloseTo(1, 9);
    // Log, not linear: half the max is well above half the height.
    expect(normalizeLog(5, 10)).toBeGreaterThan(0.5);
  });

  it('status is flat — colour carries the answer, not height', () => {
    const model = lensModel('status');
    expect(model.height(cards[0])).toBe(model.height(cards[1]));
    // The same vocabulary the status chips use, not a map-only one.
    expect(model.tone(cards[0])).toBe('--color-success');
    expect(model.tone(cards[1])).toBe('--color-muted');
  });

  it('degree makes hubs taller', () => {
    const model = lensModel('degree', { degree: new Map([['API-HUB', 12], ['DB-COLD', 1]]) });
    expect(model.height(cards[0])).toBeGreaterThan(model.height(cards[1]));
  });

  it('drift marks and raises only stale cards', () => {
    const model = lensModel('drift', { stale: new Map([['DB-COLD', { changed_files: ['a'] }]]) });
    expect(model.scaffolded(cards[1])).toBe(true);
    expect(model.scaffolded(cards[0])).toBe(false);
    expect(model.tone(cards[1])).toBe('--color-danger');
    expect(model.height(cards[1])).toBeGreaterThan(model.height(cards[0]));
  });

  it('recency is measured against an injected clock, not the wall', () => {
    const model = lensModel('recency', { now: 1_000 });
    expect(model.height(cards[0])).toBeGreaterThan(model.height(cards[1]));
  });

  it('size reads bound lines and tolerates missing metrics', () => {
    const model = lensModel('size', { metrics: new Map([['API-HUB', { lines: 900 }]]) });
    expect(model.height(cards[0])).toBeGreaterThan(model.height(cards[1]));
    expect(Number.isFinite(model.height(cards[1]))).toBe(true);
  });

  it('every lens produces a usable height for every card', () => {
    for (const { id } of [{ id: 'status' }, { id: 'degree' }, { id: 'drift' }, { id: 'recency' }, { id: 'size' }]) {
      const model = lensModel(id);
      for (const c of cards) {
        const h = model.height(c);
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeGreaterThan(0);
      }
    }
  });

  it('heightFromUnit spans a readable range', () => {
    expect(heightFromUnit(0)).toBeGreaterThan(0);
    expect(heightFromUnit(1)).toBeGreaterThan(heightFromUnit(0) * 5);
  });
});
