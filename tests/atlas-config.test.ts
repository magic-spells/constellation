import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeAtlasConfig,
  readAtlasConfig,
  writeAtlasConfig,
} from '../src/core/atlas-config.js';

const tempPlan = () => mkdtemp(join(tmpdir(), 'atlas-config-'));

describe('normalizeAtlasConfig', () => {
  it('keeps a well-formed config', () => {
    const input = {
      districts: ['FEATURE-AUTH', 'type:DB'],
      pin: { 'DB-CORE': [4, 2] },
      shape: { 'JOB-SYNC': 'plant' },
      height: { 'API-TICKETS': 3 },
      lens: 'drift',
      engine: 'lit',
      hide: ['FILE-TSCONFIG'],
    };
    expect(normalizeAtlasConfig(input)).toEqual(input);
  });

  // The file is hand-editable, so "mostly right" has to still work.
  it('drops junk rather than throwing', () => {
    const config = normalizeAtlasConfig({
      districts: 'not-an-array',
      pin: { 'DB-CORE': [1, 2], 'not a handle': [0, 0], 'DB-BAD': [1] },
      shape: { 'JOB-SYNC': 42 },
      height: { 'API-X': -3, 'API-Y': 2 },
      lens: 7,
      hide: ['FILE-OK', 'lowercase'],
      unknownKey: 'ignored',
    });
    expect(config.districts).toBeUndefined();
    expect(config.pin).toEqual({ 'DB-CORE': [1, 2] });
    expect(config.shape).toBeUndefined();
    expect(config.height).toEqual({ 'API-Y': 2 });
    expect(config.lens).toBeUndefined();
    expect(config.hide).toEqual(['FILE-OK']);
    expect('unknownKey' in config).toBe(false);
  });

  it('rejects non-integer and negative pins', () => {
    const config = normalizeAtlasConfig({
      pin: { 'DB-A': [1.5, 0], 'DB-B': [-1, 0], 'DB-C': [0, 0] },
    });
    expect(config.pin).toEqual({ 'DB-C': [0, 0] });
  });

  it('treats a non-object as empty', () => {
    for (const value of [null, undefined, 42, 'text', []]) {
      expect(normalizeAtlasConfig(value)).toEqual({});
    }
  });
});

describe('readAtlasConfig', () => {
  it('is {} when the file is absent — the normal case', async () => {
    expect(await readAtlasConfig(await tempPlan())).toEqual({});
  });

  // A hand-edited config must never be able to take the atlas down.
  it('is {} when the file is malformed JSON', async () => {
    const root = await tempPlan();
    await writeFile(join(root, 'atlas.json'), '{ this is not json', 'utf8');
    expect(await readAtlasConfig(root)).toEqual({});
  });

  it('normalizes on read', async () => {
    const root = await tempPlan();
    await writeFile(
      join(root, 'atlas.json'),
      JSON.stringify({ lens: 'drift', pin: { bad: [0, 0] } }),
      'utf8',
    );
    expect(await readAtlasConfig(root)).toEqual({ lens: 'drift' });
  });
});

describe('writeAtlasConfig', () => {
  it('round-trips through the file', async () => {
    const root = await tempPlan();
    await writeAtlasConfig(root, { lens: 'degree', pin: { 'DB-CORE': [2, 1] } });
    expect(await readAtlasConfig(root)).toEqual({
      lens: 'degree',
      pin: { 'DB-CORE': [2, 1] },
    });
  });

  it('normalizes before writing, so junk never reaches disk', async () => {
    const root = await tempPlan();
    await writeAtlasConfig(root, { lens: 'x', nope: true, pin: { bad: [0, 0] } } as never);
    const text = await readFile(join(root, 'atlas.json'), 'utf8');
    expect(text).not.toContain('nope');
    expect(text).not.toContain('bad');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('overwrites an existing config', async () => {
    const root = await tempPlan();
    await writeAtlasConfig(root, { lens: 'drift' });
    await writeAtlasConfig(root, { lens: 'size' });
    expect(await readAtlasConfig(root)).toEqual({ lens: 'size' });
  });
});
