// Vendors pele's lazy ESM entry into the viewer's public/ dir so it ships in
// viewer/dist as static assets instead of being inlined into app.js (puzzle
// build does not split dynamic imports). lazy.js imports only ./chunks/ — the
// shared core, plus one chunk per diagram type fetched on first use — so the
// browser downloads only the types a page renders, and core.js / diagrams/
// (the package's other entries) are not copied. LICENSE travels with the
// minified code (MIT). Loaded on demand by viewer/app/lib/markdown.js via a
// native import(). The vendor dir is gitignored; this runs before
// `puzzle dev` / `puzzle build` via the dev:viewer / build:viewer scripts.
import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = path.join(root, 'node_modules', 'pele');
const vendor = path.join(root, 'viewer', 'app', 'public', 'vendor');
const destDir = path.join(vendor, 'pele');

// Start clean so chunks from an older pele (hashed names) never linger, and
// drop the mermaid copy a pre-pele build left behind — public/ is copied into
// dist/ wholesale, so a stale 11 MB of it would otherwise ship.
await rm(destDir, { recursive: true, force: true });
await rm(path.join(vendor, 'mermaid'), { recursive: true, force: true });
await cp(path.join(pkg, 'dist', 'esm', 'lazy.js'), path.join(destDir, 'lazy.js'));
await cp(path.join(pkg, 'dist', 'esm', 'chunks'), path.join(destDir, 'chunks'), { recursive: true });
await cp(path.join(pkg, 'LICENSE'), path.join(destDir, 'LICENSE'));
console.log('vendored pele (lazy.js, chunks/, LICENSE) -> viewer/app/public/vendor/pele/');
