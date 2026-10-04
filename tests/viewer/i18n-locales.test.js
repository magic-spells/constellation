// The viewer's locale files against the code and against each other.
//
//   1. every key the code names exists in en.json (literal keys; and every
//      dynamic prefix — t('status.' + s) — names at least one key);
//   2. en.json has no key the code never names;
//   3. every translated locale has exactly en.json's keys, and each value the
//      same {placeholders} and, for plurals, a plural entry with `other`
//      whose every form carries {count};
//   4. the language picker (lib/locale.js) lists exactly puzzle.config.js's
//      locales.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../viewer/app/locales/en.json';
import config from '../../viewer/puzzle.config.js';
import { LANGUAGES } from '../../viewer/app/lib/locale.js';
import { flattenLocale } from './support/i18n.js';
import { literalKeys, stripComments } from '../../scripts/check-i18n.mjs';

const APP = join(process.cwd(), 'viewer', 'app');
const SKIP_DIRS = new Set(['vendor', 'locales', 'public', 'styles']);

function sources(dir = APP, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			if (!SKIP_DIRS.has(name)) sources(p, out);
		} else if (name.endsWith('.pzl') || name.endsWith('.js')) {
			out.push({ path: p.slice(APP.length + 1), src: readFileSync(p, 'utf8') });
		}
	}
	return out;
}

const FILES = sources();
const EN = flattenLocale(en);
const KEYS = Object.keys(EN);

/** Every quoted key-shaped string in the code, and every dynamic key prefix. */
function usage() {
	const literals = new Set();
	const prefixes = new Set();
	for (const { src } of FILES) {
		const code = stripComments(src);
		for (const m of code.matchAll(/(['"`])([a-zA-Z][\w-]*(?:\.[\w-]+)+)\1/g)) literals.add(m[2]);
		// t('a.b.' + x), labelKey: 'a.b.' + x, `a.b.${x}`
		for (const m of code.matchAll(/(['"])([a-zA-Z][\w-]*(?:\.[\w-]+)*\.)\1\s*\+/g)) prefixes.add(m[2]);
		for (const m of code.matchAll(/`([a-zA-Z][\w-]*(?:\.[\w-]+)*\.)\$\{/g)) prefixes.add(m[1]);
	}
	return { literals, prefixes };
}

const { literals, prefixes } = usage();

/** A plural entry whose every form (zero and one included) prints {count}. */
function countInEveryForm(entry) {
	return Object.values(entry).every((form) => String(form).includes('{count}'));
}

function placeholders(value) {
	const texts = typeof value === 'string' ? [value] : Object.values(value ?? {});
	const names = new Set();
	for (const text of texts) for (const m of String(text).matchAll(/\{([^{}]+)\}/g)) names.add(m[1]);
	return names;
}

describe('en.json against the code', () => {
	it('has every literal key the code passes to t() or holds in a …Key', () => {
		const missing = [];
		for (const { path, src } of FILES) {
			for (const { key } of literalKeys(src)) if (!(key in EN)) missing.push(`${path}: ${key}`);
		}
		expect(missing).toEqual([]);
	});

	it('has at least one key under every dynamic key prefix', () => {
		const namespaces = new Set(KEYS.map((k) => k.split('.')[0]));
		const empty = [...prefixes].filter(
			(p) => namespaces.has(p.split('.')[0]) && !KEYS.some((k) => k.startsWith(p)),
		);
		expect(empty).toEqual([]);
	});

	it('has no key the code never names', () => {
		const unused = KEYS.filter((k) => !literals.has(k) && ![...prefixes].some((p) => k.startsWith(p)));
		expect(unused).toEqual([]);
	});

	it('writes every plural entry with an `other` form and a {count} in every form', () => {
		const bad = KEYS.filter((k) => typeof EN[k] === 'object' && (!EN[k].other || !countInEveryForm(EN[k])));
		expect(bad).toEqual([]);
	});
});

describe('the locale files', () => {
	const tags = config.i18n.locales;

	it('exist for every configured locale, with en as the default', () => {
		expect(config.i18n.defaultLocale).toBe('en');
		for (const tag of tags) expect(() => readFileSync(join(APP, 'locales', `${tag}.json`), 'utf8')).not.toThrow();
	});

	it('are the languages the picker offers', () => {
		expect(LANGUAGES.map((l) => l.value).sort()).toEqual([...tags].sort());
	});

	for (const tag of tags.filter((t) => t !== 'en')) {
		it(`${tag}: has en.json's keys and placeholders`, () => {
			const table = flattenLocale(JSON.parse(readFileSync(join(APP, 'locales', `${tag}.json`), 'utf8')));
			expect(Object.keys(table).filter((k) => !(k in EN))).toEqual([]);
			expect(KEYS.filter((k) => !(k in table))).toEqual([]);
			const mismatched = [];
			for (const k of KEYS) {
				const want = placeholders(EN[k]);
				const got = placeholders(table[k]);
				if (typeof EN[k] === 'object') {
					want.delete('count');
					got.delete('count');
					if (typeof table[k] !== 'object' || !table[k].other) mismatched.push(`${k}: not a plural entry with "other"`);
					else if (!countInEveryForm(table[k])) mismatched.push(`${k}: a plural form without {count}`);
					if (EN[k].zero !== undefined && table[k]?.zero === undefined) mismatched.push(`${k}: en has a "zero" form`);
				}
				const a = [...want].sort().join(',');
				const b = [...got].sort().join(',');
				if (a !== b) mismatched.push(`${k}: {${b}} ≠ en {${a}}`);
			}
			expect(mismatched).toEqual([]);
		});
	}
});
