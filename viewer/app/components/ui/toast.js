// toast.js — the toast store + imperative public API.
//
// A plain ES-module singleton with a tiny pub/sub. The imperative `toast()`
// function IS the surface here (that's the point of a toast system): call it
// from anywhere to push a notification. A single <Toaster/> host, mounted once
// in your layout, subscribes to this store and re-renders on every change —
// Puzzle module state carries no reactivity of its own, so the host wires the
// bridge in mounted() and tears it down in destroyed().
//
// Simplified port of @magic-spells/notification-stack (src/components/*.js,
// src/utils/dismiss-timer.js).
//
// PORTED from notification-stack:
//   - the pausable one-shot DismissTimer (pause on hover, resume on leave),
//     with the monotonic run-token guard so a callback that fires after a
//     pause/cancel is a guaranteed no-op.
//   - variants (default | success | danger), auto-dismiss with a per-toast
//     duration, and sticky toasts (duration 0/null → no timer).
//   - the max-visible cap (enforced in the Toaster host, not here — the store
//     keeps the full queue; older toasts beyond the cap simply don't render).
//   - accessible live-region discipline (role/aria-live decided per variant in
//     the host, mirroring notification-card's status/alert choice).
//
// SKIPPED for v1 (follow-ups):
//   - the stacked-deck collapsed layout + expand-on-hover (v1 is a plain
//     vertical list).
//   - per-toast progress bars.
//   - custom Element/DocumentFragment content (v1 is title + message strings;
//     string input is rendered as text, never innerHTML — XSS-safe by default).
//
// ORDER: getToasts() returns the queue oldest-first, newest last. The Toaster
// renders the newest `maxVisible` and orders them (flex-col / flex-col-reverse)
// so the newest toast always sits nearest the screen corner — the convention
// most toast systems use.

/**
 * @typedef {'default' | 'success' | 'danger'} ToastVariant
 * @typedef {Object} Toast
 * @property {number} id
 * @property {string} title
 * @property {string} message
 * @property {ToastVariant} variant
 * @property {boolean} leaving   - true once the exit transition has begun
 * @property {DismissTimer|null} timer
 */

/** Default auto-dismiss time, in ms. */
const DEFAULT_DURATION = 5000;

/**
 * How long a dismissed toast lingers in the array (flagged `leaving`) so the
 * host can play its exit transition before the node is removed. Keep in sync
 * with the Toaster card's transition duration.
 */
const LEAVE_MS = 180;

const VARIANTS = new Set(['default', 'success', 'danger']);

/**
 * Pausable one-shot timer used for toast auto-dismiss.
 *
 * A monotonic run token invalidates stale timeouts, so a callback that fires
 * after a pause/cancel is a guaranteed no-op even if a clearTimeout is missed.
 */
class DismissTimer {
	/**
	 * Starts counting down immediately.
	 * @param {Function} callback - Called once when the timer runs out
	 * @param {number} duration - Total time in milliseconds before expiry
	 */
	constructor(callback, duration) {
		this._callback = callback;
		this._duration = duration;
		this._remaining = duration;
		this._startedAt = null;
		this._timeoutId = null;
		this._runToken = 0;
		this._paused = false;
		this._schedule();
	}

	/** Pause the timer, banking the time left. */
	pause() {
		if (this._timeoutId === null) return;
		this._clear();
		this._remaining = Math.max(0, this._remaining - (performance.now() - this._startedAt));
		this._startedAt = null;
		this._paused = true;
	}

	/** Resume a paused timer with its banked remaining time. */
	resume() {
		if (!this._paused) return;
		this._paused = false;
		this._schedule();
	}

	/** Cancel the timer entirely. */
	cancel() {
		this._clear();
		this._startedAt = null;
		this._paused = false;
	}

	_schedule() {
		this._startedAt = performance.now();
		const token = ++this._runToken;
		this._timeoutId = setTimeout(() => {
			if (token !== this._runToken) return;
			this._timeoutId = null;
			this._startedAt = null;
			this._remaining = 0;
			this._callback();
		}, this._remaining);
	}

	_clear() {
		this._runToken++;
		if (this._timeoutId !== null) {
			clearTimeout(this._timeoutId);
			this._timeoutId = null;
		}
	}
}

/** @type {Toast[]} */
let toasts = [];
let counter = 0;
const subscribers = new Set();

function notify() {
	for (const fn of subscribers) {
		try {
			fn();
		} catch {
			/* a broken subscriber must never wedge delivery to the rest */
		}
	}
}

/**
 * Subscribe to store changes. The Toaster host calls this in mounted() and
 * refreshes on every notification.
 * @param {Function} fn - Invoked (no args) whenever the toast queue changes
 * @returns {Function} Unsubscribe function
 */
export function subscribe(fn) {
	subscribers.add(fn);
	return () => subscribers.delete(fn);
}

/**
 * The current toast queue, oldest-first (newest last). Consumed by the Toaster
 * in data(); treat it as read-only.
 * @returns {Toast[]}
 */
export function getToasts() {
	return toasts;
}

/**
 * Push a toast. The imperative entry point — call it from anywhere.
 * @param {string | { title?: string, message?: string, variant?: ToastVariant, duration?: number }} input
 *   A message string (shorthand) or an options object. `duration` is ms
 *   (default 5000); 0 or null makes the toast sticky (no auto-dismiss).
 * @returns {number} The new toast's id (pass to dismiss()).
 */
export function toast(input) {
	const opts = typeof input === 'string' ? { message: input } : input || {};
	const id = ++counter;
	const variant = VARIANTS.has(opts.variant) ? opts.variant : 'default';
	// Absent duration → default; explicit 0/null → sticky.
	const duration = opts.duration === undefined ? DEFAULT_DURATION : Math.max(0, Number(opts.duration) || 0);

	/** @type {Toast} */
	const entry = {
		id,
		title: opts.title || '',
		message: opts.message || '',
		variant,
		leaving: false,
		timer: null,
	};
	if (duration > 0) {
		entry.timer = new DismissTimer(() => dismiss(id), duration);
	}

	toasts = [...toasts, entry];
	notify();
	return id;
}

/**
 * Begin the leave transition for one toast: cancel its timer, flag it
 * `leaving` (subscribers notified), then remove it after LEAVE_MS (second
 * notify). A no-op if the id is unknown or already leaving.
 * @param {number} id
 */
export function dismiss(id) {
	const entry = toasts.find((t) => t.id === id);
	if (!entry || entry.leaving) return;
	entry.timer?.cancel();
	entry.timer = null;
	toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
	notify();
	setTimeout(() => {
		toasts = toasts.filter((t) => t.id !== id);
		notify();
	}, LEAVE_MS);
}

/** Dismiss every active toast (each plays its own leave transition). */
export function clearToasts() {
	for (const t of toasts) {
		if (!t.leaving) dismiss(t.id);
	}
}

/** Pause every auto-dismiss timer — the Toaster calls this on hover. */
export function pauseAll() {
	for (const t of toasts) t.timer?.pause();
}

/** Resume every auto-dismiss timer — the Toaster calls this on hover-leave. */
export function resumeAll() {
	for (const t of toasts) t.timer?.resume();
}
