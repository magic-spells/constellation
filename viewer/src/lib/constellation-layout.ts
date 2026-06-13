// Pure, framework-free layout helpers for the Constellation graph view.
//
// This module owns the *physics* (d3-force configuration) and the geometry math
// (cluster anchors, BFS hop-distance, viewport fitting). It imports nothing from
// Svelte and touches no DOM, so every function here is unit-testable in plain Node.
// The component drives the simulation and renders the SVG; it never re-implements
// any of this math.

import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
  type ForceLink,
} from 'd3-force';
import type { Card, Connection } from './types';

export interface GraphNode extends SimulationNodeDatum {
  handle: string;
  type: string;
  name: string | null;
  status: string | null;
  /** Number of connections this card has — drives radius and hub handling. */
  degree: number;
  /** Render + collision radius. */
  r: number;
}

export type GraphLink = SimulationLinkDatum<GraphNode>;

export interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface Point {
  x: number;
  y: number;
}

/** Tunables shared by the layout module and the component so the two stay in sync. */
export const LAYOUT = {
  linkDistance: 70,
  linkStrength: 0.5,
  /** In focus mode links are slackened so they don't drag nodes off their ring. */
  focusLinkStrength: 0.05,
  /** Repulsion = -(chargeBase + chargeK·√degree): hubs push harder so dense rings spread. */
  chargeBase: 120,
  chargeK: 70,
  collidePad: 6,
  clusterStrength: 0.06,
  ringGap: 130,
  /** Multiplier on ringGap for nodes unreachable from the focused node. */
  peripheryRings: 6,
  /** Focus mode: pull toward each node's (type-angle, hop-radius) target. */
  focusTargetStrength: 0.35,
  /** Focus mode: light, degree-independent repulsion so wedges don't overlap-stack. */
  focusCharge: 30,
  /** Fraction of each type's angular slot the wedge fills (rest is the gap between groups). */
  wedgeFill: 0.8,
} as const;

/** Bigger circles for higher-degree hubs, with a hard cap so a mega-hub can't dominate. */
export function nodeRadius(degree: number): number {
  return 8 + Math.min(13, Math.sqrt(degree) * 3);
}

/** Repulsion strength for a node, stronger for higher-degree hubs. */
export function chargeStrength(degree: number): number {
  return -(LAYOUT.chargeBase + LAYOUT.chargeK * Math.sqrt(degree));
}

/**
 * Build the node/link arrays the simulation consumes from the plan's cards and the
 * flat connection list. Links to handles that aren't cards are dropped — d3's
 * forceLink throws on a link whose endpoint id has no node.
 */
export function buildGraph(cards: Card[], connections: Connection[]): Graph {
  const present = new Set(cards.map((c) => c.handle));
  // Drop dangling endpoints and self-loops: a zero-length link divides by zero in
  // forceLink and NaNs the whole simulation. Self-loops can't occur from the current
  // indexer, but this is cheap insurance against a future relaxation or a crafted API.
  const valid = connections.filter((c) => c.a !== c.b && present.has(c.a) && present.has(c.b));
  const degree = new Map<string, number>();
  for (const { a, b } of valid) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  const nodes: GraphNode[] = cards.map((c) => {
    const d = degree.get(c.handle) ?? 0;
    return {
      handle: c.handle,
      type: c.type,
      name: c.name,
      status: c.status,
      degree: d,
      r: nodeRadius(d),
    };
  });
  const links: GraphLink[] = valid.map((c) => ({ source: c.a, target: c.b }));
  return { nodes, links };
}

/**
 * Place one anchor per type, evenly around a ring centred in the viewport. The caller
 * passes `types` already in its preferred order (e.g. grouped by nav section) so
 * related types land adjacent on the ring.
 */
