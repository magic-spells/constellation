// Markdown contract shared by the MarkdownEditor and Markdown pieces.
//
// THE MARKDOWN SOURCE IS THE CONTRACT. What consumers store — and what
// MarkdownEditor's @change emits / `value` accepts — is a plain markdown
// STRING. This file owns everything the renderer and the editor must agree on
// about that string: the typography class map and the safety guards applied to
// user-authored URLs and code-fence language tags.
//
// THE OVERLAP WITH rich-text-doc.js IS INTENTIONAL. That file owns the
// JSON-tree contract (Shopify-style node trees, Tiptap conversion); this file
// owns the markdown contract. They are INDEPENDENT and may drift on purpose —
// markdown grows tables, task lists, images, and inline HTML that the tree
// format has no node for, and either side can restyle without dragging the
// other along. Do not refactor one to import from the other.
//
// EVERY CLASS THE WALKER CAN EMIT MUST BE A WHOLE LITERAL IN THIS MAP — never
// concatenate class fragments (`'text-' + align`, `` `mt-${n}` ``). Tailwind's
// scanner only sees literal strings, and this file is copied to app/lib/,
// inside the app's Tailwind scan; a stitched-together name compiles to nothing.
//
// Registry lib file: copied to app/lib/markdown-doc.js. Pure JS, no DOM —
// unit-tested DOM-free in the repo's test/ suite.

// Empty = nothing but whitespace. Markdown has no "empty block" shape to keep
// alive, so a blank string is the whole story.
export function isEmpty(md) {
	return !String(md ?? '').trim();
}

// marked leaves entity references encoded in token text because its normal
// HTML renderer relies on the browser to decode them. The DOM walker writes
// text nodes directly, so decode the CommonMark prose subset without pulling
// in a DOM. Unknown names and invalid numeric code points stay literal.
const NAMED_ENTITIES = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: '\u00a0',
	copy: '©',
	reg: '®',
	trade: '™',
	hellip: '…',
	mdash: '—',
	ndash: '–',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	times: '×',
	middot: '·',
};

export function decodeEntities(str) {
	return String(str ?? '').replace(/&(#(?:[xX][\da-fA-F]+|\d+)|[a-z]+);/g, (entity, body) => {
		if (body[0] !== '#') return NAMED_ENTITIES[body] ?? entity;
		const hex = body[1] === 'x' || body[1] === 'X';
		const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
		if (
			!Number.isInteger(codePoint) ||
			codePoint <= 0 ||
			codePoint > 0x10ffff ||
			(codePoint >= 0xd800 && codePoint <= 0xdfff)
		) {
			return entity;
		}
		return String.fromCodePoint(codePoint);
	});
}

// One source of truth for content typography — the editor feeds these to
// Tiptap as per-node HTMLAttributes and the Markdown renderer applies them
// while walking the lexer tokens, so WYSIWYG parity is by construction. This
// file is copied into app/lib/, inside Tailwind's scan, so the utilities
// compile.
//
// Values that overlap RICH_TEXT_CLASSES are deliberately identical, so the two
// renderers look the same where they render the same thing; table cells follow
// DataTable's look. (heading1/heading2/heading3 are ALSO mirrored as arbitrary
// variants in MarkdownEditor.pzl's content class — Tiptap HTMLAttributes can't
// vary by heading level. Keep the two in sync.)
export const MARKDOWN_CLASSES = {
	paragraph: 'mt-3 first:mt-0 leading-7 text-body',
	heading1: 'mt-8 first:mt-0 text-3xl font-semibold tracking-tight text-ink',
	heading2: 'mt-6 first:mt-0 text-2xl font-semibold tracking-tight text-ink',
	heading3: 'mt-5 first:mt-0 text-lg font-semibold tracking-tight text-ink',
	heading4: 'mt-4 first:mt-0 text-base font-semibold tracking-tight text-ink',
	heading5: 'mt-4 first:mt-0 text-sm font-semibold tracking-tight text-ink',
	heading6: 'mt-4 first:mt-0 text-sm font-semibold tracking-tight text-muted',
	list: 'mt-3 first:mt-0 space-y-1 pl-6 text-body',
	bulletList: 'list-disc',
	orderedList: 'list-decimal',
	listItem: 'leading-7',
	taskList: 'mt-3 first:mt-0 space-y-1 list-none pl-0 text-body',
	taskItem: 'flex items-start gap-2 leading-7',
	taskCheckbox: 'mt-1.5 size-4 shrink-0 accent-brand',
	taskBody: 'min-w-0',
	taskBodyDone: 'min-w-0 text-muted line-through',
	blockquote: 'mt-4 first:mt-0 border-l-2 border-border pl-4 italic text-muted',
	codeBlock:
		'mt-4 first:mt-0 overflow-x-auto rounded-lg bg-surface-sunken p-4 font-mono text-[13px]/relaxed text-body whitespace-pre',
	inlineCode: 'rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[13px] text-ink',
	link: 'text-brand underline underline-offset-2 hover:opacity-80',
	image: 'mt-4 first:mt-0 max-w-full rounded-lg',
	rule: 'my-6 h-px border-0 bg-border',
	tableWrap: 'mt-4 first:mt-0 w-full overflow-x-auto rounded-xl border border-border',
	table: 'w-full border-collapse text-left text-sm',
	tableHeadRow: 'border-b border-border bg-surface-sunken',
	tableRow: 'border-b border-border last:border-b-0',
	tableHead: 'px-4 py-3 font-medium text-muted',
	tableCell: 'px-4 py-3 text-body',
	alignLeft: 'text-left',
	alignCenter: 'text-center',
	alignRight: 'text-right',
	htmlLiteral:
		'mt-3 first:mt-0 leading-7 whitespace-pre-wrap font-mono text-[13px] text-muted',
};

