/**
 * Vite/vitest plugin: compile `.pzl` single-file components on the fly.
 *
 * The Puzzle build normally runs `.pzl` through an esbuild loader inside the Go
 * CLI, which vitest never touches. To let root vitest tests import
 * `viewer/app/**\/*.pzl` directly, this plugin shells out to `pzlc` — the
 * one-shot single-file compiler in the puzzle repo (`compiler/cmd/pzlc`, the
 * same split → parse → codegen pipeline the esbuild plugin runs).
 *
 * Mode inference from the path mirrors the app's own layout:
 *   `/views/`   → --mode view
 *   `/layouts/` → --mode layout   (also emits a <puzzle-view> root)
 *   otherwise   → --mode component
 *
 * Compiled output keeps the `.pzl` <script> verbatim, so a component import
 * survives as `import Foo from '../components/Foo.pzl'`. Vite re-enters this
 * plugin for those siblings, which is exactly the real module graph.
 *
 * Ids are rewritten to `<abs path>.pzl.js` in resolveId so the rest of the vite
 * pipeline sees a JavaScript extension (an unknown `.pzl` extension is treated
 * as an asset). The `.js` suffix is virtual — nothing is written next to the
 * source — but it keeps the directory intact so relative sibling specifiers
 * still resolve.
 *
 * Requires the Go toolchain and a checkout of the puzzle repo (override its
 * location with PUZZLE_REPO). When either is missing the plugin stays inert and
 * `.pzl` imports fail the way they would without it.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PUZZLE_REPO =
	process.env.PUZZLE_REPO ||
	path.resolve(import.meta.dirname, '../../../puzzle');

const SUFFIX = '.pzl.js';

let outDir = null;

function compile(pzlPath) {
	const mode = pzlPath.includes(`${path.sep}views${path.sep}`)
		? 'view'
		: pzlPath.includes(`${path.sep}layouts${path.sep}`)
			? 'layout'
			: 'component';
	if (!outDir) outDir = mkdtempSync(path.join(tmpdir(), 'pzlc-'));
	const key = createHash('sha1').update(pzlPath).digest('hex').slice(0, 12);
	const out = path.join(
		outDir,
		`${path.basename(pzlPath, '.pzl')}.${key}.js`
	);
	try {
		execFileSync('go', ['run', './compiler/cmd/pzlc', '--mode', mode, pzlPath, out], {
			cwd: PUZZLE_REPO,
			stdio: ['ignore', 'ignore', 'pipe'],
			encoding: 'utf8',
		});
	} catch (error) {
		const detail = (error.stderr || error.message || '').trim();
		throw new Error(`pzlc failed for ${pzlPath}:\n${detail}`);
	}
	return readFileSync(out, 'utf8');
}

export function pzlPlugin() {
	const available = existsSync(path.join(PUZZLE_REPO, 'compiler/cmd/pzlc'));
	return {
		name: 'pzl-via-pzlc',
		enforce: 'pre',
		resolveId(source, importer) {
			if (!available) return null;
			if (source.endsWith(SUFFIX)) return source;
			if (!source.endsWith('.pzl')) return null;
			const base = importer ? path.dirname(importer.replace(/\.pzl\.js$/, '')) : process.cwd();
			const abs = path.isAbsolute(source) ? source : path.resolve(base, source);
			return abs + '.js';
		},
		load(id) {
			if (!available || !id.endsWith(SUFFIX)) return null;
			const pzlPath = id.slice(0, -3);
			this.addWatchFile?.(pzlPath);
			return compile(pzlPath);
		},
	};
}

export default pzlPlugin;
