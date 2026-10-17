// Vendors pele's ESM build into the viewer's public/ dir so it ships in
// viewer/dist as static assets instead of being inlined into app.js (puzzle
// build does not split dynamic imports). lazy.js is the entry; it imports the
// shared core from ./chunks/ and fetches one chunk per diagram type on first
// use, so the browser only downloads the types a page actually renders.
// diagrams/ is copied too so the tree mirrors the package's own export map.
// Loaded on demand by viewer/app/lib/markdown.js via a native import().
// The vendor dir is gitignored; this runs before `puzzle dev` / `puzzle build`
// via the dev:viewer / build:viewer scripts.
import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = path.join(root, 'node_modules', 'pele', 'dist', 'esm');
const destDir = path.join(root, 'viewer', 'app', 'public', 'vendor', 'pele');

// Start clean so chunks from an older pele (hashed names) never linger.
await rm(destDir, { recursive: true, force: true });
await cp(src, destDir, { recursive: true });
console.log('vendored pele (lazy.js, core.js, diagrams/, chunks/) -> viewer/app/public/vendor/pele/');
