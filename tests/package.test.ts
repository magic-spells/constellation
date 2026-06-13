import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('npm package metadata', () => {
  it('includes runtime schemas in the published package', async () => {
    const packageJson = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(await readFile(packageJson, 'utf8')) as { files?: string[] };
    expect(pkg.files).toContain('schemas');
  });
});
