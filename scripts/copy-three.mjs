// Vendors three's ESM build into the viewer's public/ dir so it ships in
// viewer/dist as a static asset instead of being inlined into app.js — the same
// reason and the same shape as scripts/copy-mermaid.mjs (puzzle build does not
// split dynamic imports).
//
// Measured, which is why this exists: importing three through the bundler took
// app.js from 431 KB to 1.1 MB (136 KB → 328 KB gzip) for EVERY reader, and the
// atlas is one view most of them never open. Vendored, the bytes only leave the
// server when someone switches the atlas to the lit engine.
//
// three.module.min.js imports three.core.min.js as a sibling, so both are copied
// and the relative specifier between them keeps working untouched.
//
// The vendor dir is gitignored; this runs before `puzzle dev` / `puzzle build`
// via the dev:viewer / build:viewer scripts. Loaded on demand by
// viewer/app/lib/atlas-three.js through a native import().
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const buildDir = path.join(root, 'node_modules', 'three', 'build');
const destDir = path.join(root, 'viewer', 'app', 'public', 'vendor', 'three');

const files = ['three.module.min.js', 'three.core.min.js'];

await mkdir(destDir, { recursive: true });
await Promise.all(
  files.map((f) => copyFile(path.join(buildDir, f), path.join(destDir, f))),
);
console.log(`vendored ${files.join(' + ')} -> viewer/app/public/vendor/three/`);