// ---- URL / attribute guards -----------------------------------------------
//
// (rich-text-doc.js carries its own copy of the link guard on purpose — the
// rich-text pair does not depend on this file.)

// URL parsers strip tabs/newlines before parsing, so test a NORMALIZED copy
// while returning the original: `java&#9;script:x` is a live javascript: URL to
// the browser but not to a naive prefix test.
function normalize(url) {
	return String(url ?? '').replace(/[\t\n\r]/g, '');
}

// Splits a candidate into the shape both guards reason about: whether it is
// relative, and where its scheme (if any) ends.
function schemeOf(testUrl) {
	const colon = testUrl.indexOf(':');
	const boundary = testUrl.search(/[/?#]/);
	// `example.com/x` and `/a:b` have no scheme — a colon after the first
	// path/query/fragment separator is part of the path, not a scheme.
	if (colon === -1 || (boundary !== -1 && boundary < colon)) return null;
	// A leading colon leaves an empty scheme, which no allowlist matches.
	return testUrl.slice(0, colon);
}

// The link policy as a BOOLEAN, for callers that must decide rather than
// rewrite: MarkdownEditor hands this to Tiptap's Link `isAllowedUri` so the
// editor refuses to create a link the Markdown renderer would refuse to link
// (Tiptap's own default allowlist is wider — ftp:, sms:, xmpp: and friends
// would be accepted here and render as '#' there). Reading safeUrl's return
// instead would be ambiguous: '#' is both the neutralized sentinel and a
// perfectly legal href.
export function isSafeUrl(url) {
	const testUrl = normalize(url);
	const scheme = schemeOf(testUrl);
	if (/^[/#?.]/.test(testUrl) || scheme === null) return true;
	return /^(https?|mailto|tel)$/i.test(scheme);
}

// Link href: relative and scheme-less URLs pass through; of the schemes, only
// the navigational ones are allowed. Anything else collapses to '#'.
export function safeUrl(url) {
	const raw = String(url ?? '');
	return isSafeUrl(raw) ? raw : '#';
}

// Image src: a tighter allowlist than safeUrl — an <img> never navigates, so
// mailto:/tel: are meaningless here, and `data:` is admitted for image types
// only (data:text/html is a script vector when a URL reaches a navigable).
//
// Returns NULL for rejected input, so callers emit no <img> at all. There is no
// '#' tombstone here (safeUrl keeps its own, since '#' is a fine link target):
// '#', a bare '?…' query and the empty string all resolve to the CURRENT
// document URL, so an <img> built from them makes the browser GET the page
// itself — a referer leak, a log entry and a broken-image icon. `![alt]()`
// yields an empty href straight out of marked, so this is ordinary input.
export function safeImageUrl(url) {
	const raw = String(url ?? '');
	const testUrl = normalize(raw);
	if (!testUrl || /^[#?]/.test(testUrl)) return null;
	const relative = /^[/.]/.test(testUrl);
	const scheme = schemeOf(testUrl);
	if (relative || scheme === null) return raw;
	if (/^https?$/i.test(scheme)) return raw;
	return /^data:image\//i.test(testUrl) ? raw : null;
}

// Code-fence info strings become a `language-*` class, so they are user content
// landing in a class attribute — anything but a plain identifier is dropped.
export function safeLang(lang) {
	const value = String(lang ?? '');
	return /^[\w+.-]+$/.test(value) ? value : '';
}
