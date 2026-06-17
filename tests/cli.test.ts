import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = path.join(repoRoot, 'src', 'cli', 'index.ts');
const tsxBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);
const pkg = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
) as { version: string };

function cli(...args: string[]): string {
  return execFileSync(tsxBin, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  });
}

describe('CLI commands', () => {
  it('prints the package version via version and v commands', () => {
    expect(cli('version').trim()).toBe(pkg.version);
    expect(cli('v').trim()).toBe(pkg.version);
  });

  it('lists upgrade in help without running it', () => {
    const help = cli('--help');
    expect(help).toContain('version');
    expect(help).toContain('upgrade');
  });
});
