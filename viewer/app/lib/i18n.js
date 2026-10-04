// i18n.js — translations and locale-aware formatting for plain JS modules.
//
// Templates call Puzzle's built-in `t('key', { vars })` directly. Everything
// built in JavaScript — data() shaping, lib/, toasts, canvas labels — imports
// `t` from HERE, which delegates to the same Puzzle i18n service (`app.i18n`,
// bound once in app.js). So a key behaves identically in both: one flat table
// per locale (app/locales/<tag>.json), `{name}` placeholders, CLDR plurals
// picked by a numeric `count`, the key itself printed on a miss.
//
// Never call t() at module load: the table is fetched before the first render,
// not before your module runs. Keep KEYS in module constants (`labelKey`) and
// translate where the string is shown.
//
// Language and region are separate (the same split Pyramid makes): the active
// locale (`en`, `de`, `pt-BR`…) picks the WORDS; the browser's region picks the
// FORMATS. So dates and numbers go through the helpers below, whose locale is
// the language plus the region of the browser's first regional language
// (`en` + `en-GB` → `en-GB`; `de` chosen on an `en-US` browser → `de-US`).

/** @type {{ t: (key: string, vars?: any) => string, locale: string } | null} */
let service = null;

/**
 * Hand the module the app's i18n service (`app.i18n`). app.js calls this right
 * after mount() starts; the test setup binds an English service.
 * @param {{ t: (key: string, vars?: any) => string, locale: string } | null} next
 */
export function bindI18n(next) {
	service = next;
	cache.clear();
}

/**
 * Translate `key` in the active locale. `vars` fill `{name}` placeholders; a
 * numeric `count` picks the plural form. Before a service is bound this prints
 * the key, exactly as Puzzle does for a missing one.
 * @param {string} key
 * @param {Record<string, unknown>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
	return service ? service.t(key, vars) : String(key);
}

/**
 * Translate a sentence that has a STYLED value inside it — a bold name, a
 * code span — without splitting the sentence into fragments. Returns the
 * translated text cut at each placeholder, in the language's own word order:
 *
 *   tParts('home.empty', { command: 'constellation init' })
 *   → [{ text: 'No plan.md yet — run ' }, { name: 'command', value: 'constellation init' }, { text: '.' }]
 *
 * and the template styles the named parts. A numeric `count` is not cut out
 * (it picks the plural and prints formatted).
 * @param {string} key
 * @param {Record<string, unknown>} vars
 * @returns {Array<{ text: string } | { name: string, value: unknown }>}
 */
export function tParts(key, vars) {
	/** @type {Record<string, unknown>} */
	const marked = {};
	for (const [name, value] of Object.entries(vars)) {
		marked[name] = name === 'count' && typeof value === 'number' ? value : `\u0003${name}\u0003`;
	}
	const text = t(key, marked);
	const out = [];
	const pieces = text.split('\u0003');
	for (let i = 0; i < pieces.length; i++) {
		const piece = pieces[i];
		if (i % 2 === 1 && Object.hasOwn(vars, piece)) out.push({ name: piece, value: vars[piece] });
		else if (piece) out.push({ text: piece });
	}
	return out;
}

/** The active language tag (`en`, `pt-BR`, `zh-Hans`…). */
export function language() {
	return service?.locale ?? 'en';
}

/**
 * The region subtag of the browser's first language that names one
 * (`en-GB` → `GB`), or '' when none does.
 * @returns {string}
 */
export function browserRegion() {
	if (typeof navigator === 'undefined') return '';
	const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
	for (const tag of langs) {
		if (typeof tag !== 'string' || !tag) continue;
		try {
			const region = new Intl.Locale(tag).region;
			if (region) return region;
		} catch {
			// not a tag Intl accepts — try the next one
		}
	}
	return '';
}

/**
 * The locale every date, number and list in the viewer is formatted in: the
 * active language plus the browser's region. Falls back to the bare language
 * when Intl rejects the pair.
 * @returns {string}
 */
export function formatLocale() {
	const lang = language();
	const region = browserRegion();
	if (!region) return lang;
	try {
		return new Intl.Locale(lang, { region }).toString();
	} catch {
		return lang;
	}
}

// One Intl formatter per (kind, locale, options); cleared when the service changes.
/** @type {Map<string, any>} */
const cache = new Map();

