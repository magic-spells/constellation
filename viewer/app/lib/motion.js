/**
 * The command palette's spring dials, taken from the org app-template
 * (`app/lib/motion.js`), where they were measured against a palette growing
 * out of a top-bar search button into a ~672px panel — the same shape as ours.
 *
 * @magic-spells/morph-engine reads them as `attraction` / `friction`, both
 * strictly inside (0, 1): attraction is the PACE (higher = faster), friction is
 * the CHARACTER (lower = bouncier). They are not independent — at a lower
 * attraction the same friction damps more — so retuning a leg means moving both
 * and re-measuring.
 *
 * SPRING_POP_IN  ~3.5% overshoot, settles in ~450ms: a bounce you can see but
 *                not one you can measure from across the room.
 * SPRING_CLOSE   a dismissal is an undo; ~4% dip past the button, ~340ms, so
 *                the ending reads as an arrival rather than a fade. Those
 *                figures are the template's 0.2; ours is eased to 0.18 so the
 *                trip home is a touch slower and the dip a touch shallower.
 */
export const SPRING_POP_IN = { attraction: 0.08, friction: 0.29 };
export const SPRING_CLOSE = { attraction: 0.18, friction: 0.43 };

/** The engine's constructor shape: the base bag is the show leg, `hide` the way back. */
export const MORPH_SPRINGS = { ...SPRING_POP_IN, hide: { ...SPRING_CLOSE } };

/**
 * One reader for the motion preference. Every morph is gated on it: reduced
 * motion gets a plain fade, with no flight and no overshoot.
 */
export function reducedMotion() {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(prefers-reduced-motion: reduce)').matches
	);
}
