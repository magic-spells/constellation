// scripts/check-i18n.mjs — the viewer's hard-coded-string guard. Ported from
// Pyramid's web/scripts/check-i18n.mjs so the two apps police text the same way.
//
// Every word the viewer shows comes from viewer/app/locales/<tag>.json through
// t(). This scans viewer/app's sources and fails with file:line on text that did not:
//
//   .pzl templates
//     - text between tags with a letter in it;
//     - a STATIC value of a text-bearing attribute — aria-label, title,
//       placeholder, alt, and every component prop named like text (label,
//       hint, description, text, message, error, …Label, …Text, …Placeholder,
//       …Title, …Hint, …Message, …Description, …Heading);
//     - an English-looking string literal inside a `{ expression }`.
//   JavaScript (viewer/app/**/*.js and every .pzl <script>)
//     - an English-looking string literal: a Capitalized word, several words,
//       or a trailing ellipsis — minus keys, class lists, paths, identifiers,
//       imports, console calls and comparisons (see `suspicious()` below).
//
// It also checks the keys: every literal key passed to t() — or held in a
// property or variable whose name ends in `Key`/`Keys` — must exist in en.json.
// (tests/viewer/i18n-locales.test.js checks the reverse: no unused keys, and every
// locale file's keys and placeholders against en.json.)
//
// Genuine exceptions get an explicit escape on the same line, so each one is a
// deliberate, greppable decision:
//
//   const BRAND = 'GitHub'; // i18n-ok: product name
//   <span>⌘K</span> <!-- i18n-ok: keyboard glyph -->
//
// or, for a whole file, `i18n-file-ok: <reason>` anywhere in it. Words that
// are never translated anywhere (the product name, brand names, keyboard key
// names) are in ALLOW below.
//
// Run: node scripts/check-i18n.mjs   (tests/viewer/i18n-hardcoded.test.js runs it in `npm test`)

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP = join(ROOT, 'viewer', 'app');
const EN = join(APP, 'locales', 'en.json');

// Never scanned: third-party code, the locale files themselves, the shell
// (public/), and stylesheets.
const SKIP_DIRS = new Set(['vendor', 'locales', 'public', 'styles', 'assets']);
const SKIP_FILES = new Set([]);

/** Words that stay as they are in every language. */
const ALLOW = new Set([
	'Constellation',
	'Magic Spells',
	'GitHub',
	'Markdown',
	'Mermaid',
	'Inter',
	'JSON',
	'YAML',
	// KeyboardEvent.key values and modifier names compared in handlers
	'Escape', 'Enter', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
	'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift', 'Meta', 'Control', 'Alt',
	'Space', 'Spacebar', 'Esc', 'Dead', 'Unidentified', 'Process',
	// HTTP header names
	'Content-Type', 'If-Match', 'Accept', 'Cache-Control', 'ETag', 'Location',
	// Intl / DOM enum values that happen to be capitalized
	'UTC', 'Z',
]);

const TEXT_ATTR =
	/^(aria-(label|description|valuetext|roledescription|placeholder)|title|placeholder|alt|label|text|hint|description|message|error|heading|tooltip|caption|summary|subtitle|empty|confirm|cancel)$|(Label|Text|Placeholder|Title|Hint|Message|Description|Heading|Caption|Tooltip)$/;

/** @type {{ file: string, line: number, text: string, why: string }[]} */
const problems = [];

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) {
			if (!SKIP_DIRS.has(name)) walk(p, out);
		} else if ((name.endsWith('.pzl') || name.endsWith('.js')) && !SKIP_FILES.has(name)) {
			out.push(p);
		}
	}
	return out;
}

function lineAt(src, index) {
	let n = 1;
	for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
	return n;
}

function lineText(src, line) {
	return src.split('\n')[line - 1] ?? '';
}

// ── JavaScript string literals ───────────────────────────────────────────────

