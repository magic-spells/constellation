// @vitest-environment jsdom
//
// The three.js painter's testable half: the camera derivation, the shape
// vocabulary, and the palette hand-off — all pure, and the important one is that
// this painter frames the SAME city as the canvas one.
//
// A GL context is the one thing a test runner has not got. Everything else about
// the renderer is plain three, so the last block stubs ONLY WebGLRenderer and
// exercises the mesh graph for real, up to and including picking a building by
// firing a ray at the pixel iso would have drawn it on.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  fitProjected,
  pointAlong as isoPointAlong,
  project,
  projectedBounds,
} from '../viewer/app/lib/atlas-iso.js';
import { buildScene } from '../viewer/app/lib/atlas-scene.js';
import {
  bandLevels,
  baseTone,
  cameraFrame,
  geometrySpec,
  loadThree,
  pointAlong,
  projectByCamera,
  threeReady,
  ThreeRenderer,
  toThree,
  UNIT,
} from '../viewer/app/lib/atlas-three.js';

vi.mock('three', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class StubWebGLRenderer {
    calls = 0;
    shadowMap = { enabled: false, type: 0 };
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    render() {
      this.calls += 1;
    }
    dispose() {}
  }
  return { ...actual, WebGLRenderer: StubWebGLRenderer };
});

const CELL = 80;

const building = (extra: Record<string, unknown> = {}) => ({
  handle: 'API-TICKETS',
  type: 'API',
  name: 'Tickets',
  status: null,
  district: 'type:API',
  shape: 'block',
  x: 120,
  y: 240,
  footprint: { w: 0.62, d: 0.62 },
  height: 1.4,
  floors: [] as { label: string }[],
  paths: [] as string[],
  pinned: false,
  ...extra,
});

/** The screen position iso puts a world point at, under a camera view. */
function isoScreen(
  point: { x: number; y: number; z?: number },
  view: { tx: number; ty: number; scale: number },
) {
  const p = project(point.x, point.y, point.z ?? 0);
  return { x: view.tx + view.scale * p.x, y: view.ty + view.scale * p.y };
}

describe('camera parity with the isometric painter', () => {
  const size = { width: 1200, height: 780 };
  const views = [
    { tx: 0, ty: 0, scale: 1 },
    { tx: 240, ty: -80, scale: 0.42 },
    { tx: -1310, ty: 512.5, scale: 2.35 },
  ];
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 400, y: 80, z: 0 },
    { x: -220, y: 940, z: 0 },
    { x: 640, y: 640, z: 720 },
    { x: 40, y: -300, z: 112 },
  ];

  it('lands every world point on the same pixel as iso', () => {
    for (const view of views) {
      for (const point of points) {
        const mine = projectByCamera(point, view, size);
        const theirs = isoScreen(point, view);
        expect(mine.x).toBeCloseTo(theirs.x, 6);
        expect(mine.y).toBeCloseTo(theirs.y, 6);
      }
    }
  });

  it('centres the frustum on the ground point under the viewport centre', () => {
    for (const view of views) {
      const { center } = cameraFrame(view, size);
      const screen = isoScreen({ ...center, z: 0 }, view);
      expect(screen.x).toBeCloseTo(size.width / 2, 6);
      expect(screen.y).toBeCloseTo(size.height / 2, 6);
    }
  });

  it('sizes the frustum so world units and pixels agree with view.scale', () => {
    const frame = cameraFrame({ tx: 0, ty: 0, scale: 2 }, size);
    expect(frame.halfWidth).toBeCloseTo(size.width / 2 / (2 * UNIT), 9);
    expect(frame.halfHeight).toBeCloseTo(size.height / 2 / (2 * UNIT), 9);
    // Zooming out shows more world, proportionally.
    const wider = cameraFrame({ tx: 0, ty: 0, scale: 1 }, size);
    expect(wider.halfWidth).toBeCloseTo(frame.halfWidth * 2, 9);
  });

  it('is a true isometric scale: √1.5 pixels per world unit', () => {
    expect(UNIT).toBeCloseTo(Math.sqrt(1.5), 12);
    // …which is exactly iso's three axis constants.
    expect(0.7071067811865476 * UNIT).toBeCloseTo(Math.cos(Math.PI / 6), 12);
    expect(0.408248290463863 * UNIT).toBeCloseTo(0.5, 12);
    expect(0.816496580927726 * UNIT).toBeCloseTo(1, 12);
  });

  it('crosses the left-handed world into three’s y-up space', () => {
    expect(toThree(5, 7, 9)).toEqual({ x: 5, y: 9, z: 7 });
  });
});

