/**
 * Disposable demo sandbox: copies the golden example plan into a temp dir,
 * git-inits it (so edits show up as diffs and git tools work), builds the
 * viewer if needed, and serves it. Edits land in the sandbox, never the repo.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/serve/server.js';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));

if (!existsSync(path.join(pkgRoot, 'viewer', 'dist', 'index.html'))) {
  console.log('building viewer assets…');
  execFileSync('npx', ['vite', 'build', 'viewer'], { cwd: pkgRoot, stdio: 'inherit' });
}

const sandbox = await mkdtemp(path.join(tmpdir(), 'constellation-demo-'));
const planRoot = path.join(sandbox, 'constellation');
await cp(path.join(pkgRoot, 'examples', 'constellation'), planRoot, {
  recursive: true,
});

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: sandbox, stdio: 'pipe' });
git('init', '-q', '-b', 'main');
git('add', '-A');
git(
  '-c', 'user.email=demo@constellation.local',
  '-c', 'user.name=Constellation Demo',
  'commit', '-q', '-m', 'seed demo plan',
);

const port = Number(process.env.PORT ?? 4747);
const running = await startServer({ planRoot, port });
const url = `http://localhost:${running.port}`;

console.log(`✓ Constellation demo at ${url}`);
console.log(`  sandbox: ${sandbox} (disposable — edits land here, not in the repo)`);
console.log(`  inspect your edits with:  git -C ${sandbox} diff`);

if (process.platform === 'darwin') {
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}
