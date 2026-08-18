// Camera + frame-scheduling primitives shared by the canvas views.
//
// Extracted from ConstellationView, which owned the only copy until the atlas
// needed the same behaviour. Everything here is pure or self-contained: no DOM,
// no Puzzle, no knowledge of what is being drawn. A view keeps its own
// `{tx, ty, scale}` and passes it in — these helpers return a *new* view rather
// than mutating, so a caller can tween between two of them.
//
// The transform convention matches the graph renderer and the isometric one:
//   screen = translate(tx, ty) then scale(s)   →   screenX = tx + s * worldX
//
// `requestAnimationFrame` is looked up lazily off `globalThis` so this module
// imports cleanly under jsdom and plain Node.

/** Zoom bounds. Below 0.05 a plan is an unreadable speck; above 4 it is soup. */
export const ZOOM_LIMITS = { min: 0.05, max: 4 };

/** Wheel/pinch sensitivity. A trackpad pinch arrives as wheel+ctrlKey and is coarser. */
export const ZOOM_WHEEL = 0.0015;
export const ZOOM_PINCH = 0.004;

export function easeOutCubic(k) {
	return 1 - Math.pow(1 - k, 3);
}

export function easeInOutCubic(k) {
	return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

export function clamp(value, lo, hi) {
	return Math.min(hi, Math.max(lo, value));
}

/**
 * Zoom by `factor` while keeping the screen point (px, py) pinned to the same
 * world point — the behaviour that makes cursor-anchored wheel zoom feel right.
 */
export function zoomAt(view, px, py, factor, limits = ZOOM_LIMITS) {
	const scale = clamp(view.scale * factor, limits.min, limits.max);
	return {
		tx: px - ((px - view.tx) / view.scale) * scale,
		ty: py - ((py - view.ty) / view.scale) * scale,
		scale,
	};
}

/** Anchored zoom about the viewport centre — the +/- buttons. */
export function zoomAtCenter(view, width, height, factor, limits = ZOOM_LIMITS) {
	return zoomAt(view, width / 2, height / 2, factor, limits);
}

/** Wheel delta → multiplicative zoom factor. `ctrlKey` means trackpad pinch. */
export function wheelFactor(deltaY, ctrlKey) {
	return Math.exp(-deltaY * (ctrlKey ? ZOOM_PINCH : ZOOM_WHEEL));
}

/** Screen point → world point under `view`. Inverse of the draw transform. */
export function toWorld(view, sx, sy) {
	return { x: (sx - view.tx) / view.scale, y: (sy - view.ty) / view.scale };
}

/** World point → screen point under `view`. */
export function toScreen(view, wx, wy) {
	return { x: view.tx + view.scale * wx, y: view.ty + view.scale * wy };
}

/**
 * On-demand single-rAF driver. Never runs a loop while idle: `request()` schedules
 * at most one frame, and the frame re-schedules itself only while `onFrame` keeps
 * returning true. That is what lets a settled canvas cost nothing.
 *
 * `onFrame(now)` returns truthy to continue animating.
 */
export class Ticker {
	constructor(onFrame) {
		this.onFrame = onFrame;
		this.raf = null;
		this.tick = (now) => {
			this.raf = null;
			if (this.onFrame(now)) this.request();
		};
	}

	request() {
		if (this.raf != null) return;
		const raf = globalThis.requestAnimationFrame;
		// jsdom and Node have no rAF. Run synchronously so tests still advance.
		if (typeof raf !== 'function') {
			this.tick(now());
			return;
		}
		this.raf = raf(this.tick);
	}

	cancel() {
		if (this.raf == null) return;
		globalThis.cancelAnimationFrame?.(this.raf);
		this.raf = null;
	}
}

/** Monotonic-ish clock that survives environments without `performance`. */
export function now() {
	return globalThis.performance?.now?.() ?? Date.now();
}

/**
 * Eased tween between two `{tx, ty, scale}` views.
 *
 * `reduceMotion` is honoured here rather than at every call site: the tween simply
 * snaps, so callers never branch on it.
 */
export class ViewportTween {
	constructor({ duration = 520, ease = easeOutCubic, reduceMotion = false } = {}) {
		this.duration = duration;
		this.ease = ease;
		this.reduceMotion = reduceMotion;
		this.active = false;
		this.from = null;
		this.target = null;
		this.start = 0;
	}

	/**
	 * Begin a tween from `from` to `target`. Returns the view to adopt immediately —
	 * the target itself when motion is reduced, otherwise the unchanged `from`.
	 */
	begin(from, target, at = now()) {
		if (this.reduceMotion || this.duration <= 0) {
			this.active = false;
			return { ...target };
		}
		this.from = { ...from };
		this.target = { ...target };
		this.start = at;
		this.active = true;
		return { ...from };
	}

	/**
	 * Advance to `at`. Returns the interpolated view, or null when not animating.
	 * Clears `active` on the final frame, so the caller's "keep going" test is
	 * just `tween.active` after the call.
	 */
	advance(at) {
		if (!this.active) return null;
		const k = this.duration > 0 ? Math.min(1, (at - this.start) / this.duration) : 1;
		const t = this.ease(k);
		const view = {
			tx: this.from.tx + (this.target.tx - this.from.tx) * t,
			ty: this.from.ty + (this.target.ty - this.from.ty) * t,
			scale: this.from.scale + (this.target.scale - this.from.scale) * t,
		};
		if (k >= 1) this.active = false;
		return view;
	}

	cancel() {
		this.active = false;
	}
}

/**
 * Eased 0→1 progress track, for transitions that are not viewport moves (node
 * positions settling, a building growing). Same reduce-motion contract: when
 * motion is reduced it never activates and `t` stays at 1.
 */
export class Progress {
	constructor({ duration = 650, ease = easeInOutCubic, reduceMotion = false } = {}) {
		this.duration = duration;
		this.ease = ease;
		this.reduceMotion = reduceMotion;
		this.active = false;
		this.t = 1;
		this.start = 0;
	}

	begin(at = now()) {
		if (this.reduceMotion || this.duration <= 0) {
			this.active = false;
			this.t = 1;
			return false;
		}
		this.start = at;
		this.t = 0;
		this.active = true;
		return true;
	}

	advance(at) {
		if (!this.active) return false;
		const k = Math.min(1, (at - this.start) / this.duration);
		this.t = this.ease(k);
		if (k >= 1) {
			this.active = false;
			this.t = 1;
		}
		return true;
	}

	cancel() {
		this.active = false;
		this.t = 1;
	}
}
