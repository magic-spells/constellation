<script lang="ts">
  import { untrack } from 'svelte';
  import { plan, route, theme } from '../lib/state.svelte';
  import { TYPE_META } from '../lib/types';
  import {
    buildGraph,
    createSimulation,
    clusterAnchors,
    enterFocus,
    exitFocus,
    focusRadii,
    fitToBounds,
    fitToCircle,
    LAYOUT,
    type GraphNode,
    type GraphLink,
    type Point,
  } from '../lib/constellation-layout';
  import type { Simulation } from 'd3-force';

  // ── Reactive view state ──────────────────────────────────────────────────────
  // Nodes/links are $state.raw: PLAIN objects d3-force mutates in place each tick.
  // Rendering is to a <canvas>, painted imperatively in draw() — so there is no
  // per-tick Svelte re-render at all (the SVG version's bottleneck). The sim's tick
  // handler just requests a redraw; thousands of nodes stay GPU-cheap.
  let nodes = $state.raw<GraphNode[]>([]);
  let links = $state.raw<GraphLink[]>([]);

  // Viewport transform: screen = translate(tx,ty) then scale(s). graph→screen.
  let tx = $state(0);
  let ty = $state(0);
  let scale = $state(1);

  let focused = $state<string | null>(null);
  let hovered = $state<string | null>(null);
  let query = $state('');
  let reduceMotion = $state(false);

  let width = $state(0);
  let height = $state(0);

  // ── Non-reactive machinery ────────────────────────────────────────────────────
  let sim: Simulation<GraphNode, GraphLink> | null = null;
  let anchors = new Map<string, Point>();
  let graphCenter: Point = { x: 0, y: 0 };
  let initialized = false;
  let fitted = false;
  let canvasEl: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let tween: number | null = null;
  let rafId: number | null = null;

  // Above this we settle the sim synchronously instead of animating its cooldown —
  // canvas draws are cheap, but the d3 tick itself (O(n log n)) gets heavy past here.
  const LARGE = 1800;
  function animating(): boolean {
    return !reduceMotion && nodes.length <= LARGE;
  }

  // Colours can't be CSS vars on a canvas, so we resolve --t-<TYPE> etc. once and
  // refresh on theme change.
  const colors = {
    edge: '#888',
    accent: '#88f',
    bg: '#000',
    text: '#aaa',
    textStrong: '#fff',
    type: {} as Record<string, string>,
  };
  function refreshColors(): void {
    const cs = getComputedStyle(document.documentElement);
    const get = (v: string, fallback: string) => cs.getPropertyValue(v).trim() || fallback;
    colors.edge = get('--border-strong', '#888');
    colors.accent = get('--accent', '#88f');
    colors.bg = get('--bg', '#000');
    colors.text = get('--text-muted', '#aaa');
    colors.textStrong = get('--text', '#fff');
    const map: Record<string, string> = {};
    for (const t of new Set(nodes.map((n) => n.type))) map[t] = get('--t-' + t, colors.accent);
    colors.type = map;
  }

  const empty = $derived(plan.loaded && plan.cards.length === 0);

  function node(handle: string): GraphNode | undefined {
    return nodes.find((n) => n.handle === handle);
  }

  function orderedTypes(ns: GraphNode[]): string[] {
    const present = new Set(ns.map((n) => n.type));
    return Object.keys(TYPE_META).filter((t) => present.has(t));
  }

  // ── Reseed: the ONLY effect that touches the graph. Tracks plan.cards/connections
  //    and nothing else; component-local reads are untracked so it can't retrigger on
  //    its own writes. Cleanup stops the old sim (covers reseed, unmount, HMR).
  $effect(() => {
    const cards = plan.cards;
    const connections = plan.connections;
    untrack(() => reseed(cards, connections));
    return () => sim?.stop();
  });

  function reseed(cards: typeof plan.cards, connections: typeof plan.connections): void {
    const built = buildGraph(cards, connections);

    // Preserve positions for cards that survived an edit so an SSE reload doesn't
    // re-scramble the layout the user is looking at.
    const prev = new Map(nodes.map((n) => [n.handle, n]));
    for (const n of built.nodes) {
      const old = prev.get(n.handle);
      if (old) {
        n.x = old.x;
        n.y = old.y;
        n.vx = old.vx;
        n.vy = old.vy;
      }
    }

    const side = Math.max(700, Math.sqrt(built.nodes.length) * 170);
    graphCenter = { x: side / 2, y: side / 2 };
    anchors = clusterAnchors(orderedTypes(built.nodes), side, side);

    sim?.stop();
    sim = createSimulation({ nodes: built.nodes, links: built.links, anchors });
    sim.on('tick', requestDraw);

    nodes = built.nodes;
    links = built.links;
    refreshColors();

    if (focused && built.nodes.some((n) => n.handle === focused)) {
      const f = node(focused)!;
      enterFocus(sim, nodes, f, focusRadii(focused, plan.neighbors), graphCenter, orderedTypes(built.nodes));
    } else {
      focused = null;
    }

    const live = animating();
    if (!initialized) {
      sim.tick(live ? 150 : 300);
      const t = fitToBounds(nodes, { width: width || 800, height: height || 600 });
      tx = t.tx;
      ty = t.ty;
      scale = t.scale;
      initialized = true;
      if (live) sim.alpha(0.4).restart();
      else requestDraw();
    } else if (live) {
      sim.alpha(0.3).restart();
    } else {
      sim.tick(200);
      requestDraw();
    }
  }

  // Reduced-motion preference (live).
  $effect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = mq.matches;
    const onChange = (e: MediaQueryListEvent) => (reduceMotion = e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  // Frame the graph once the container is measured (bind:clientWidth lands after the
  // first reseed). Latches, so SSE reloads never yank the user's pan/zoom.
  $effect(() => {
    if (fitted || width <= 0 || height <= 0 || nodes.length === 0) return;
    untrack(() => {
      const t = fitToBounds(nodes, { width, height });
      tx = t.tx;
      ty = t.ty;
      scale = t.scale;
    });
    fitted = true;
    requestDraw();
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

  // Repaint when selection or the search highlight changes (hover repaints inline).
  $effect(() => {
    focused;
    searchMatches;
    tx;
    ty;
    scale;
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

  // ── Derived overlays ──────────────────────────────────────────────────────────
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
    if (!f || !sim) return;
    focused = handle;
    const hops = focusRadii(handle, plan.neighbors);
    enterFocus(sim, nodes, f, hops, graphCenter, presentTypes);
    let maxHop = 1;
    for (const v of hops.values()) if (Number.isFinite(v) && v > maxHop) maxHop = v;
    if (animating()) sim.alpha(0.9).restart();
    else staticSettle();
    tweenTo(fitToCircle(graphCenter, maxHop * LAYOUT.ringGap + 60, { width: width || 800, height: height || 600 }));
  }

  function clearFocus(): void {
    if (focused === null || !sim) return;
    focused = null;
    exitFocus(sim, nodes, anchors);
    if (animating()) sim.alpha(0.6).restart();
    else staticSettle();
  }

  function toggleFocus(handle: string): void {
    if (focused === handle) clearFocus();
    else focusNode(handle);
  }

  function staticSettle(): void {
    if (!sim) return;
    sim.stop();
    sim.tick(300);
    requestDraw();
  }

  // ── Render loop (draw-on-demand, coalesced to ≤1 paint/frame) ──────────────────
  function requestDraw(): void {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      draw();
    });
  }

  function draw(): void {
    if (!canvasEl) return;
    ctx ??= canvasEl.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const activeSet = focused ? highlightSet : searchMatches; // Set<string> | null

    // graph-space pass: edges then node circles
    ctx.save();
    ctx.translate(tx, ty);
    ctx.scale(scale, scale);

    for (const l of links) {
      const s = l.source as GraphNode;
      const t = l.target as GraphNode;
      const hot = !!focused && (s.handle === focused || t.handle === focused);
      const dim = (focused || searchMatches) && !hot;
      ctx.globalAlpha = dim ? 0.06 : hot ? 0.95 : 0.45;
      ctx.strokeStyle = hot ? colors.accent : colors.edge;
      ctx.lineWidth = (hot ? 2.2 : 1.1) / scale;
      ctx.beginPath();
      ctx.moveTo(s.x ?? 0, s.y ?? 0);
      ctx.lineTo(t.x ?? 0, t.y ?? 0);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const n of nodes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const inSet = activeSet ? activeSet.has(n.handle) : false;
      const dim = activeSet ? !inSet : false;
      ctx.globalAlpha = dim ? 0.16 : 1;
      ctx.beginPath();
      ctx.arc(x, y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = colors.type[n.type] ?? colors.accent;
      ctx.fill();
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = colors.bg;
      ctx.stroke();
      const ring = n.handle === focused || n.handle === hovered || (activeSet && inSet);
      if (ring) {
        ctx.lineWidth = (n.handle === focused ? 2.8 : 2) / scale;
        ctx.strokeStyle = colors.accent;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // screen-space pass: labels (crisp, constant size, thinned)
    const showAll = scale >= 0.6 || nodes.length <= 50;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.lineJoin = 'round';
    for (const n of nodes) {
      const inSet = activeSet ? activeSet.has(n.handle) : false;
      if (activeSet && !inSet && n.handle !== hovered) continue;
      const labeled = showAll || n.handle === focused || n.handle === hovered || (activeSet && inSet);
      if (!labeled) continue;
      const sx = tx + scale * (n.x ?? 0);
      const sy = ty + scale * (n.y ?? 0) + n.r * scale + 4;
      if (sx < -60 || sx > width + 60 || sy < -20 || sy > height + 20) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.bg;
      ctx.strokeText(n.handle, sx, sy);
      ctx.fillStyle = n.handle === focused ? colors.textStrong : colors.text;
      ctx.fillText(n.handle, sx, sy);
    }
  }

  // ── Hit-testing + coordinate helpers ──────────────────────────────────────────
  function findNodeAt(clientX: number, clientY: number): GraphNode | undefined {
    const rect = canvasEl.getBoundingClientRect();
    const gx = (clientX - rect.left - tx) / scale;
    const gy = (clientY - rect.top - ty) / scale;
    let best: GraphNode | undefined;
    let bestD = Infinity;
    for (const n of nodes) {
      const dx = (n.x ?? 0) - gx;
      const dy = (n.y ?? 0) - gy;
      const d = dx * dx + dy * dy;
      const rr = (n.r + 3) * (n.r + 3);
      if (d <= rr && d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  function toGraph(clientX: number, clientY: number): Point {
    const rect = canvasEl.getBoundingClientRect();
    return { x: (clientX - rect.left - tx) / scale, y: (clientY - rect.top - ty) / scale };
  }

  // ── Viewport: zoom, fit, tween ────────────────────────────────────────────────
  function clamp(v: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, v));
  }

  function zoomBy(factor: number): void {
    const cx = width / 2;
    const cy = height / 2;
    const ns = clamp(scale * factor, 0.1, 4);
    tx = cx - ((cx - tx) / scale) * ns;
    ty = cy - ((cy - ty) / scale) * ns;
    scale = ns;
    requestDraw();
  }

  function fitAll(): void {
    if (nodes.length) tweenTo(fitToBounds(nodes, { width: width || 800, height: height || 600 }));
  }

  function resetView(): void {
    clearFocus();
    fitAll();
  }

  function tweenTo(target: { tx: number; ty: number; scale: number }): void {
    if (tween) cancelAnimationFrame(tween);
    if (reduceMotion) {
      tx = target.tx;
      ty = target.ty;
      scale = target.scale;
      requestDraw();
      return;
    }
    const from = { tx, ty, scale };
    const start = performance.now();
    const dur = 420;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      tx = from.tx + (target.tx - from.tx) * e;
      ty = from.ty + (target.ty - from.ty) * e;
      scale = from.scale + (target.scale - from.scale) * e;
      requestDraw();
      if (k < 1) tween = requestAnimationFrame(step);
      else tween = null;
    };
    tween = requestAnimationFrame(step);
  }

  // Zoom response per wheel delta. Trackpad pinch arrives as a wheel event with ctrlKey
  // set and small deltas, so it gets a stronger coefficient than a plain scroll-wheel.
  const ZOOM_WHEEL = 0.0015;
  const ZOOM_PINCH = 0.004;

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const k = e.ctrlKey ? ZOOM_PINCH : ZOOM_WHEEL;
    const ns = clamp(scale * Math.exp(-e.deltaY * k), 0.1, 4);
    tx = px - ((px - tx) / scale) * ns;
    ty = py - ((py - ty) / scale) * ns;
    scale = ns;
    requestDraw();
  }

  // ── Drag state machine (node drag vs background pan; no-move = click) ──────────
  type Drag = { mode: 'pan' | 'node'; handle?: string; startX: number; startY: number; lastX: number; lastY: number; moved: boolean };
  let drag: Drag | null = null;

  function onPointerDown(e: PointerEvent): void {
    canvasEl.setPointerCapture(e.pointerId);
    const hit = findNodeAt(e.clientX, e.clientY);
    if (hit) {
      drag = { mode: 'node', handle: hit.handle, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
      hit.fx = hit.x;
      hit.fy = hit.y;
      if (animating()) sim?.alphaTarget(0.3).restart();
    } else {
      drag = { mode: 'pan', startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
    }
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
        // Set x/y too: d3 only copies fx→x on a tick, and the sim may not be ticking
        // (large-graph / reduced-motion), so this makes the node track the cursor now.
        n.fx = g.x;
        n.fy = g.y;
        n.x = g.x;
        n.y = g.y;
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
    canvasEl.releasePointerCapture?.(e.pointerId);
    if (d.mode === 'pan') {
      if (!d.moved) clearFocus();
      return;
    }
    const n = d.handle ? node(d.handle) : undefined;
    if (!d.moved && d.handle) {
      toggleFocus(d.handle);
    } else if (n) {
      if (d.handle === focused) {
        n.fx = graphCenter.x;
        n.fy = graphCenter.y;
      } else {
        n.fx = null;
        n.fy = null;
      }
    }
    sim?.alphaTarget(0);
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
      role="img"
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