/**
 * Every string literal (and template-literal static part) in `src`, with its
 * offset. A small tokenizer: comments, strings, templates with `${}` nesting,
 * and regex literals told apart from division by the previous significant token.
 * @param {string} src
 * @returns {{ value: string, start: number, end: number, template: boolean }[]}
 */
export function stringLiterals(src) {
	const out = [];
	let i = 0;
	let prev = ''; // last significant char
	let prevWord = '';
	/** @type {number[]} template `${` depth stack */
	const tpl = [];
	let braceDepth = 0;
	const n = src.length;
	while (i < n) {
		const c = src[i];
		if (c === '/' && src[i + 1] === '/') {
			const e = src.indexOf('\n', i);
			i = e < 0 ? n : e;
			continue;
		}
		if (c === '/' && src[i + 1] === '*') {
			const e = src.indexOf('*/', i + 2);
			i = e < 0 ? n : e + 2;
			continue;
		}
		if (c === '"' || c === "'") {
			const start = i;
			let v = '';
			i++;
			while (i < n && src[i] !== c) {
				if (src[i] === '\\') {
					v += src[i + 1];
					i += 2;
					continue;
				}
				if (src[i] === '\n') break;
				v += src[i++];
			}
			i++;
			out.push({ value: v, start, end: i, template: false });
			prev = 'a';
			prevWord = '';
			continue;
		}
		if (c === '`' || (c === '}' && tpl.length && tpl[tpl.length - 1] === braceDepth)) {
			if (c === '}') tpl.pop();
			const start = i;
			let v = '';
			i++;
			let closed = false;
			while (i < n) {
				if (src[i] === '\\') {
					v += src[i + 1];
					i += 2;
					continue;
				}
				if (src[i] === '`') {
					i++;
					closed = true;
					break;
				}
				if (src[i] === '$' && src[i + 1] === '{') {
					i += 2;
					tpl.push(braceDepth);
					break;
				}
				v += src[i++];
			}
			out.push({ value: v, start, end: i, template: true });
			prev = closed ? 'a' : '(';
			prevWord = '';
			continue;
		}
		if (c === '/') {
			const regexCtx = prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new'].includes(prevWord);
			if (regexCtx) {
				i++;
				let cls = false;
				while (i < n) {
					if (src[i] === '\\') {
						i += 2;
						continue;
					}
					if (src[i] === '[') cls = true;
					else if (src[i] === ']') cls = false;
					else if (src[i] === '/' && !cls) break;
					else if (src[i] === '\n') break;
					i++;
				}
				i++;
				while (i < n && /[a-z]/i.test(src[i])) i++;
				prev = 'a';
				prevWord = '';
				continue;
			}
		}
		if (c === '{') braceDepth++;
		if (c === '}') braceDepth--;
		if (/[A-Za-z_$0-9]/.test(c)) {
			let w = '';
			while (i < n && /[A-Za-z_$0-9]/.test(src[i])) w += src[i++];
			prev = 'a';
			prevWord = w;
			continue;
		}
		if (!/\s/.test(c)) {
			prev = c;
			prevWord = '';
		}
		i++;
	}
	return out;
}

const KEY_SHAPE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+)+$/;

