import { describe, expect, it } from 'vitest';
import {
  clamp,
  easeInOutCubic,
  easeOutCubic,
  Progress,
  Ticker,
  toScreen,
  toWorld,
  ViewportTween,
  wheelFactor,
  zoomAt,
  zoomAtCenter,
  ZOOM_LIMITS,
} from '../viewer/app/lib/canvas-camera.js';

const view = (tx: number, ty: number, scale: number) => ({ tx, ty, scale });

describe('easing', () => {
  it('pins both ends', () => {
    for (const ease of [easeOutCubic, easeInOutCubic]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
    }
  });

  it('easeInOutCubic is symmetric about its midpoint', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    for (const k of [0.1, 0.25, 0.4]) {
      expect(easeInOutCubic(k) + easeInOutCubic(1 - k)).toBeCloseTo(1, 10);
    }
  });
});

describe('clamp', () => {
  it('bounds on both sides and passes the middle through', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
    expect(clamp(4, 0, 10)).toBe(4);
  });
});

describe('zoomAt', () => {
  // The whole point of anchored zoom: the world point under the cursor must not move.
  it('keeps the anchor point pinned to the same world coordinate', () => {
    const before = view(120, -40, 0.8);
    const [px, py] = [300, 210];
    const worldBefore = toWorld(before, px, py);
    const after = zoomAt(before, px, py, 1.6);
    const worldAfter = toWorld(after, px, py);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
  });

  it('respects the zoom limits at both ends', () => {
    expect(zoomAt(view(0, 0, 1), 0, 0, 1e6).scale).toBe(ZOOM_LIMITS.max);
    expect(zoomAt(view(0, 0, 1), 0, 0, 1e-6).scale).toBe(ZOOM_LIMITS.min);
  });

  it('zoomAtCenter anchors the viewport centre', () => {
    const before = view(10, 20, 1);
    const worldBefore = toWorld(before, 400, 300);
    const after = zoomAtCenter(before, 800, 600, 2);
    const worldAfter = toWorld(after, 400, 300);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
  });
});

describe('toWorld / toScreen', () => {
  it('round-trip', () => {
    const v = view(-33, 91, 1.75);
    const screen = toScreen(v, 12, -7);
    const world = toWorld(v, screen.x, screen.y);
    expect(world.x).toBeCloseTo(12, 9);
    expect(world.y).toBeCloseTo(-7, 9);
  });
});

describe('wheelFactor', () => {
  it('zooms in scrolling up and out scrolling down', () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, false)).toBeLessThan(1);
  });

  it('pinch is coarser than wheel for the same delta', () => {
    expect(wheelFactor(-100, true)).toBeGreaterThan(wheelFactor(-100, false));
  });
});

describe('ViewportTween', () => {
  const from = view(0, 0, 1);
  const target = view(100, 200, 2);

  it('interpolates from start to target and deactivates on the last frame', () => {
    const tween = new ViewportTween({ duration: 100 });
    expect(tween.begin(from, target, 0)).toEqual(from);
    expect(tween.active).toBe(true);

    const mid = tween.advance(50)!;
    expect(mid.tx).toBeGreaterThan(0);
    expect(mid.tx).toBeLessThan(100);
    expect(tween.active).toBe(true);

    const end = tween.advance(100)!;
    expect(end).toEqual(target);
    expect(tween.active).toBe(false);
    expect(tween.advance(150)).toBeNull();
  });

  it('clamps past the duration rather than overshooting', () => {
    const tween = new ViewportTween({ duration: 100 });
    tween.begin(from, target, 0);
    expect(tween.advance(10_000)).toEqual(target);
  });

  // reduce-motion is handled inside the tween so no call site has to branch on it.
  it('snaps to the target and never activates when motion is reduced', () => {
    const tween = new ViewportTween({ duration: 500, reduceMotion: true });
    expect(tween.begin(from, target, 0)).toEqual(target);
    expect(tween.active).toBe(false);
  });
});

describe('Progress', () => {
  it('runs 0 → 1 and settles exactly at 1', () => {
    const progress = new Progress({ duration: 100 });
    expect(progress.begin(0)).toBe(true);
    expect(progress.t).toBe(0);

    progress.advance(50);
    expect(progress.t).toBeGreaterThan(0);
    expect(progress.t).toBeLessThan(1);

    progress.advance(100);
    expect(progress.t).toBe(1);
    expect(progress.active).toBe(false);
    expect(progress.advance(200)).toBe(false);
  });

  it('stays settled when motion is reduced', () => {
    const progress = new Progress({ duration: 500, reduceMotion: true });
    expect(progress.begin(0)).toBe(false);
    expect(progress.t).toBe(1);
    expect(progress.active).toBe(false);
  });
});

describe('Ticker', () => {
  // Idle canvases must cost nothing: one request must not leave a loop running.
  it('coalesces repeated requests into a single frame', async () => {
    const frames: number[] = [];
    const raf = globalThis.requestAnimationFrame;
    let queued: FrameRequestCallback | null = null;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      queued = cb;
      return 1;
    }) as typeof globalThis.requestAnimationFrame;

    try {
      const ticker = new Ticker((now) => {
        frames.push(now);
        return false;
      });
      ticker.request();
      ticker.request();
      ticker.request();
      expect(frames).toHaveLength(0);

      queued!(16);
      expect(frames).toEqual([16]);
      // onFrame returned false, so nothing was re-scheduled.
      expect(ticker.raf).toBeNull();
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });

  it('keeps scheduling while onFrame reports more work', () => {
    const raf = globalThis.requestAnimationFrame;
    let queued: FrameRequestCallback | null = null;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      queued = cb;
      return 1;
    }) as typeof globalThis.requestAnimationFrame;

    try {
      // Three frames report work and re-schedule; the fourth reports none and stops.
      let left = 3;
      const ticker = new Ticker(() => left-- > 0);
      ticker.request();
      for (let i = 0; i < 4; i++) {
        expect(queued).not.toBeNull();
        const cb = queued!;
        queued = null;
        cb(i);
      }
      expect(queued).toBeNull();
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
