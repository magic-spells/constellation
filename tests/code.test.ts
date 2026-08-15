import { describe, expect, it } from 'vitest';
import { boundPathsOverlap, normalizeBoundPath } from '../src/core/code.js';

describe('normalizeBoundPath', () => {
  it('strips trailing slashes and backslashes', () => {
    expect(normalizeBoundPath('tests/')).toBe('tests');
    expect(normalizeBoundPath('tests//')).toBe('tests');
    expect(normalizeBoundPath('src\\lib')).toBe('src/lib');
  });
});

describe('boundPathsOverlap', () => {
  it('treats a directory as overlapping every path under it', () => {
    expect(boundPathsOverlap('tests', 'tests/mcp-drift.test.ts')).toBe(true);
    expect(boundPathsOverlap('tests/', 'tests/mcp-drift.test.ts')).toBe(true);
    expect(boundPathsOverlap('src/lib/a.ts', 'src/lib')).toBe(true);
  });

  it('does not treat a path prefix without a slash boundary as a directory', () => {
    expect(boundPathsOverlap('src/api', 'src/api-client.ts')).toBe(false);
    expect(boundPathsOverlap('src/a.ts', 'src/b.ts')).toBe(false);
  });
});
