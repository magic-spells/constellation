import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lintPlan } from '../src/core/lint.js';

const GOLDEN = fileURLToPath(
  new URL('../examples/constellation', import.meta.url),
);

function fixture(name: string): string {
  return fileURLToPath(
    new URL(`./fixtures/${name}/constellation`, import.meta.url),
  );
}

describe('lintPlan', () => {
  it('passes the golden example with zero issues', async () => {
    const result = await lintPlan(GOLDEN);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('E001: invalid handle filename', async () => {
    const result = await lintPlan(fixture('bad-handle'));
    expect(result.errors.map((i) => i.code)).toContain('E001');
  });

  it('E002: unknown prefix', async () => {
    const result = await lintPlan(fixture('unknown-prefix'));
    expect(result.errors.map((i) => i.code)).toContain('E002');
  });

  it('E003: duplicate handle', async () => {
    const result = await lintPlan(fixture('duplicate'));
    const dupes = result.errors.filter((i) => i.code === 'E003');
    expect(dupes).toHaveLength(1);
    expect(dupes[0].file).toContain('nested');
  });

  it('E004 + E005 + W004: bad and dangling references', async () => {
    const result = await lintPlan(fixture('dangling'));
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('E004'); // not-a-handle connection entry
    expect(codes).toContain('E005'); // API-MISSING frontmatter target
    expect(codes).toContain('W004'); // [[DB-NOPE]] body link
  });

  it('E006: invalid YAML frontmatter', async () => {
    const result = await lintPlan(fixture('bad-yaml'));
    expect(result.errors.map((i) => i.code)).toContain('E006');
  });

  it('W001: card in the wrong type folder', async () => {
    const result = await lintPlan(fixture('wrong-folder'));
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((i) => i.code)).toContain('W001');
  });

  it('W002 + W003: schema violations and unknown fields', async () => {
    const result = await lintPlan(fixture('schema-violation'));
    expect(result.errors).toEqual([]);
    const codes = result.warnings.map((i) => i.code);
    expect(codes).toContain('W002'); // status enum + path type
    expect(codes).toContain('W003'); // banana_count
    expect(codes.filter((c) => c === 'W002').length).toBeGreaterThanOrEqual(2);
  });
});
