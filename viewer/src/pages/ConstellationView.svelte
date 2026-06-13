<script lang="ts">
  import { untrack } from 'svelte';
  import { plan, route, theme } from '../lib/state.svelte';
  import { TYPE_META } from '../lib/types';
  import {
    buildGraph,
    createSimulation,
    clusterAnchors,
    focusRadii,
    focusTargets,
    focusTargetRadius,
    fitToBounds,
    fitToCircle,
    type GraphNode,
    type GraphLink,
    type Point,
  } from '../lib/constellation-layout';

  // A graph node plus the extra positions the animation model needs:
  //   ox/oy — the cached overview "home" (so un-focusing returns here, no re-settle)
  //   px/py — the start position for the current transition
  type VNode = GraphNode & { ox?: number; oy?: number; px?: number; py?: number };

  // ── Reactive state (drives the template/legend/search; NOT the per-frame draw) ──
  let nodes = $state.raw<VNode[]>([]);
  let links = $state.raw<GraphLink[]>([]);
  let focused = $state<string | null>(null);
  let hovered = $state<string | null>(null);
  let query = $state('');
  let reduceMotion = $state(false);
  let width = $state(0);
  let height = $state(0);
  let canvasEl = $state<HTMLCanvasElement>();

  // ── Plain (non-reactive) machinery — the canvas is painted imperatively ──────────
  let tx = 0;
  let ty = 0;
  let scale = 1;
  let ctx: CanvasRenderingContext2D | null = null;
  let anchors = new Map<string, Point>();
  let graphCenter: Point = { x: 0, y: 0 };
  let initialized = false;
  let fitted = false;
  let egoSet: Set<string> | null = null; // when focused: focused + the neighbourhood we show

  // The layout is computed instantly (off-screen); these drive the *visible* motion.
  let transBefore = new Set<string>();
  let transAfter = new Set<string>();
  const na = { active: false, start: 0, dur: 650, t: 0 }; // node transition
  const vp = { active: false, from: { tx: 0, ty: 0, scale: 1 }, target: { tx: 0, ty: 0, scale: 1 }, start: 0, dur: 520 }; // viewport tween
  let loopRaf: number | null = null;
  let pendingDraw = false;

  // Travel under this many *screen* pixels glides; longer hops fade-out/pop-in instead.
  const SHORT_SCREEN = 280;
  // Focus shows the selected card + this many hops, capped so a hub doesn't explode.
  const EGO_HOPS = 2;
  const EGO_CAP = 90;
  const SETTLE_INITIAL = 260;
  const SETTLE_RESEED = 70;

  const colors = {
    edge: '#888',
    accent: '#88f',
    bg: '#000',
    panel: '#111',
    text: '#aaa',
    textStrong: '#fff',
    type: {} as Record<string, string>,
    fill: {} as Record<string, string>,
  };

  function darkenHex(color: string, factor = 0.28, fallback = '#111'): string {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!m) return fallback;
    const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    const ch = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * factor).toString(16).padStart(2, '0');
    return `#${ch(0)}${ch(2)}${ch(4)}`;
  }

  function refreshColors(): void {
    const cs = getComputedStyle(document.documentElement);
    const get = (v: string, fallback: string) => cs.getPropertyValue(v).trim() || fallback;
    colors.edge = get('--border-strong', '#888');
    colors.accent = get('--accent', '#88f');
    colors.bg = get('--bg', '#000');
    colors.panel = get('--bg-panel', '#111');
    colors.text = get('--text-muted', '#aaa');
    colors.textStrong = get('--text', '#fff');
    const type: Record<string, string> = {};
    const fill: Record<string, string> = {};
    for (const t of new Set(nodes.map((n) => n.type))) {
      type[t] = get('--t-' + t, colors.accent);
      fill[t] = darkenHex(type[t], 0.28, colors.panel);
    }
    colors.type = type;
    colors.fill = fill;
  }

  const empty = $derived(plan.loaded && plan.cards.length === 0);

  function node(handle: string): VNode | undefined {
    return nodes.find((n) => n.handle === handle);
  }

  function orderedTypes(ns: VNode[]): string[] {
    const present = new Set(ns.map((n) => n.type));
    return Object.keys(TYPE_META).filter((t) => present.has(t));
  }

  function currentVisible(): Set<string> {
    return focused && egoSet ? new Set(egoSet) : new Set(nodes.map((n) => n.handle));
  }

  // Focused card + 1 hop (always) + further hops while the set stays small.
  function computeEgo(handle: string, hops: Map<string, number>): Set<string> {
    const ego = new Set<string>([handle]);
    const tiers = new Map<number, string[]>();
    for (const [h, d] of hops) {
      if (d < 1) continue;
      const tier = tiers.get(d);
      if (tier) tier.push(h);
      else tiers.set(d, [h]);
    }
    for (let d = 1; d <= EGO_HOPS; d++) {
      const tier = tiers.get(d) ?? [];
      if (d > 1 && ego.size + tier.length > EGO_CAP) break;
      for (const h of tier) ego.add(h);
    }
    return ego;
  }

  // ── Reseed: the ONLY effect that touches the graph. Tracks plan.cards/connections
  //    and nothing else; component-local reads are untracked.
  $effect(() => {
    const cards = plan.cards;
    const connections = plan.connections;
    untrack(() => reseed(cards, connections));
  });

  function reseed(cards: typeof plan.cards, connections: typeof plan.connections): void {
    const built = buildGraph(cards, connections) as { nodes: VNode[]; links: GraphLink[] };
    const prev = new Map(nodes.map((n) => [n.handle, n]));

    const side = Math.max(1100, Math.sqrt(built.nodes.length) * 260);
    graphCenter = { x: side / 2, y: side / 2 };
    const types = orderedTypes(built.nodes);
    anchors = clusterAnchors(types, side, side);

    // Seed survivors at their cached home so the synchronous settle barely moves them.
    for (const n of built.nodes) {
      const old = prev.get(n.handle);
      if (old) {
        n.x = old.ox ?? old.x;
        n.y = old.oy ?? old.y;
      }
    }

    // First non-empty layout settles fully; later reseeds (survivors pre-seeded) need few ticks.
    const firstReal = !initialized && built.nodes.length > 0;

    // Settle to equilibrium OFF-SCREEN (no visible shoving), then cache the home layout.
    const sim = createSimulation({ nodes: built.nodes, links: built.links, anchors });
    sim.tick(firstReal ? SETTLE_INITIAL : SETTLE_RESEED);
    sim.stop();
    for (const n of built.nodes) {
      n.ox = n.x;
      n.oy = n.y;
    }

    // Transition bookkeeping: survivors glide from their old spot; brand-new cards fade in.
    const before = new Set<string>();
    for (const n of built.nodes) {
      const old = prev.get(n.handle);
      if (old) {
        n.px = old.x ?? n.x ?? 0;
        n.py = old.y ?? n.y ?? 0;
        before.add(n.handle);
      } else {
        n.px = n.x ?? 0;
        n.py = n.y ?? 0;
      }
    }

    nodes = built.nodes;
    links = built.links;
    refreshColors();

    let after: Set<string>;
    if (focused && built.nodes.some((n) => n.handle === focused)) {
      // Re-apply a still-valid focus across the reload.
      const f = node(focused)!;
      const hops = focusRadii(focused, plan.neighbors);
      const targets = focusTargets(built.nodes, f, hops, types, graphCenter);
      egoSet = computeEgo(focused, hops);
      f.x = graphCenter.x;
      f.y = graphCenter.y;
      for (const n of built.nodes) {
        if (n.handle === focused) continue;
        if (egoSet.has(n.handle)) {
          const t = targets.get(n.handle);
          if (t) {
            n.x = t.x;
            n.y = t.y;
          }
        }
      }
      after = egoSet;
    } else {
      focused = null;
      egoSet = null;
      after = new Set(built.nodes.map((n) => n.handle));
    }

    if (firstReal) {
      const t = fitToBounds(built.nodes, { width: width || 800, height: height || 600 });
      tx = t.tx;
      ty = t.ty;
      scale = t.scale;
      initialized = true;
    }
    startNodeAnim(before, after);
  }

  // Stop the rAF loop when the view unmounts.
  $effect(() => {
    return () => {
      if (loopRaf != null) cancelAnimationFrame(loopRaf);
      loopRaf = null;
      na.active = false;
      vp.active = false;
    };
  });

  // Reduced-motion preference (live).
  $effect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = mq.matches;
    const onChange = (e: MediaQueryListEvent) => (reduceMotion = e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  // Frame the overview once real dimensions arrive (bind:clientWidth lands post-mount).
  $effect(() => {
    if (fitted || width <= 0 || height <= 0 || nodes.length === 0) return;
    if (!focused) {
      const t = fitToBounds(nodes, { width, height });
      tx = t.tx;
      ty = t.ty;
      scale = t.scale;
      requestDraw();
    }
    fitted = true;
  });

  // Size the canvas backing store for crisp HiDPI rendering.
  $effect(() => {
    if (!canvasEl || width <= 0 || height <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.round(width * dpr);
    canvasEl.height = Math.round(height * dpr);
    requestDraw();
  });

  // Recolour on theme change (and on reseed, when new types appear).
  $effect(() => {
    theme.current;
    refreshColors();
    requestDraw();
  });

  // Repaint when selection or the search highlight changes.
  $effect(() => {
    focused;
    searchMatches;
    requestDraw();
  });

  // ── Search ──────────────────────────────────────────────────────────────────
  const searchMatches = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<string>();
    for (const n of nodes) {
      if (n.handle.toLowerCase().includes(q) || (n.name ?? '').toLowerCase().includes(q)) set.add(n.handle);
    }
    return set;
  });

  const results = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: { handle: string; name: string | null; type: string }[] = [];
    for (const n of nodes) {
      if (n.handle.toLowerCase().includes(q) || (n.name ?? '').toLowerCase().includes(q)) {
        out.push({ handle: n.handle, name: n.name, type: n.type });
        if (out.length >= 10) break;
      }
    }
    return out;
  });

  function selectResult(handle: string): void {
    query = '';
    focusNode(handle);
  }

  function onSearchKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && results.length) {
      e.preventDefault();
      selectResult(results[0].handle);
    } else if (e.key === 'Escape') {
      query = '';
      (e.currentTarget as HTMLInputElement).blur();
    }
  }

  const highlightSet = $derived.by(() => {
    if (!focused) return null;
    const s = new Set<string>([focused]);
    for (const nb of plan.neighbors.get(focused) ?? []) s.add(nb);
    return s;
  });
  const presentTypes = $derived(orderedTypes(nodes));
  const focusedCard = $derived(focused ? plan.byHandle.get(focused) : undefined);

  // ── Focus / selection ─────────────────────────────────────────────────────────
  function focusNode(handle: string): void {
    const f = node(handle);
    if (!f) return;
    const before = currentVisible();
    const hops = focusRadii(handle, plan.neighbors);
    const targets = focusTargets(nodes, f, hops, orderedTypes(nodes), graphCenter);
    const ego = computeEgo(handle, hops);
    focused = handle;
    egoSet = ego;

    beginTransition(before, ego, () => {
      f.x = graphCenter.x;
      f.y = graphCenter.y;
      for (const n of nodes) {
        if (n.handle === handle || !ego.has(n.handle)) continue; // non-ego cards fade out in place
        const t = targets.get(n.handle);
        if (t) {
          n.x = t.x;
          n.y = t.y;
        }
      }
    });

    // Frame only the ego neighbourhood (zoom IN), not the hidden remainder.
    const egoTargets = new Map<string, Point>();
    for (const h of ego) {
      if (h === handle) continue;
      const t = targets.get(h);
      if (t) egoTargets.set(h, t);
    }
    const r = focusTargetRadius(nodes, egoTargets, graphCenter);
    tweenTo(fitToCircle(graphCenter, r + 90, { width: width || 800, height: height || 600 }));
  }

  function clearFocus(): void {
    if (focused === null) return;
    const before = currentVisible();
    focused = null;
    egoSet = null;
    beginTransition(before, new Set(nodes.map((n) => n.handle)), () => {
      for (const n of nodes) {
        n.x = n.ox ?? n.x;
        n.y = n.oy ?? n.y;
      }
    });
    tweenTo(fitToBounds(nodes, { width: width || 800, height: height || 600 }));
  }

  function toggleFocus(handle: string): void {
    if (focused === handle) clearFocus();
    else focusNode(handle);
  }

  // ── Animation driver: one rAF loop advances the node transition + viewport tween ──
  function easeOutCubic(k: number): number {
    return 1 - Math.pow(1 - k, 3);
  }
  function easeInOutCubic(k: number): number {
    return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  }

  function ensureLoop(): void {
    if (loopRaf == null) loopRaf = requestAnimationFrame(frame);
  }
  function requestDraw(): void {
    pendingDraw = true;
    ensureLoop();
  }

  function frame(now: number): void {
    loopRaf = null;
    let cont = false;
    if (vp.active) {
      const k = Math.min(1, (now - vp.start) / vp.dur);
      const e = easeOutCubic(k);
      tx = vp.from.tx + (vp.target.tx - vp.from.tx) * e;
      ty = vp.from.ty + (vp.target.ty - vp.from.ty) * e;
      scale = vp.from.scale + (vp.target.scale - vp.from.scale) * e;
      if (k < 1) cont = true;
      else vp.active = false;
    }
    if (na.active) {
      const k = Math.min(1, (now - na.start) / na.dur);
      na.t = easeInOutCubic(k);
      if (k < 1) cont = true;
      else {
        na.active = false;
        for (const n of nodes) {
          n.px = n.x ?? 0;
          n.py = n.y ?? 0;
        }
      }
    }
    draw();
    pendingDraw = false;
    if (cont || pendingDraw) ensureLoop();
  }

  function startNodeAnim(before: Set<string>, after: Set<string>): void {
    transBefore = before;
    transAfter = after;
    if (reduceMotion) {
      for (const n of nodes) {
        n.px = n.x ?? 0;
        n.py = n.y ?? 0;
      }
      na.active = false;
      requestDraw();
      return;
    }
    na.start = performance.now();
    na.t = 0;
    na.active = true;
    ensureLoop();
  }

  function beginTransition(before: Set<string>, after: Set<string>, setTargets: () => void): void {
    for (const n of nodes) {
      n.px = n.x ?? 0;
      n.py = n.y ?? 0;
    }
    setTargets();
    startNodeAnim(before, after);
  }

  function tweenTo(target: { tx: number; ty: number; scale: number }): void {
    if (reduceMotion) {
      tx = target.tx;
      ty = target.ty;
      scale = target.scale;
      requestDraw();
      return;
    }
    vp.from = { tx, ty, scale };
    vp.target = target;
    vp.start = performance.now();
    vp.active = true;
    ensureLoop();
  }

  // ── Per-node render state (position, alpha, scale) for the current frame ─────────
  type RenderState = { draw: boolean; x: number; y: number; alpha: number; scale: number };
  function nodeRender(n: VNode): RenderState {
    const nx = n.x ?? 0;
    const ny = n.y ?? 0;
    if (na.active) {
      const vb = transBefore.has(n.handle);
      const va = transAfter.has(n.handle);
      if (!vb && !va) return { draw: false, x: 0, y: 0, alpha: 0, scale: 1 };
      const t = na.t;
      if (vb && va) {
        const px = n.px ?? nx;
        const py = n.py ?? ny;
        const dx = nx - px;
        const dy = ny - py;
        if (Math.hypot(dx, dy) * scale < SHORT_SCREEN) {
          return { draw: true, x: px + dx * t, y: py + dy * t, alpha: 1, scale: 1 - 0.12 * Math.sin(Math.PI * t) };
        }
        if (t < 0.5) {
          const k = t / 0.5;
          return { draw: true, x: px, y: py, alpha: 1 - k, scale: 1 - 0.55 * k };
        }
        const k = (t - 0.5) / 0.5;
        return { draw: true, x: nx, y: ny, alpha: k, scale: 0.45 + 0.55 * k };
      }
      if (vb) return { draw: true, x: n.px ?? nx, y: n.py ?? ny, alpha: 1 - t, scale: 1 - 0.4 * t }; // leaving
      return { draw: true, x: nx, y: ny, alpha: t, scale: 0.6 + 0.4 * t }; // entering
    }
    // settled
    if (focused && egoSet && !egoSet.has(n.handle)) return { draw: false, x: 0, y: 0, alpha: 0, scale: 1 };
    let alpha = 1;
    if (focused) alpha = n.handle === focused || (highlightSet?.has(n.handle) ?? false) ? 1 : 0.5;
    else if (searchMatches) alpha = searchMatches.has(n.handle) ? 1 : 0.16;
    return { draw: true, x: nx, y: ny, alpha, scale: 1 };
  }

  // ── Canvas drawing ──────────────────────────────────────────────────────────
  function roundedRectPath(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  function fitText(c: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (c.measureText(text).width <= maxWidth) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (c.measureText(text.slice(0, mid) + '...').width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return lo <= 0 ? '' : text.slice(0, lo) + '...';
  }

  function draw(): void {
    if (!canvasEl) return;
    ctx ??= canvasEl.getContext('2d');
    if (!ctx) return;
    const c = ctx;
    const dpr = window.devicePixelRatio || 1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, width, height);

    const settled = !na.active;

    c.save();
    c.translate(tx, ty);
    c.scale(scale, scale);

    // Edges only in the settled state — during a transition cards move/fade and edges
    // would smear. Overview draws no edges (a 2.4k-edge hairball); they appear on
    // focus/hover/search.
    if (settled) {
      for (const l of links) {
        const s = l.source as GraphNode;
        const t = l.target as GraphNode;
        let active = false;
        let hot = false;
        if (focused && egoSet) {
          if (!egoSet.has(s.handle) || !egoSet.has(t.handle)) continue;
          active = true;
          hot = s.handle === focused || t.handle === focused;
        } else if (hovered) {
          active = s.handle === hovered || t.handle === hovered;
          hot = true;
        } else if (searchMatches) {
          active = searchMatches.has(s.handle) || searchMatches.has(t.handle);
        }
        if (!active) continue;
        c.globalAlpha = hot ? 0.95 : 0.5;
        c.strokeStyle = hot ? colors.accent : colors.edge;
        c.lineWidth = (hot ? 2.2 : 1.3) / scale;
        c.beginPath();
        c.moveTo(s.x ?? 0, s.y ?? 0);
        c.lineTo(t.x ?? 0, t.y ?? 0);
        c.stroke();
      }
      c.globalAlpha = 1;
    }

    for (const n of nodes) {
      const st = nodeRender(n);
      if (!st.draw) continue;
      const w = n.w * st.scale;
      const h = n.h * st.scale;
      const left = st.x - w / 2;
      const top = st.y - h / 2;
      c.globalAlpha = st.alpha;
      roundedRectPath(c, left, top, w, h, 7 * st.scale);
      c.fillStyle = colors.fill[n.type] ?? colors.panel;
      c.fill();
      c.lineWidth = 1.3 / scale;
      c.strokeStyle = colors.type[n.type] ?? colors.accent;
      c.stroke();
      if (settled && (n.handle === focused || n.handle === hovered)) {
        roundedRectPath(c, left - 2 / scale, top - 2 / scale, w + 4 / scale, h + 4 / scale, 9);
        c.lineWidth = (n.handle === focused ? 2.6 : 2) / scale;
        c.strokeStyle = colors.accent;
        c.stroke();
      }
    }
    c.globalAlpha = 1;
    c.restore();

    // Labels — settled state only, in crisp screen space.
    if (settled) {
      c.textAlign = 'left';
      c.textBaseline = 'top';
      c.lineJoin = 'round';
      for (const n of nodes) {
        const st = nodeRender(n);
        if (!st.draw || st.alpha < 0.35) continue;
        const sx = tx + scale * ((n.x ?? 0) - n.w / 2);
        const sy = ty + scale * ((n.y ?? 0) - n.h / 2);
        const sw = n.w * scale;
        const sh = n.h * scale;
        if (sx > width + 40 || sx + sw < -40 || sy > height + 40 || sy + sh < -40) continue;
        if (sw < 58 || sh < 20) continue;
        c.save();
        roundedRectPath(c, sx, sy, sw, sh, Math.min(7 * scale, 7));
        c.clip();
        c.globalAlpha = st.alpha;
        const compact = sh < 34;
        const handleSize = compact ? 9 : 11;
        const padX = Math.max(10, Math.min(14, sw * 0.08));
        const topPad = compact ? Math.max(4, (sh - handleSize) / 2 - 1) : Math.max(7, Math.min(10, sh * 0.18));
        const textX = sx + padX + Math.max(3, 5 * scale);
        const maxText = sw - padX * 2 - Math.max(6, 8 * scale);
        c.font = `600 ${handleSize}px ui-monospace, Menlo, monospace`;
        c.fillStyle = colors.textStrong;
        c.fillText(fitText(c, n.handle, maxText), textX, sy + topPad);
        if (!compact && n.name && n.name !== n.handle && sh >= 42) {
          c.font = '10px Avenir Next, Seravek, Segoe UI, sans-serif';
          c.fillStyle = colors.text;
          c.fillText(fitText(c, n.name, maxText), textX, sy + topPad + 18);
        }
        c.restore();
      }
    }
  }

  // ── Hit-testing + coordinate helpers ──────────────────────────────────────────
  function visibleForHit(n: VNode): boolean {
    return !(focused && egoSet && !egoSet.has(n.handle));
  }
  function findNodeAt(clientX: number, clientY: number): VNode | undefined {
    if (!canvasEl) return undefined;
    const rect = canvasEl.getBoundingClientRect();
    const gx = (clientX - rect.left - tx) / scale;
    const gy = (clientY - rect.top - ty) / scale;
    let best: VNode | undefined;
    let bestD = Infinity;
    const pad = 6 / Math.max(scale, 0.1);
    for (const n of nodes) {
      if (!visibleForHit(n)) continue;
      const dx = (n.x ?? 0) - gx;
      const dy = (n.y ?? 0) - gy;
      if (Math.abs(dx) <= n.w / 2 + pad && Math.abs(dy) <= n.h / 2 + pad) {
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
    }
    return best;
  }

  function toGraph(clientX: number, clientY: number): Point {
    const rect = canvasEl!.getBoundingClientRect();
    return { x: (clientX - rect.left - tx) / scale, y: (clientY - rect.top - ty) / scale };
  }

  // ── Viewport: zoom, fit ────────────────────────────────────────────────────────
  function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
  }
  function zoomBy(factor: number): void {
    const cx = width / 2;
    const cy = height / 2;
    const ns = clamp(scale * factor, 0.05, 4);
    tx = cx - ((cx - tx) / scale) * ns;
    ty = cy - ((cy - ty) / scale) * ns;
    scale = ns;
    requestDraw();
  }
  function fitAll(): void {
    if (nodes.length) tweenTo(fitToBounds(nodes, { width: width || 800, height: height || 600 }));
  }
  function resetView(): void {
    if (focused) clearFocus();
    else fitAll();
  }

  const ZOOM_WHEEL = 0.0015;
  const ZOOM_PINCH = 0.004;
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = canvasEl!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const k = e.ctrlKey ? ZOOM_PINCH : ZOOM_WHEEL;
    const ns = clamp(scale * Math.exp(-e.deltaY * k), 0.05, 4);
    tx = px - ((px - tx) / scale) * ns;
    ty = py - ((py - ty) / scale) * ns;
    scale = ns;
    requestDraw();
  }

  // ── Drag (node move / background pan; no-move = click). No live physics. ─────────
  type Drag = { mode: 'pan' | 'node'; handle?: string; startX: number; startY: number; lastX: number; lastY: number; moved: boolean };
  let drag: Drag | null = null;

  function onPointerDown(e: PointerEvent): void {
    canvasEl!.setPointerCapture(e.pointerId);
    const hit = findNodeAt(e.clientX, e.clientY);
    drag = {
      mode: hit ? 'node' : 'pan',
      handle: hit?.handle,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag) {
      const hit = findNodeAt(e.clientX, e.clientY);
      const h = hit ? hit.handle : null;
      if (h !== hovered) {
        hovered = h;
        requestDraw();
      }
      if (canvasEl) canvasEl.style.cursor = hit ? 'pointer' : 'grab';
      return;
    }
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) drag.moved = true;
    if (drag.mode === 'pan') {
      tx += e.clientX - drag.lastX;
      ty += e.clientY - drag.lastY;
    } else if (drag.handle) {
      const g = toGraph(e.clientX, e.clientY);
      const n = node(drag.handle);
      if (n) {
        n.x = g.x;
        n.y = g.y;
        n.px = g.x;
        n.py = g.y;
      }
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    requestDraw();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!drag) return;
    const d = drag;
    drag = null;
    canvasEl!.releasePointerCapture?.(e.pointerId);
    if (d.mode === 'pan') {
      if (!d.moved) clearFocus();
      return;
    }
    if (!d.moved && d.handle) {
      toggleFocus(d.handle);
    } else if (d.handle) {
      const n = node(d.handle);
      if (n && !focused) {
        // Dropped in the overview: remember its new home.
        n.ox = n.x;
        n.oy = n.y;
      }
    }
  }

  function onDblClick(e: MouseEvent): void {
    const hit = findNodeAt(e.clientX, e.clientY);
    if (hit) route.go('/card/' + hit.handle);
  }

  function onCanvasKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') clearFocus();
  }
