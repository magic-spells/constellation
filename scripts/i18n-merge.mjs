// scripts/i18n-merge.mjs — TEMPORARY, for the extraction pass only.
//
// While several agents extract strings at once, each writes its area's English
// keys to its own web/i18n-parts/<area>.json (disjoint top-level namespaces), and
// this merges every part into app/locales/en.json. A key defined twice fails.
// Once extraction is done the parts are deleted and en.json is the source.
//
// Run: node scripts/i18n-merge.mjs
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PARTS = join(ROOT, 'viewer', 'i18n-parts');
const EN = join(ROOT, 'viewer', 'app', 'locales', 'en.json');

const problems = [];

function merge(into, from, path, part) {
	for (const [k, v] of Object.entries(from)) {
		const key = path ? `${path}.${k}` : k;
		if (!(k in into)) {
			into[k] = v;
			continue;
		}
		const a = into[k];
		if (a && typeof a === 'object' && v && typeof v === 'object') merge(a, v, key, part);
		else problems.push(`${part}: "${key}" is already defined by another part`);
	}
}

// Translator context: <area>.context.json files are flat { "key": "note" } maps,
// merged into app/locales/context/en.json (a subfolder: Puzzle would read a
// .json beside the locale files as a locale and reject its name).
const context = {};
for (const name of readdirSync(PARTS).filter((n) => n.endsWith('.context.json')).sort()) {
	try {
		for (const [k, v] of Object.entries(JSON.parse(readFileSync(join(PARTS, name), 'utf8')))) {
			if (k in context) problems.push(`${name}: context for "${k}" is already given by another part`);
			context[k] = v;
		}
	} catch (e) {
		problems.push(`${name}: ${e.message}`);
	}
}

const out = {};
for (const name of readdirSync(PARTS).filter((n) => n.endsWith('.json') && !n.endsWith('.context.json')).sort()) {
	let part;
	try {
		part = JSON.parse(readFileSync(join(PARTS, name), 'utf8'));
	} catch (e) {
		problems.push(`${name}: ${e.message}`);
		continue;
	}
	merge(out, part, '', name);
}
if (problems.length) {
	console.error(problems.join('\n'));
	process.exit(1);
}
const order = Object.keys(out).sort((a, b) => (a === 'common' ? -1 : b === 'common' ? 1 : a.localeCompare(b)));
const sorted = Object.fromEntries(order.map((k) => [k, out[k]]));
writeFileSync(EN, JSON.stringify(sorted, null, '\t') + '\n');
const ctxSorted = Object.fromEntries(Object.keys(context).sort().map((k) => [k, context[k]]));
mkdirSync(join(ROOT, 'viewer', 'app', 'locales', 'context'), { recursive: true });
writeFileSync(join(ROOT, 'viewer', 'app', 'locales', 'context', 'en.json'), JSON.stringify(ctxSorted, null, '\t') + '\n');
console.log(`i18n-merge: ${order.length} namespaces → app/locales/en.json`);
