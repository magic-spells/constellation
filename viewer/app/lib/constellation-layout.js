// Pure, framework-free layout helpers for the Constellation graph view.
//
// This module owns the *physics* (d3-force configuration) and the geometry math
// (cluster anchors, BFS hop-distance, viewport fitting). It imports nothing from
// Puzzle and touches no DOM, so every function here is unit-testable in plain Node.
// The component drives the simulation and renders the canvas; it never re-implements
// any of this math.

import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceX,
  forceY,
} from 'd3-force';

/** Tunables shared by the layout module and the component so the two stay in sync. */
export const LAYOUT = {
  cardMinWidth: 136,
  cardMaxWidth: 220,
  cardHandleHeight: 46,
  cardDetailHeight: 56,
  linkDistance: 110,
  // Weak: in a densely cross-linked plan, strong links overpower type clustering and
  // smear the colours together. Keep links a gentle nudge; the type anchors do the work.
  linkStrength: 0.05,
  /** In focus mode links are slackened so they don't drag nodes off their ring. */
  focusLinkStrength: 0.05,
  /** Repulsion = -(chargeBase + chargeK·√degree): hubs push harder so dense rings spread. */
  chargeBase: 200,
  chargeK: 70,
  collidePad: 18,
  /** Strong: the type anchors must win over links so same-type cards pool into clusters. */
  clusterStrength: 0.32,
  ringGap: 220,
  /** Farthest explicit hop lane; deeper reachable nodes share this lane. */
  maxFocusHop: 3,
  /** Bounded outside lane for nodes unreachable from the focused card. */
  peripheryRings: 4,
  /** Focus mode: pull toward each node's (type-angle, hop-radius) target. */
  focusTargetStrength: 0.42,
  /** Focus mode: light, degree-independent repulsion so grouped cards don't overlap-stack. */
  focusCharge: 160,
  /** Fraction of each type's angular slot the wedge fills (rest is the gap between groups). */
  wedgeFill: 0.74,
  focusColumnGap: 42,
  focusRowGap: 60,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Deterministic card dimensions for a graph node. The canvas renderer draws a
 * readable card, while d3-force still gets one simple radius for collision.
 */
export function nodeDimensions(handle, name, degree = 0) {
  const hasDetail = !!name && name !== handle;
  const handleWidth = handle.length * 7.4 + 34;
  const nameWidth = hasDetail ? Math.min(name.length, 32) * 5.8 + 34 : 0;
  const w = clamp(
    Math.max(LAYOUT.cardMinWidth, handleWidth, nameWidth),
    LAYOUT.cardMinWidth,
    LAYOUT.cardMaxWidth,
  );
  const h = hasDetail ? LAYOUT.cardDetailHeight : LAYOUT.cardHandleHeight;
  const hubBonus = Math.min(18, Math.sqrt(degree) * 4);
  return { w, h, r: Math.hypot(w, h) / 2 + hubBonus };
}

/** Repulsion strength for a node, stronger for higher-degree hubs. */
export function chargeStrength(degree) {
  return -(LAYOUT.chargeBase + LAYOUT.chargeK * Math.sqrt(degree));
}

/**
 * Build the node/link arrays the simulation consumes from the plan's cards and the
 * flat connection list. Links to handles that aren't cards are dropped — d3's
 * forceLink throws on a link whose endpoint id has no node.
 */
export function buildGraph(cards, connections) {
  const present = new Set(cards.map((c) => c.handle));
  // Drop dangling endpoints and self-loops: a zero-length link divides by zero in
  // forceLink and NaNs the whole simulation. Self-loops can't occur from the current
  // indexer, but this is cheap insurance against a future relaxation or a crafted API.
  const valid = connections.filter(
    (c) => c.a !== c.b && present.has(c.a) && present.has(c.b),
  );
  const degree = new Map();
  for (const { a, b } of valid) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  const nodes = cards.map((c) => {
    const d = degree.get(c.handle) ?? 0;
    const size = nodeDimensions(c.handle, c.name, d);
    return {
      handle: c.handle,
      type: c.type,
      name: c.name,
      status: c.status,
      degree: d,
      ...size,
    };
  });
  const links = valid.map((c) => ({ source: c.a, target: c.b }));
  return { nodes, links };
}

/**
 * Place one anchor per type, evenly around a ring centred in the viewport. The caller
 * passes `types` already in its preferred order (e.g. grouped by nav section) so
 * related types land adjacent on the ring.
 */
export function clusterAnchors(types, width, height) {
  const anchors = new Map();
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
 * from the result (callers treat "absent" as the bounded outer lane).
 */
export function focusRadii(focused, neighbors) {
  const dist = new Map([[focused, 0]]);
  const queue = [focused];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const d = dist.get(cur);
    for (const nb of neighbors.get(cur) ?? []) {
      if (!dist.has(nb)) {
        dist.set(nb, d + 1);
        queue.push(nb);
      }
    }
  }
  return dist;
}

/**
 * Compute the pan/zoom transform that frames `nodes` within the viewport. The transform
 * convention is screen = translate(tx,ty) then scale(s): screenX = tx + s*worldX.
 */
export function fitToBounds(nodes, opts) {
  const { width, height, padding = 60, maxScale = 1.4 } = opts;
  if (nodes.length === 0) return { tx: 0, ty: 0, scale: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    minX = Math.min(minX, x - n.w / 2);
    minY = Math.min(minY, y - n.h / 2);
    maxX = Math.max(maxX, x + n.w / 2);
    maxY = Math.max(maxY, y + n.h / 2);
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const scale = Math.min(
    (width - padding * 2) / bw,
    (height - padding * 2) / bh,
    maxScale,
  );
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { tx: width / 2 - scale * cx, ty: height / 2 - scale * cy, scale };
}

/**
 * Create a configured simulation in the overview (type-cluster) state. It is returned
 * *stopped* — the caller starts/ticks it (so tests can `.tick(n)` synchronously and the
 * component can drive it on its own schedule).
 */
export function createSimulation(opts) {
  const { nodes, links, anchors, clusterStrength = LAYOUT.clusterStrength } = opts;
  return forceSimulation(nodes)
    .force(
      'link',
      forceLink(links)
        .id((d) => d.handle)
        .distance(LAYOUT.linkDistance)
        .strength(LAYOUT.linkStrength),
    )
    .force('charge', forceManyBody().strength((d) => chargeStrength(d.degree)))
    .force(
      'collide',
      forceCollide()
        .radius((d) => d.r + LAYOUT.collidePad)
        .strength(0.9),
    )
    .force(
      'x',
      forceX((d) => anchors.get(d.type)?.x ?? 0).strength(clusterStrength),
    )
    .force(
      'y',
      forceY((d) => anchors.get(d.type)?.y ?? 0).strength(clusterStrength),
    )
    .stop();
}

/**
 * Pan/zoom transform that frames a circle of `radius` around `center` (graph space)
 * in the viewport. Used to frame the focus ego-ring from its TARGET radii — stable
 * while the sim settles, unlike framing live-moving node positions.
 */
export function fitToCircle(center, radius, opts) {
  const { width, height, padding = 80, maxScale = 1.4 } = opts;
  const diameter = Math.max(1, radius * 2);
  const scale = Math.min(
    (width - padding * 2) / diameter,
    (height - padding * 2) / diameter,
    maxScale,
  );
  return {
    tx: width / 2 - scale * center.x,
    ty: height / 2 - scale * center.y,
    scale,
  };
}
