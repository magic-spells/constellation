/**
 * The one breakpoint the shell changes shape at: below Tailwind's `md` the rail
 * starts icon-only and a folder route shows its card list OR one card, never
 * both side by side (layouts/AppShell.pzl, views/TypeIntro.pzl).
 */
export const NARROW = '(max-width: 47.99rem)';

/** Whether the window is below `md` right now. False outside a browser. */
export function isNarrow() {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia(NARROW).matches
	);
}