describe('shape → geometry', () => {
  const shapes = [
    'cylinder',
    'portal',
    'block',
    'plant',
    'beacon',
    'offmap',
    'plate',
    'monument',
    'scaffold',
    'prism',
    'figure',
    'road',
  ];

  it('gives every scene shape a body', () => {
    for (const shape of shapes) {
      const spec = geometrySpec(building({ shape }), CELL);
      expect(spec.parts.length, shape).toBeGreaterThan(0);
      for (const part of spec.parts) {
        expect(['box', 'cyl', 'sphere', 'capsule'], shape).toContain(part.kind);
        expect(Number.isFinite(part.y), shape).toBe(true);
      }
    }
  });

  it('gives the shapes distinguishable silhouettes', () => {
    const signature = (shape: string) =>
      JSON.stringify(geometrySpec(building({ shape }), CELL).parts.map((p) => p.kind));
    // block/prism/monument/cylinder all differ; only unmapped shapes fall together.
    expect(new Set(shapes.map(signature)).size).toBeGreaterThanOrEqual(6);
    expect(signature('cylinder')).not.toEqual(signature('block'));
    expect(signature('portal')).not.toEqual(signature('block'));
    expect(signature('figure')).not.toEqual(signature('beacon'));
  });

  it('extrudes a block to its scene height on its scene footprint', () => {
    const spec = geometrySpec(building({ height: 3, footprint: { w: 0.5, d: 0.25 } }), CELL);
    const [box] = spec.parts;
    expect(box).toMatchObject({ kind: 'box', w: 40, d: 20, h: 240 });
    // Centre-origin: three wants a box positioned at half its height.
    expect(box.y).toBe(120);
    expect(spec.plinth).toBe(true);
    expect(spec.bands).toBe(true);
  });

  it('treats a plate as ground: flat, no plinth, no bands', () => {
    const spec = geometrySpec(building({ shape: 'plate', height: 4 }), CELL);
    expect(spec.parts).toHaveLength(1);
    expect(spec.parts[0].h).toBeLessThan(CELL * 0.1);
    expect(spec.plinth).toBe(false);
    expect(spec.bands).toBe(false);
    expect(spec.shadow).toBe('receive');
  });

  it('reads an offmap card as excluded: ghosted, caged, lifted, unplinthed', () => {
    const spec = geometrySpec(building({ shape: 'offmap' }), CELL);
    expect(spec.ghost).toBe(true);
    expect(spec.cage).toBeTruthy();
    expect(spec.lift).toBeGreaterThan(0);
    expect(spec.plinth).toBe(false);
    expect(spec.shadow).toBe('none');
  });

  it('cages a TEST scaffold around a smaller core', () => {
    const spec = geometrySpec(building({ shape: 'scaffold', height: 2 }), CELL);
    expect(spec.cage).toMatchObject({ w: 49.6, d: 49.6, h: 160 });
    expect(spec.parts[0].w).toBeLessThan(spec.cage.w);
    expect(spec.ghost).toBeUndefined();
  });

  it('never produces a zero-sized part, even for an empty card', () => {
    const spec = geometrySpec(building({ height: 0, footprint: { w: 0, d: 0 } }), CELL);
    for (const part of spec.parts) {
      expect(part.h ?? part.r).toBeGreaterThan(0);
    }
  });
});