function cached(kind, options, make) {
	const locale = formatLocale();
	const id = kind + '\u0000' + locale + '\u0000' + JSON.stringify(options);
	let f = cache.get(id);
	if (!f) {
		try {
			f = make(locale);
		} catch {
			f = make(language());
		}
		cache.set(id, f);
	}
	return f;
}

/**
 * Format a Date (or anything `new Date()` takes) in the format locale.
 * Null/invalid → ''.
 * @param {Date|string|number|null|undefined} when
 * @param {Intl.DateTimeFormatOptions} [options]
 * @returns {string}
 */
export function formatDateTime(when, options = {}) {
	if (when == null || when === '') return '';
	const date = when instanceof Date ? when : new Date(when);
	if (Number.isNaN(date.getTime())) return '';
	return cached('dt', options, (l) => new Intl.DateTimeFormat(l, options)).format(date);
}

/**
 * Format a number in the format locale (grouping, decimals, percent).
 * @param {number} value
 * @param {Intl.NumberFormatOptions} [options]
 * @returns {string}
 */
export function formatNumber(value, options = {}) {
	return cached('nf', options, (l) => new Intl.NumberFormat(l, options)).format(value);
}

/**
 * Join a list the way the language does: "a, b, and c" / "a, b et c".
 * @param {string[]} items
 * @param {Intl.ListFormatOptions} [options] default `{ type: 'conjunction' }`
 * @returns {string}
 */
export function formatList(items, options = { type: 'conjunction' }) {
	return cached('lf', options, (l) => new Intl.ListFormat(l, options)).format(items);
}

/**
 * A relative time: "5m ago", "2h ago", "3d ago" (English narrow).
 * @param {number} value
 * @param {Intl.RelativeTimeFormatUnit} unit
 * @param {Intl.RelativeTimeFormatOptions} [options] default narrow + numeric auto
 * @returns {string}
 */
export function formatRelative(value, unit, options = { style: 'narrow', numeric: 'auto' }) {
	return cached('rt', options, (l) => new Intl.RelativeTimeFormat(l, options)).format(value, unit);
}

// ── Pseudo-locale (development only) ─────────────────────────────────────────
//
// `?pseudo=1` (persisted as `constellation:dev-pseudo`, cleared by `?pseudo=0`)
// wraps the service's t() so every translated string comes out accented, about
// 35% longer and bracketed: "Save" → "[Šåvé ·····]". Anything still plain
// English on screen was never extracted; anything clipped will clip in German.
// Values passed in `vars` (handles, card names — plan data) are left as they
// are. app.js installs it inside its `__PUZZLE_DEV__` branch only, so a
// production build never carries it.

const ACCENTS = {
	a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
	n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
	A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
	N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

const OPEN = '\u0001';
const CLOSE = '\u0002';

/**
 * Accent, pad and bracket the parts of `text` outside OPEN…CLOSE markers.
 * @param {string} text
 * @returns {string}
 */
export function pseudoize(text) {
	if (!text) return text;
	let out = '';
	let letters = 0;
	let inside = false;
	for (const ch of text) {
		if (ch === OPEN) {
			inside = true;
			continue;
		}
		if (ch === CLOSE) {
			inside = false;
			continue;
		}
		if (inside) {
			out += ch;
			continue;
		}
		if (/[A-Za-z]/.test(ch)) letters++;
		out += ACCENTS[ch] ?? ch;
	}
	const pad = Math.max(1, Math.round(letters * 0.35));
	return '[' + out + ' ' + '·'.repeat(pad) + ']';
}

/**
 * Wrap a service's t() with the pseudo-locale, in place. Development only.
 * @param {{ t: (key: string, vars?: any) => string }} svc
 */
export function installPseudoLocale(svc) {
	const original = svc.t.bind(svc);
	svc.t = (key, vars) => {
		let marked = vars;
		if (vars && typeof vars === 'object' && !Array.isArray(vars)) {
			marked = {};
			for (const name of Object.keys(vars)) {
				const v = vars[name];
				marked[name] = typeof v === 'string' ? OPEN + v + CLOSE : v;
			}
		}
		const text = original(key, marked);
		// A miss prints the key: leave it bare so it stands out as one.
		return text === key ? text : pseudoize(text);
	};
}
