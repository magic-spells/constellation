// Vendors mermaid's self-contained UMD build into the viewer's public/ dir so
// it ships in viewer/dist as a static asset instead of being inlined into
// app.js (puzzle build does not split dynamic imports). Loaded on demand by
// viewer/app/lib/markdown.js. The vendor dir is gitignored; this runs before
// `puzzle dev` / `puzzle build` via the dev:viewer / build:viewer scripts.
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = path.join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const destDir = path.join(root, 'viewer', 'app', 'public', 'vendor');

await mkdir(destDir, { recursive: true });
await copyFile(src, path.join(destDir, 'mermaid.min.js'));
console.log('vendored mermaid.min.js -> viewer/app/public/vendor/');