</script>

<div class="constellation" bind:clientWidth={width} bind:clientHeight={height}>
  {#if empty}
    <div class="constellation-empty">
      <span class="star">✦</span>
      <p>This plan has no cards yet.</p>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <canvas
      bind:this={canvasEl}
      class="constellation-canvas"
      tabindex="0"
      aria-label="Constellation graph — {nodes.length} cards. Use the search box to find a node; drag to pan; scroll to zoom; Escape clears the selection."
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      ondblclick={onDblClick}
      onwheel={onWheel}
      onkeydown={onCanvasKey}
    ></canvas>

    <!-- Search -->
    <div class="cn-search">
      <input
        type="search"
        placeholder="Search nodes…"
        bind:value={query}
        onkeydown={onSearchKey}
        aria-label="Search nodes in the graph"
      />
      {#if results.length}
        <ul class="cn-search-results">
          {#each results as r (r.handle)}
            <li>
              <button onclick={() => selectResult(r.handle)}>
                <span class="cn-swatch" style="background: var(--t-{r.type})"></span>
                <span class="cn-r-handle">{r.handle}</span>
                {#if r.name}<span class="cn-r-name">{r.name}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <!-- Legend -->
    <div class="cn-legend">
      {#each presentTypes as type}
        <span class="cn-legend-item">
          <span class="cn-swatch" style="background: var(--t-{type})"></span>
          {TYPE_META[type]?.label ?? type}
        </span>
      {/each}
    </div>

    <!-- Controls -->
    <div class="cn-controls">
      <button title="Zoom in" aria-label="Zoom in" onclick={() => zoomBy(1.25)}>+</button>
      <button title="Zoom out" aria-label="Zoom out" onclick={() => zoomBy(0.8)}>−</button>
      <button title="Fit to view" aria-label="Fit to view" onclick={fitAll}>⤢</button>
      <button title="Reset" aria-label="Reset view" onclick={resetView}>⟲</button>
    </div>

    <!-- Focused-node panel -->
    {#if focusedCard}
      <div class="cn-panel">
        <span class="cn-panel-type" style="--c: var(--t-{focusedCard.type})">{focusedCard.type}</span>
        <strong>{focusedCard.name ?? focusedCard.handle}</strong>
        <span class="cn-panel-handle">{focusedCard.handle}</span>
        {#if focusedCard.status}<span class="cn-panel-status">{focusedCard.status}</span>{/if}
        <a href="#/card/{focusedCard.handle}">Open card →</a>
      </div>
    {/if}
  {/if}
</div>
