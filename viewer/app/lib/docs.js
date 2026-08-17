/**
 * The compiled document (`/docs`), viewer side.
 *
 * Ordering is NOT decided here — `GET /api/docs` hands over the tree already in
 * author-intended order, with each body's headings already shifted (src/core/docs.ts
 * is the one compiler). What lives here is what only the browser can do: turn
 * that tree into a table of contents, and keep the TOC in step with the scroll.
 *
 * Scroll-spy crosses a component boundary: the document is the routed view, the
 * TOC sits in AppShell's split pane, and neither owns the other. So the page
 * PUBLISHES which anchor the viewport is on and the TOC subscribes — the same
 * shape as `theme.js`'s `onThemeChange`, and the reason neither has to know the
 * other exists.
 */

const listeners = new Set();
let active = '';

/** The anchor id the document viewport is currently on (`''` before the first scroll). */
export function activeDocAnchor() {
	return active;
}

/** Publish the anchor the viewport is on. A repeat of the current value is a no-op. */
export function setActiveDocAnchor(id) {
	const next = String(id ?? '');
	if (next === active) return;
	active = next;
	for (const fn of listeners) fn(active);
}

/**
 * Subscribe to the active anchor.
 *
 * @param {(id: string) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onActiveDocAnchor(fn) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/** Anchor id for a section heading. Namespaced so it can never collide with a handle. */
export function sectionAnchor(id) {
	return `section-${id}`;
}

/**
 * Which anchor owns the viewport: the last one whose top has passed the reading
 * line.
 *
 * `atBottom` is the end-of-scroll case, and it matters more than it sounds.
 * Once the scroll has bottomed out, nothing further can ever pass the reading
 * line — so the last card or two, plainly on screen, would otherwise never be
 * the highlighted entry, and clicking them in the TOC would highlight something
 * above them. There, the first anchor still BELOW the line is what you are
 * looking at.
 *
 * @param {Array<{ id: string, top: number }>} anchors document order, tops relative to the scroller
 * @param {number} scrollTop already offset by the reading line
 * @param {boolean} atBottom
 */
export function anchorAt(anchors, scrollTop, atBottom = false) {
	if (anchors.length === 0) return '';
	if (atBottom) {
		const below = anchors.find((anchor) => anchor.top > scrollTop);
		if (below) return below.id;
	}
	let current = anchors[0].id;
	for (const anchor of anchors) {
		if (anchor.top > scrollTop) break;
		current = anchor.id;
	}
	return current;
}

/**
 * The document as the TOC renders it: two levels, section → card, with the
 * anchor each row points at. `base` is the document's own path, so a row inside
 * a soloed section (`/docs/:section`) anchors within that page while every other
 * section links to its own solo page.
 */
export function tocTree(sections, { base = '/docs', solo = '' } = {}) {
	return sections.map((section) => {
		const inPage = !solo || solo === section.id;
		const sectionBase = inPage ? base : `/docs/${section.id}`;
		return {
			id: section.id,
			name: section.name,
			anchor: sectionAnchor(section.id),
			href: inPage ? `${base}#${sectionAnchor(section.id)}` : sectionBase,
			cards: section.cards.map((card) => ({
				handle: card.handle,
				name: card.name,
				anchor: card.handle,
				href: `${sectionBase}#${card.handle}`,
			})),
		};
	});
}
