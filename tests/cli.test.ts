import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
    expect(help).toContain('rename');
  });

  it('rename moves the card file and rewrites references', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'constellation-cli-rename-'));
    try {
      const plan = path.join(dir, 'constellation');
      mkdirSync(path.join(plan, 'api'), { recursive: true });
      mkdirSync(path.join(plan, 'page'), { recursive: true });
      writeFileSync(path.join(plan, 'plan.md'), '---\nname: T\n---\n\nPlan.\n');
      writeFileSync(
        path.join(plan, 'api', 'API-OLD.md'),
        '---\nname: Old endpoint\n---\n\nThe endpoint.\n',
      );
      writeFileSync(
        path.join(plan, 'page', 'PAGE-REF.md'),
        '---\nconnections:\n  - API-OLD\n---\n\nUses [[API-OLD]].\n',
      );

      const out = cli('rename', 'API-OLD', 'API-NEW', plan);
      expect(out).toContain('API-OLD → API-NEW');
      expect(out).toContain('PAGE-REF');
      expect(existsSync(path.join(plan, 'api', 'API-NEW.md'))).toBe(true);
      expect(existsSync(path.join(plan, 'api', 'API-OLD.md'))).toBe(false);
      const ref = readFileSync(path.join(plan, 'page', 'PAGE-REF.md'), 'utf8');
      expect(ref).toContain('- API-NEW');
      expect(ref).toContain('[[API-NEW]]');
      expect(ref).not.toContain('API-OLD');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
