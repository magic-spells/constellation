/**
 * The compiled document (`/docs`), viewer side.
 *
 * Ordering is NOT decided here — `GET /api/docs` hands over the tree already in
 * author-intended order, with each body's headings already shifted (src/core/docs.ts
 * is the one compiler). What lives here is what only the browser can do: dress
 * that tree for rendering (`docModel`), turn it into a table of contents, and
 * keep the TOC in step with the scroll.
 *
 * Scroll-spy crosses a component boundary: the document is the routed view, the
 * TOC sits in AppShell's split pane, and neither owns the other. So the page
 * PUBLISHES which anchor the viewport is on and the TOC subscribes — the same
 * shape as `theme.js`'s `onThemeChange`, and the reason neither has to know the
 * other exists.
 */

import { activePlanId, routerBaseFor } from './plans.js';
import { hrefForHandle, typeForHandle } from './types.js';

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
 * How many diagrams a card body will produce: its ```mermaid fences.
 *
 * WHY COUNT THE SOURCE AT ALL. The print window has to know when the diagrams
 * have finished rendering, and the obvious test — "no `.mermaid-block` is still
 * empty" — is true of a document whose markdown has not been written to the DOM
 * yet, which is the state the window is in for its first frames. Absence would
 * read as done, print would fire early, and every diagram would come out blank:
 * exactly the failure being guarded against. An expected count from the SOURCE
 * cannot be satisfied by an empty page.
 */
export function countDiagrams(body) {
	return String(body ?? '').match(/^[ \t]{0,3}(?:```+|~~~+)[ \t]*mermaid\b/gm)?.length ?? 0;
}

/**
 * How many of `root`'s diagram placeholders have been drawn.
 *
 * Mermaid runs asynchronously off a vendored bundle (lib/markdown.js) and fills
 * each `.mermaid-block` with an <svg> — or, when the diagram itself is bad,
 * with the source in a <pre>. Either way the box now has a child, so "has a
 * child" is "settled", whichever way it ended.
 */
export function diagramsDrawn(root) {
	return [...root.querySelectorAll('.mermaid-block')].filter((el) => el.firstElementChild).length;
}

/**
 * The print window's URL for a document, hash included (`#/print`,
 * `#/print/overview`). It is a top-level route rather than `/docs/print`
 * because a section slug and a mode word would otherwise share one segment —
 * a section actually called `print` would be unreachable.
 *
 * Hand-encoded rather than routed through `router.url()`: the caller is opening
 * a NEW window, so it needs a string it can hand to `window.open`, not a
 * navigation.
 *
 * Being hand-encoded also makes it the ONE href in the app that the router's
 * plan base does not reach — every other one goes through `| link` or
 * `router.push`. So it prefixes the base itself, read from the module constant
 * lib/plans.js pins at boot; that is `''` on a single-plan server, which is
 * what keeps this string unchanged there.
 */
export function printHref(solo = '') {
	const base = routerBaseFor(activePlanId());
	return solo ? `#${base}/print/${solo}` : `#${base}/print`;
}

/** Cover line: what this document is OF, so a printed copy dates itself. */
function imprintOf(plan) {
	const version = plan?.sync?.package_version;
	const today = new Date().toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
	return version ? `v${version} · ${today}` : today;
}

/**
 * The document ready to render: the cover line, the sections in order, and each
 * card already carrying its anchor, its link home and its type colour.
 *
 * TWO SURFACES READ THIS. The `/docs` route shows the document in the app, and
 * the print window (`/print`) shows the same document on a page-width sheet —
 * so the shape is assembled once here rather than in whichever view happened to
 * need it first. Neither surface decides anything about the document; they
 * differ only in the frame they put around it.
 *
 * `solo` narrows it to one section (`/docs/:section`); `''` is the whole thing.
 */
export function docModel(store, solo = '') {
	const plan = store.findOne('plan', 'plan');
	const docs = plan?.docs;
	const all = docs?.sections ?? [];
	const sections = solo ? all.filter((section) => section.id === solo) : all;

	return {
		solo,
		base: solo ? `/docs/${solo}` : '/docs',
		title: docs?.title || 'Documentation',
		imprint: imprintOf(plan),
		// In-document link targets are the handles actually RENDERED here: on
		// `/docs/:section` a card in another section is not on this page, so a
		// [[link]] to it must stay a link to its card, not a dead anchor.
		handles: sections.flatMap((section) => section.cards.map((card) => card.handle)),
		sections: sections.map((section) => ({
			id: section.id,
			name: section.name,
			summary: section.summary || '',
			anchor: sectionAnchor(section.id),
			cards: section.cards.map((card) => ({
				handle: card.handle,
				name: card.name,
				body: card.body,
				cardHref: hrefForHandle(card.handle),
				sourceTitle: `Open ${card.handle}`,
				// Same per-type token the connection chips and the graph use, so a
				// handle is one colour everywhere in the app.
				typeStyle: `--c: var(--t-${typeForHandle(card.handle) ?? 'DOC'})`,
				// A STYLE card's tokens ARE its content: printing only its prose
				// would describe a palette without showing it. The document renders
				// the same StyleTokens the style guide does, off the same card.
				tokens:
					typeForHandle(card.handle) === 'STYLE'
						? { handle: card.handle, frontmatter: card.frontmatter ?? {} }
						: null,
			})),
		})),
		// How many diagrams this document contains — what the print window waits
		// for. Counted from the bodies about to be rendered, not from the page.
		diagrams: sections.reduce(
			(total, section) =>
				total + section.cards.reduce((n, card) => n + countDiagrams(card.body), 0),
			0,
		),
		// Whether the document has ARRIVED, which "no sections" alone cannot say:
		// the plan hydrates async, so an empty document and a document still in
		// flight look identical from the tree. The print window waits on this.
		loaded: !!docs,
		empty: sections.length === 0,
		// A slug no card claims, as opposed to a plan with no document at all —
		// the two want different things said about them.
		unknownSection: sections.length === 0 && !!solo && all.length > 0,
	};
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