describe('floor banding', () => {
  const floors = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `f${i}` }));

  it('matches iso: nothing to band below two floors or one cell', () => {
    expect(bandLevels(building({ floors: floors(1), height: 4 }), CELL)).toEqual([]);
    expect(bandLevels(building({ floors: floors(6), height: 0.8 }), CELL)).toEqual([]);
  });

  it('spreads count-1 rings up the tower', () => {
    const levels = bandLevels(building({ floors: floors(4), height: 3 }), CELL);
    expect(levels).toHaveLength(3);
    expect(levels[0]).toBeCloseTo((3 * CELL) / 4, 9);
    expect(levels.at(-1)).toBeLessThan(3 * CELL);
  });

  it('caps rings at what the height can show', () => {
    // 12 floors on a 2-cell building can only read as 4 bands.
    const levels = bandLevels(building({ floors: floors(12), height: 2 }), CELL);
    expect(levels).toHaveLength(3);
  });
});

describe('palette hand-off', () => {
  it('asks the palette, never the DOM, and passes hover/selection through', () => {
    const seen: unknown[] = [];
    const palette = {
      building(b: unknown, state: unknown) {
        seen.push([b, state]);
        return { top: '#123456', left: '#000', right: '#111', outline: null, floorLine: '#222' };
      },
    };
    const b = building();
    expect(baseTone(b, palette as never, { hovered: true }).top).toBe('#123456');
    expect(seen).toEqual([[b, { hovered: true }]]);
  });
});

describe('route marker', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it('walks a polyline by arc length, exactly as iso does', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1, -3, 7]) {
      expect(pointAlong(path, t)).toEqual(isoPointAlong(path, t));
    }
  });

  it('survives degenerate paths', () => {
    expect(pointAlong([], 0.5)).toBeNull();
    expect(pointAlong([{ x: 4, y: 5 }], 0.5)).toEqual({ x: 4, y: 5 });
    expect(pointAlong([{ x: 4, y: 5 }, { x: 4, y: 5 }], 0.5)).toEqual({ x: 4, y: 5 });
  });
});

describe('lazy loading', () => {
  it('has not pulled three in just by importing the module', () => {
    expect(threeReady()).toBe(false);
  });
});

