import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  mutateCardFile,
  StaleWriteError,
  withAppendedNote,
  withFileLock,
} from '../src/core/writer.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'constellation-lock-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('withFileLock', () => {
  it('serializes critical sections on the same path, in order', async () => {
    const order: string[] = [];
    const file = path.join(dir, 'lock-target.md');
    await Promise.all([
      withFileLock(file, async () => {
        order.push('a-start');
        await sleep(30);
        order.push('a-end');
      }),
      withFileLock(file, async () => {
        order.push('b-start');
        order.push('b-end');
      }),
    ]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('a throwing holder does not wedge the lock', async () => {
    const file = path.join(dir, 'lock-throw.md');
    await expect(
      withFileLock(file, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const result = await withFileLock(file, async () => 'after');
    expect(result).toBe('after');
  });
});

describe('mutateCardFile', () => {
  it('two slow concurrent read-modify-writes compose instead of clobbering', async () => {
    const file = path.join(dir, 'DOC-MUTATE.md');
    await writeFile(file, '---\nname: Mutate\n---\n\nBody.\n', 'utf8');

    // Each transform reads the CURRENT notes and sleeps before returning —
    // without the lock, both would read zero notes and the later write would
    // drop the earlier note.
    const appendSlowly = (text: string) =>
      mutateCardFile(file, async (current) => {
        await sleep(20);
        return {
          frontmatter: withAppendedNote(current.frontmatter, {
            kind: 'state',
            text,
          }),
        };
      });
    await Promise.all([appendSlowly('first'), appendSlowly('second')]);

    const raw = await readFile(file, 'utf8');
    expect(raw).toContain('first');
    expect(raw).toContain('second');
    expect(raw).toContain('Body.'); // body untouched
  });

  it('if_mtime is checked inside the lock so the second overlapping writer is STALE', async () => {
    const file = path.join(dir, 'DOC-STALE.md');
    await writeFile(file, '---\nname: Stale\n---\n\nBody.\n', 'utf8');
    const t = Math.round((await stat(file)).mtimeMs);

    const first = mutateCardFile(
      file,
      async () => {
        await sleep(40);
        return { body: 'first\n' };
      },
      { if_mtime: t },
    );
    await sleep(5);
    const second = mutateCardFile(file, () => ({ body: 'second\n' }), {
      if_mtime: t,
    });

    await first;
    await expect(second).rejects.toBeInstanceOf(StaleWriteError);
    const raw = await readFile(file, 'utf8');
    expect(raw).toContain('first');
    expect(raw).not.toContain('second');
  });
});
