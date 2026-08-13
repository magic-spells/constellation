// Vendors mermaid's chunked ESM build into the viewer's public/ dir so it
// ships in viewer/dist as static assets instead of being inlined into app.js
// (puzzle build does not split dynamic imports). The 28KB entry dynamically
// imports per-diagram chunks from ./chunks/mermaid.esm.min/, so the browser
// only fetches the diagram types a page actually renders. Loaded on demand by
// viewer/app/lib/markdown.js via a native import(). Source maps are skipped —
// they double the payload and the vendored files are minified upstream anyway.
// The vendor dir is gitignored; this runs before `puzzle dev` / `puzzle build`
// via the dev:viewer / build:viewer scripts.
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const mermaidDist = path.join(root, 'node_modules', 'mermaid', 'dist');
const destDir = path.join(root, 'viewer', 'app', 'public', 'vendor', 'mermaid');
const chunksRel = path.join('chunks', 'mermaid.esm.min');

await mkdir(path.join(destDir, chunksRel), { recursive: true });
await copyFile(
  path.join(mermaidDist, 'mermaid.esm.min.mjs'),
  path.join(destDir, 'mermaid.esm.min.mjs'),
);

const chunkDir = path.join(mermaidDist, chunksRel);
const chunks = (await readdir(chunkDir)).filter((f) => f.endsWith('.mjs'));
await Promise.all(
  chunks.map((f) => copyFile(path.join(chunkDir, f), path.join(destDir, chunksRel, f))),
);
console.log(
  `vendored mermaid.esm.min.mjs + ${chunks.length} chunks -> viewer/app/public/vendor/mermaid/`,
);
