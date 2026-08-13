/**
 * Scheme (palette) + theme (light/dark) control.
 *
 * Two independent axes, both expressed as attributes on <html>:
 *   - `data-scheme` — which palette: observatory (default) | default | warm | void | dim.
 *     Token blocks live in `app/styles/schemes.css`; `default` matches no block,
 *     so the base `pieces.css` @theme values stand.
 *   - `data-theme`  — `light` | `dark`, or ABSENT for "follow the OS". Every token
 *     is a `light-dark()` pair resolved by `color-scheme`, which the stylesheet
 *     flips from this attribute.
 *
 * Both are applied pre-paint by the inline script in `app/public/index.html`;
 * these setters keep the DOM, localStorage, and subscribers in step afterwards.
 * Observatory pins `color-scheme: dark`, so the theme toggle is a visual no-op
 * while it is active — the preference is still stored and applies to any other
 * scheme the user picks.
 */

const SCHEME_KEY = 'constellation-scheme';
const THEME_KEY = 'constellation-theme';

const DEFAULT_SCHEME = 'observatory';

const SCHEMES = [
	{ id: 'observatory', label: 'Observatory' },
	{ id: 'default', label: 'Default' },
	{ id: 'warm', label: 'Warm' },
	{ id: 'void', label: 'Void' },
	{ id: 'dim', label: 'Dim' },
];

const THEMES = [
	{ id: 'system', label: 'System' },
	{ id: 'light', label: 'Light' },
	{ id: 'dark', label: 'Dark' },
];

const listeners = new Set();

/** Every selectable scheme, in menu order. */
export function schemes() {
	return SCHEMES;
}

/** Every selectable theme mode, in menu order. */
export function themes() {
	return THEMES;
}

/** Active scheme id. */
export function getScheme() {
	if (typeof document === 'undefined') return DEFAULT_SCHEME;
	return document.documentElement.dataset.scheme || DEFAULT_SCHEME;
}

/** Active theme mode — `'system'` when no explicit choice is stored. */
export function getTheme() {
	if (typeof document === 'undefined') return 'system';
	return document.documentElement.dataset.theme || 'system';
}

/** Switch palette. Persists and notifies. */
export function setScheme(id) {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.scheme = id;
	try {
		localStorage.setItem(SCHEME_KEY, id);
	} catch {
		/* private mode / storage disabled — the DOM change still applies */
	}
	notify();
}

/** Switch light/dark. `'system'` clears the override. Persists and notifies. */
export function setTheme(mode) {
	if (typeof document === 'undefined') return;
	try {
		if (mode === 'system') {
			delete document.documentElement.dataset.theme;
			localStorage.removeItem(THEME_KEY);
		} else {
			document.documentElement.dataset.theme = mode;
			localStorage.setItem(THEME_KEY, mode);
		}
	} catch {
		/* storage disabled — keep the DOM in the state we just set */
		if (mode === 'system') delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = mode;
	}
	notify();
}

/**
 * Subscribe to scheme/theme changes — including OS-level light/dark flips while
 * the mode is `'system'`, which matters for anything that reads resolved token
 * values out of `getComputedStyle` (the canvas graph, mermaid tinting).
 *
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onThemeChange(fn) {
	listeners.add(fn);
	ensureSystemWatch();
	return () => listeners.delete(fn);
}

function notify() {
	for (const fn of listeners) fn();
}

let systemWatch = null;

function ensureSystemWatch() {
	if (systemWatch || typeof window === 'undefined' || !window.matchMedia) return;
	systemWatch = window.matchMedia('(prefers-color-scheme: dark)');
	const handler = () => {
		if (getTheme() === 'system') notify();
	};
	if (systemWatch.addEventListener) systemWatch.addEventListener('change', handler);
	else systemWatch.addListener(handler);
}