describe('mesh graph, on a stubbed GL context', () => {
  const cards = [
    { handle: 'FEATURE-TICKETS', type: 'FEATURE', name: 'Ticketing', body: 'Sell tickets.' },
    { handle: 'API-TICKETS', type: 'API', name: 'Tickets API', body: '## One\n## Two\n## Three' },
    { handle: 'DB-TICKETS', type: 'DB', name: 'tickets', body: '' },
    { handle: 'FILE-SERVER', type: 'FILE', name: 'server.ts', frontmatter: { path: 'src/server.ts' } },
    { handle: 'EXTERNAL-STRIPE', type: 'EXTERNAL', name: 'Stripe', body: '' },
    { handle: 'TEST-CHECKOUT', type: 'TEST', name: 'checkout', body: '' },
    { handle: 'EVENT-PAID', type: 'EVENT', name: 'paid', body: '' },
    { handle: 'AGENT-BOT', type: 'AGENT', name: 'bot', body: '' },
    { handle: 'DOC-OPS', type: 'DOC', name: 'ops', body: '' },
    {
      handle: 'FLOW-CHECKOUT',
      type: 'FLOW',
      name: 'Checkout',
      body: '1. [[API-TICKETS]]\n2. [[DB-TICKETS]]\n3. [[EVENT-PAID]]',
    },
  ].map((c) => ({ status: null, mtime: 0, frontmatter: {}, body: '', ...c }));

  const neighbors = new Map([
    ['FEATURE-TICKETS', new Set(['API-TICKETS', 'DB-TICKETS'])],
    ['API-TICKETS', new Set(['FEATURE-TICKETS', 'FILE-SERVER'])],
    ['DB-TICKETS', new Set(['FEATURE-TICKETS'])],
    ['FILE-SERVER', new Set(['API-TICKETS'])],
  ]);

  /** Everything the renderer is allowed to know about colour. */
  const palette = {
    grid: '#333333',
    edge: '#444444',
    scaffold: '#e0635d',
    routeDot: '#88aaff',
    routeCasing: '#0b0b0f',
    districtFont: '600 11px monospace',
    summaryFont: '400 11px sans-serif',
    building: () => ({
      top: '#7799cc',
      left: '#223344',
      right: '#445566',
      outline: '#cc785c',
      floorLine: '#334455',
    }),
    district: () => ({ fill: '#181820', line: '#3a3a44' }),
    districtLabel: () => '#eeeeee',
    districtSummary: () => '#999999',
    route: () => '#88aaff',
  };

  const size = { width: 900, height: 620 };

  // jsdom has no 2D context, so the district-label sprites resolve to null. That
  // is the branch the renderer already guards; stubbing it keeps the run quiet.
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  async function city() {
    await loadThree('three'); // bare specifier so vi.mock above applies
    const scene = buildScene({ cards, connections: [{ a: 'API-TICKETS', b: 'DB-TICKETS' }], neighbors });
    const renderer = new ThreeRenderer(document.createElement('canvas'));
    renderer.setScene(scene, palette);
    renderer.resize(size.width, size.height, 2);
    const view = fitProjected(projectedBounds(scene), size);
    renderer.draw(view, { ...size, hovered: null, selected: null, routeProgress: 0.4 });
    return { scene, renderer, view };
  }

  it('builds one pickable object per building and paints on demand', async () => {
    const { scene, renderer } = await city();
    expect(scene.buildings.length).toBeGreaterThan(5);
    expect(renderer.buildings.size).toBe(scene.buildings.length);
    expect(renderer.pickRoot.children).toHaveLength(scene.buildings.length);
    expect(renderer.renderer.calls).toBe(1);
    renderer.dispose();
  });

  it('picks the building iso would have drawn under that pixel', async () => {
    const { scene, renderer, view } = await city();
    for (const handle of ['DB-TICKETS', 'API-TICKETS', 'DOC-OPS']) {
      const b = scene.buildings.find((x) => x.handle === handle)!;
      // Halfway up the front face — inside every silhouette, on every engine.
      const p = project(b.x, b.y, (b.height * scene.cell) / 2);
      const hit = renderer.pick(view.tx + view.scale * p.x, view.ty + view.scale * p.y);
      expect(hit?.handle, handle).toBe(handle);
    }
    expect(renderer.pick(-10, -10)).toBeNull();
    renderer.dispose();
  });

  it('moves the route marker along the road as progress advances', async () => {
    const { renderer, view } = await city();
    expect(renderer.markers).toHaveLength(1);
    const start = renderer.markers[0].mesh.position.clone();
    renderer.draw(view, { ...size, routeProgress: 0.9 });
    expect(renderer.markers[0].mesh.position.equals(start)).toBe(false);
    renderer.dispose();
  });

  it('lights a hovered building and hands its shared material back after', async () => {
    const { renderer, view } = await city();
    const meshes = renderer.buildings.get('DB-TICKETS')!.meshes;
    const shared = meshes[0].material;
    renderer.draw(view, { ...size, hovered: 'DB-TICKETS' });
    expect(meshes[0].material).not.toBe(shared);
    expect(meshes[0].material.emissive.getHexString()).toBe('cc785c');
    renderer.draw(view, { ...size, hovered: null });
    expect(meshes[0].material).toBe(shared);
    renderer.dispose();
  });

  it('reveals a hovered card’s connections and hides them again', async () => {
    const { renderer, view } = await city();
    const lines = renderer.edges.get('API-TICKETS')!;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l: { visible: boolean }) => !l.visible)).toBe(true);
    renderer.draw(view, { ...size, hovered: 'API-TICKETS' });
    expect(lines.every((l: { visible: boolean }) => l.visible)).toBe(true);
    renderer.draw(view, { ...size, hovered: null });
    expect(lines.every((l: { visible: boolean }) => !l.visible)).toBe(true);
    renderer.dispose();
  });

  it('releases every GPU resource on dispose', async () => {
    const { renderer } = await city();
    expect(renderer.owned.length).toBeGreaterThan(10);
    renderer.dispose();
    expect(renderer.owned).toHaveLength(0);
    expect(renderer.buildings.size).toBe(0);
    expect(renderer.pickRoot.children).toHaveLength(0);
  });
});