/** A Tailwind/CSS class list, an identifier list, or other machine text. */
function machineText(v) {
	const s = v.trim();
	if (!s) return true;
	if (!/[A-Za-z]{2}/.test(s)) return true;
	if (ALLOW.has(s)) return true;
	if (KEY_SHAPE.test(s)) return true;
	if (/^[a-z0-9]+([_-][a-z0-9]+)*$/.test(s)) return true; // identifier/slug
	if (/^[A-Z0-9_]+$/.test(s)) return true; // CONSTANT
	if (/^(https?:|mailto:|tel:|data:|blob:|\/|\.\/|\.\.\/|#|\?|&)/.test(s)) return true;
	if (/^[\w.-]+\/[\w.*+-]+$/.test(s)) return true; // mime type, path
	if (/^[\w-]+\.(svg|png|js|pzl|json|css|html|jpg|webp)$/.test(s)) return true;
	if (/^--?[a-z]/.test(s)) return true; // css var / flag
	const tokens = s.split(/\s+/);
	// class lists, selectors, transition shorthands: no uppercase-led prose, and
	// something only machines write (a dash, colon, bracket, slash, dot, digit+unit)
	if (!/[A-Z][a-z]/.test(s) && tokens.every((t) => /^[!-]?[a-z0-9:[\]/._%#()&>*~=,@'"+-]+$/.test(t))) {
		if (tokens.some((t) => /[-:[\]/.#()=>@]|\d(px|ms|s|rem|em|%)/.test(t))) return true;
	}
	if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(s)) return true; // camelCase identifier
	if (/^[A-Z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$/.test(s) && !/\s/.test(s)) return true; // PascalCase like DOMRect
	if (/^\[?[a-z-]+(=|\])/.test(s) || /^[.#[][\w-]/.test(s)) return true; // selector
	if (/^%[sdoOjc]/.test(s)) return true;
	return false;
}

/** English-looking: capitalized prose, several words, or a trailing ellipsis. */
function suspicious(v) {
	if (machineText(v)) return false;
	const s = v.trim();
	if (/^[A-Z][a-z']/.test(s)) return true;
	if (/[A-Za-z]{2,}\s+[A-Za-z0-9]/.test(s)) return true;
	if (/(…|\.\.\.)$/.test(s) && /[a-z]{2}/i.test(s)) return true;
	if (/^[a-z]{2,}$/.test(s)) return false; // a lone lowercase word is an identifier
	return false;
}

/** Context in which a literal is never UI text. */
function exemptContext(src, lit) {
	const before = src.slice(Math.max(0, lit.start - 80), lit.start);
	const after = src.slice(lit.end, lit.end + 12);
	if (/(import|from|require\(|import\()\s*$/.test(before)) return true;
	if (/\bconsole\.\w+\([^;]*$/.test(before.split('\n').pop())) return true;
	if (/(===|!==|==|!=)\s*$/.test(before) || /^\s*(===|!==|==|!=)/.test(after)) return true;
	if (/\bcase\s*$/.test(before)) return true;
	if (/^\s*:/.test(after) && /[{,]\s*$/.test(before)) return true; // object key
	if (/\bt\(\s*$/.test(before)) return true; // the key itself
	if (/\b(querySelector(All)?|closest|matches|getAttribute|setAttribute|removeAttribute|hasAttribute|addEventListener|removeEventListener|dispatchEvent|createElement|getElementById|getPropertyValue|setProperty|toggleAttribute|CustomEvent|Event|postMessage|localStorage\.\w+|sessionStorage\.\w+|setItem|getItem|removeItem|get|set|has|delete|append|startsWith|endsWith|includes|split|join|replace|replaceAll|indexOf)\(\s*$/.test(before)) return true;
	if (/\bnew\s+(Error|TypeError|RangeError|DOMException)\(\s*$/.test(before)) return true;
	return false;
}

function okLine(text) {
	return /i18n-ok\b/.test(text);
}

function scanJs(file, src, offset = 0, fullSrc = src) {
	if (/i18n-file-ok\b/.test(fullSrc)) return;
	for (const lit of stringLiterals(src)) {
		const v = lit.value;
		if (!suspicious(v)) continue;
		if (exemptContext(src, lit)) continue;
		const line = lineAt(fullSrc, offset + lit.start);
		if (okLine(lineText(fullSrc, line))) continue;
		problems.push({ file, line, text: v.trim().slice(0, 80), why: 'string literal' });
	}
}

// ── .pzl templates ───────────────────────────────────────────────────────────

/** Blank out a range, keeping newlines so offsets and line numbers hold. */
function blank(s) {
	return s.replace(/[^\n]/g, ' ');
}

/**
 * Split a .pzl file into its template (with <script>/<style> blanked) and its
 * script blocks (with their offsets).
 */
function splitPzl(src) {
	const scripts = [];
	let template = src.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/g, (m, body, idx) => {
		scripts.push({ body, offset: idx + m.indexOf(body) });
		return blank(m);
	});
	template = template.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, (m) => blank(m));
	template = template.replace(/<!--[\s\S]*?-->/g, (m) => blank(m));
	return { template, scripts };
}

/** Index just past the `}` matching the `{` at `i`, skipping strings. */
function matchBrace(s, i) {
	let depth = 0;
	for (let j = i; j < s.length; j++) {
		const c = s[j];
		if (c === "'" || c === '"' || c === '`') {
			j++;
			while (j < s.length && s[j] !== c) {
				if (s[j] === '\\') j++;
				j++;
			}
			continue;
		}
		if (c === '{') depth++;
		else if (c === '}') {
			depth--;
			if (depth === 0) return j + 1;
		}
	}
	return s.length;
}

function scanTemplate(file, src, template) {
	if (/i18n-file-ok\b/.test(src)) return;
	const report = (index, text, why) => {
		const line = lineAt(src, index);
		if (okLine(lineText(src, line))) return;
		problems.push({ file, line, text: text.trim().slice(0, 80), why });
	};
	let i = 0;
	let textStart = 0;
	let text = '';
	const flushText = () => {
		const s = text.replace(/\s+/g, ' ').trim();
		if (s && /[A-Za-z]/.test(s) && !ALLOW.has(s)) report(textStart, s, 'template text');
		text = '';
	};
	const n = template.length;
	while (i < n) {
		const c = template[i];
		if (c === '\\' && (template[i + 1] === '{' || template[i + 1] === '}')) {
			i += 2;
			continue;
		}
		if (c === '{') {
			const end = matchBrace(template, i);
			const expr = template.slice(i + 1, end - 1);
			if (!/^\s*#svg\b/.test(expr)) scanExpr(file, src, expr, i + 1);
			i = end;
			continue;
		}
		if (c === '<' && /[A-Za-z/!]/.test(template[i + 1] ?? '')) {
			flushText();
			// a tag: walk attributes, honouring quotes and braces
			let j = i + 1;
			while (j < n && template[j] !== '>') {
				if (template[j] === '{') {
					const end = matchBrace(template, j);
					scanExpr(file, src, template.slice(j + 1, end - 1), j + 1);
					j = end;
					continue;
				}
				const m = /^([A-Za-z_:@][\w:.@-]*)\s*=\s*(["'])/.exec(template.slice(j, j + 200));
				if (m && /\s/.test(template[j - 1])) {
					const name = m[1];
					const q = m[2];
					const vStart = j + m[0].length;
					let k = vStart;
					let value = '';
					while (k < n && template[k] !== q) {
						if (template[k] === '{') {
							const end = matchBrace(template, k);
							scanExpr(file, src, template.slice(k + 1, end - 1), k + 1);
							value += ' ';
							k = end;
							continue;
						}
						value += template[k++];
					}
					if (TEXT_ATTR.test(name) && /[A-Za-z]{2}/.test(value) && !ALLOW.has(value.trim())) {
						report(vStart, `${name}="${value.trim()}"`, 'static attribute');
					}
					j = k + 1;
					continue;
				}
				j++;
			}
			i = j + 1;
			textStart = i;
			continue;
		}
		if (!text) textStart = i;
		text += c;
		i++;
	}
	flushText();
}

function scanExpr(file, src, expr, offset) {
	for (const lit of stringLiterals(expr)) {
		if (!suspicious(lit.value)) continue;
		if (exemptContext(expr, lit)) continue;
		const line = lineAt(src, offset + lit.start);
		if (okLine(lineText(src, line))) continue;
		problems.push({ file, line, text: lit.value.trim().slice(0, 80), why: 'string in expression' });
	}
}

// ── keys used in code exist in en.json ───────────────────────────────────────

function flatten(obj, prefix = '', out = new Map()) {
	for (const [k, v] of Object.entries(obj)) {
		const key = prefix ? prefix + '.' + k : k;
		const plural = v && typeof v === 'object' && Object.keys(v).length > 0 && Object.keys(v).every((c) => ['zero', 'one', 'two', 'few', 'many', 'other'].includes(c));
		if (v && typeof v === 'object' && !plural) flatten(v, key, out);
		else out.set(key, v);
	}
	return out;
}

/** Blank JS and HTML comments (outside strings), keeping offsets. */
export function stripComments(src) {
	let out = '';
	let i = 0;
	let q = '';
	while (i < src.length) {
		const c = src[i];
		if (q) {
			out += c;
			if (c === '\\') {
				out += src[i + 1] ?? '';
				i += 2;
				continue;
			}
			if (c === q || (c === '\n' && q !== '`')) q = '';
			i++;
			continue;
		}
		if (c === "'" || c === '"' || c === '`') {
			q = c;
			out += c;
			i++;
			continue;
		}
		let end = -1;
		const upto = (needle, from) => {
			const k = src.indexOf(needle, from);
			return k < 0 ? src.length : k + needle.length;
		};
		if (c === '/' && src[i + 1] === '/' && src[i - 1] !== ':') end = upto('\n', i) - 1;
		else if (c === '/' && src[i + 1] === '*') end = upto('*/', i + 2);
		else if (src.startsWith('<!--', i)) end = upto('-->', i + 4);
		if (end !== -1) {
			out += blank(src.slice(i, end));
			i = end;
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

/** Literal keys in t('…') calls and in `…Key: '…'` / `…Key = '…'` holders. */
export function literalKeys(src) {
	src = stripComments(src);
	const keys = [];
	const re = /\bt\(\s*(['"])([^'"\n]+)\1\s*[,)]|\b\w*Keys?\s*[:=]\s*(['"])([a-z][\w-]*(?:\.[\w-]+)+)\3/g;
	let m;
	while ((m = re.exec(src))) {
		const key = m[2] ?? m[4];
		keys.push({ key, index: m.index });
	}
	return keys;
}

// ── run ──────────────────────────────────────────────────────────────────────

export function run() {
	problems.length = 0;
	const en = flatten(JSON.parse(readFileSync(EN, 'utf8')));
	for (const path of walk(APP)) {
		const file = relative(ROOT, path);
		const src = readFileSync(path, 'utf8');
		if (path.endsWith('.pzl')) {
			const { template, scripts } = splitPzl(src);
			scanTemplate(file, src, template);
			for (const s of scripts) scanJs(file, s.body, s.offset, src);
		} else {
			scanJs(file, src);
		}
		if (!/i18n-file-ok\b/.test(src)) {
			for (const { key, index } of literalKeys(src)) {
				if (!en.has(key)) problems.push({ file, line: lineAt(src, index), text: key, why: 'key missing from en.json' });
			}
		}
	}
	return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const found = run();
	if (found.length) {
		const byFile = new Map();
		for (const p of found) {
			if (!byFile.has(p.file)) byFile.set(p.file, []);
			byFile.get(p.file).push(p);
		}
		for (const [file, list] of byFile) {
			for (const p of list) console.error(`${file}:${p.line}  ${p.why}: ${p.text}`);
		}
		console.error(`\ncheck-i18n: ${found.length} hard-coded string(s) or unknown key(s) in ${byFile.size} file(s).`);
		console.error('Move the text into viewer/app/locales/en.json and print it with t(); or mark a genuine exception `i18n-ok: <reason>` on its line.');
		process.exit(1);
	}
	console.log('check-i18n: no hard-coded user-facing strings; every literal key exists in en.json.');
}
