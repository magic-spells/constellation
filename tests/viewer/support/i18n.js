// The English table every viewer suite runs under.
//
// The viewer's words live in viewer/app/locales/en.json and reach the screen
// through Puzzle's t(). Suites keep asserting the English text, so they run
// against the real English table: ./testing.js gives every mountView /
// createTestApp `i18n: { locale: 'en', strings: EN_STRINGS }`, and ./setup.js
// binds lib/i18n.js (the t() plain modules use) to an English service.
import en from '../../../viewer/app/locales/en.json';

const PLURAL = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

/** Flatten a nested locale file the way Puzzle's build does: dotted keys, plural entries kept as objects. */
export function flattenLocale(obj, prefix = '', out = {}) {
	for (const [k, v] of Object.entries(obj)) {
		const key = prefix ? `${prefix}.${k}` : k;
		const isPlural =
			v && typeof v === 'object' && Object.keys(v).length > 0 && Object.keys(v).every((c) => PLURAL.has(c));
		if (v && typeof v === 'object' && !isPlural) flattenLocale(v, key, out);
		else out[key] = v;
	}
	return out;
}

export const EN_STRINGS = flattenLocale(en);

/** The i18n option every mounted view and test app gets unless a suite passes its own. */
export const EN_I18N = { locale: 'en', strings: EN_STRINGS };