export function clusterAnchors(types: string[], width: number, height: number): Map<string, Point> {
  const anchors = new Map<string, Point>();
  const cx = width / 2;
  const cy = height / 2;
  const n = types.length;
  if (n === 0) return anchors;
  if (n === 1) {
    anchors.set(types[0], { x: cx, y: cy });
    return anchors;
  }
  const radius = Math.min(width, height) * 0.34;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2; // first anchor at top
    anchors.set(types[i], {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }
  return anchors;
}

/**
 * BFS hop-distance from `focused` to every reachable node over the undirected
 * adjacency map. The focused node is distance 0; unreachable nodes are simply absent
 * from the result (callers treat "absent" as the far periphery).
 */
export function focusRadii(focused: string, neighbors: Map<string, string[]>): Map<string, number> {
  const dist = new Map<string, number>([[focused, 0]]);
  const queue = [focused];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const d = dist.get(cur)!;
    for (const nb of neighbors.get(cur) ?? []) {
      if (!dist.has(nb)) {
        dist.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  return dist;
}

/** Map a hop-distance to a target ring radius; unreachable (undefined/Infinity) → periphery. */
export function ringRadius(hop: number | undefined, ringGap = LAYOUT.ringGap): number {
  if (hop === undefined || !Number.isFinite(hop)) return ringGap * LAYOUT.peripheryRings;
  return hop * ringGap;
}

/**
 * Compute the pan/zoom transform that frames `nodes` within the viewport. The transform
 * convention is screen = translate(tx,ty) then scale(s): screenX = tx + s*worldX.
 */
export function fitToBounds(
  nodes: GraphNode[],
  opts: { width: number; height: number; padding?: number; maxScale?: number },
): { tx: number; ty: number; scale: number } {
  const { width, height, padding = 60, maxScale = 1.4 } = opts;
  if (nodes.length === 0) return { tx: 0, ty: 0, scale: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    minX = Math.min(minX, x - n.r);
    minY = Math.min(minY, y - n.r);
    maxX = Math.max(maxX, x + n.r);
    maxY = Math.max(maxY, y + n.r);
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const scale = Math.min((width - padding * 2) / bw, (height - padding * 2) / bh, maxScale);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { tx: width / 2 - scale * cx, ty: height / 2 - scale * cy, scale };
}

/**
 * Create a configured simulation in the overview (type-cluster) state. It is returned
 * *stopped* — the caller starts/ticks it (so tests can `.tick(n)` synchronously and the
 * component can drive it on its own schedule).
 */
export function createSimulation(opts: {
  nodes: GraphNode[];
  links: GraphLink[];
  anchors: Map<string, Point>;
  clusterStrength?: number;
}): Simulation<GraphNode, GraphLink> {
  const { nodes, links, anchors, clusterStrength = LAYOUT.clusterStrength } = opts;
  return forceSimulation<GraphNode, GraphLink>(nodes)
    .force(
      'link',
      forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.handle)
        .distance(LAYOUT.linkDistance)
        .strength(LAYOUT.linkStrength),
    )
    .force('charge', forceManyBody<GraphNode>().strength((d) => chargeStrength(d.degree)))
    .force('collide', forceCollide<GraphNode>().radius((d) => d.r + LAYOUT.collidePad).strength(0.9))
    .force('x', forceX<GraphNode>((d) => anchors.get(d.type)?.x ?? 0).strength(clusterStrength))
    .force('y', forceY<GraphNode>((d) => anchors.get(d.type)?.y ?? 0).strength(clusterStrength))
    .stop();
}

/**
 * Compute the focus-mode target point for every non-focused node: **angle encodes the
 * card's type, radius encodes its hop-distance** from the focused node. Each type owns
 * an evenly-spaced angular wedge (so DATATYPE, DOC, … each stay a coherent group), and
 * within a wedge nodes fan out per hop-ring — so the cards *connected* to the focused
 * node land on the inner rings, closest to the centre, while their type stays legible.
 *
 * `types` fixes the angular order of the wedges (pass the same order as the legend so
 * the view is stable); when empty it is derived from the nodes in first-seen order.
 * Unreachable nodes go to the periphery radius but keep their type's angle. Members of a
 * (type, hop) cell are sorted by handle for deterministic placement.
 */
export function focusTargets(
  nodes: GraphNode[],
  focused: GraphNode,
  hops: Map<string, number>,
  types: string[],
  center: Point,
  ringGap = LAYOUT.ringGap,
): Map<string, Point> {
  const targets = new Map<string, Point>();
  const order = types.length ? types : [...new Set(nodes.map((n) => n.type))];
  const n = Math.max(1, order.length);
  const typeIndex = new Map(order.map((t, i) => [t, i]));
  const slot = (2 * Math.PI) / n;
  const fullCircle = n === 1; // a single type spreads all the way round
  const wedgeHalf = fullCircle ? Math.PI : (slot * LAYOUT.wedgeFill) / 2;

  // Bucket non-focused nodes by (type, hop): each cell fans across its type's wedge at one radius.
  const cells = new Map<string, { type: string; hop: number; members: GraphNode[] }>();
  for (const nd of nodes) {
    if (nd.handle === focused.handle) continue;
    const raw = hops.get(nd.handle);
    const hop = raw === undefined || !Number.isFinite(raw) ? Infinity : raw;
    const key = `${nd.type} ${hop}`;
    const cell = cells.get(key);
    if (cell) cell.members.push(nd);
    else cells.set(key, { type: nd.type, hop, members: [nd] });
  }

  for (const { type, hop, members } of cells.values()) {
    members.sort((a, b) => (a.handle < b.handle ? -1 : 1));
    const radius = ringRadius(Number.isFinite(hop) ? hop : undefined, ringGap);
    const base = (typeIndex.get(type) ?? 0) * slot - Math.PI / 2; // first type's centre at the top
    const k = members.length;
    members.forEach((nd, i) => {
      const theta =
        k === 1
          ? base
          : fullCircle
            ? base + (2 * Math.PI * i) / k // wrap fully, no duplicate endpoints
            : base - wedgeHalf + (2 * wedgeHalf * i) / (k - 1);
      targets.set(nd.handle, {
        x: center.x + radius * Math.cos(theta),
        y: center.y + radius * Math.sin(theta),
      });
    });
  }
  return targets;
}

/** Pre-seed node positions from precomputed focus targets so the sim starts already arranged. */
export function seedFocusTargets(nodes: GraphNode[], targets: Map<string, Point>): void {
  for (const n of nodes) {
    const t = targets.get(n.handle);
    if (!t) continue;
    n.x = t.x;
    n.y = t.y;
    n.vx = 0;
    n.vy = 0;
  }
}

/**
 * Switch the simulation into focus state: arrange every other node by **type (angle) and
 * hop-distance (radius)**, pin `focused` to `center`, slacken links, and soften charge so
 * the positional targets — not the physics — own the layout. The caller re-heats afterwards
 * (`sim.alpha(…).restart()`). `center` must be a fixed GRAPH-space point — never a screen
 * coordinate; viewport centring is a separate transform tween. `types` sets the wedge order.
 */
export function enterFocus(
  sim: Simulation<GraphNode, GraphLink>,
  nodes: GraphNode[],
  focused: GraphNode,
  hops: Map<string, number>,
  center: Point,
  types: string[] = [],
  ringGap = LAYOUT.ringGap,
): void {
  const targets = focusTargets(nodes, focused, hops, types, center, ringGap);
  seedFocusTargets(nodes, targets);

  // Release any pin from a prior focus (switching focus) before pinning the new one.
  for (const n of nodes) {
    n.fx = null;
    n.fy = null;
  }
  focused.fx = center.x;
  focused.fy = center.y;

  sim.force('radial', null);
  (sim.force('link') as ForceLink<GraphNode, GraphLink> | undefined)?.strength(LAYOUT.focusLinkStrength);
  sim.force('charge', forceManyBody<GraphNode>().strength(-LAYOUT.focusCharge));
  sim.force(
    'x',
    forceX<GraphNode>((d) => targets.get(d.handle)?.x ?? center.x).strength((d) =>
      d.handle === focused.handle ? 0 : LAYOUT.focusTargetStrength,
    ),
  );
  sim.force(
    'y',
    forceY<GraphNode>((d) => targets.get(d.handle)?.y ?? center.y).strength((d) =>
      d.handle === focused.handle ? 0 : LAYOUT.focusTargetStrength,
    ),
  );
}

/** Restore the overview (type-cluster) state: unpin, drop radial, restore charge/links/x/y. */
export function exitFocus(
  sim: Simulation<GraphNode, GraphLink>,
  nodes: GraphNode[],
  anchors: Map<string, Point>,
  clusterStrength = LAYOUT.clusterStrength,
): void {
  for (const n of nodes) {
    n.fx = null;
    n.fy = null;
  }
  sim.force('radial', null);
  (sim.force('link') as ForceLink<GraphNode, GraphLink> | undefined)?.strength(LAYOUT.linkStrength);
  sim.force('charge', forceManyBody<GraphNode>().strength((d) => chargeStrength(d.degree)));
  sim.force('x', forceX<GraphNode>((d) => anchors.get(d.type)?.x ?? 0).strength(clusterStrength));
  sim.force('y', forceY<GraphNode>((d) => anchors.get(d.type)?.y ?? 0).strength(clusterStrength));
}

/**
 * Pan/zoom transform that frames a circle of `radius` around `center` (graph space)
 * in the viewport. Used to frame the focus ego-ring from its TARGET radii — stable
 * while the sim settles, unlike framing live-moving node positions.
 */
export function fitToCircle(
  center: Point,
  radius: number,
  opts: { width: number; height: number; padding?: number; maxScale?: number },
): { tx: number; ty: number; scale: number } {
  const { width, height, padding = 80, maxScale = 1.4 } = opts;
  const diameter = Math.max(1, radius * 2);
  const scale = Math.min((width - padding * 2) / diameter, (height - padding * 2) / diameter, maxScale);
  return { tx: width / 2 - scale * center.x, ty: height / 2 - scale * center.y, scale };
}
