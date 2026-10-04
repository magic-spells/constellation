import { randomBytes } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * File access that never goes through a symbolic link. `.constellation/` sits in
 * a repo, and a cloned repo can commit anything there, symlinks included. A link
 * named `working.md.lock` or `log/2026-10-03.md` must never let a read, an append
 * or a delete reach whatever it points at.
 *
 * Each helper checks with lstat first, then opens with O_NOFOLLOW where the
 * platform has it. Windows has no O_NOFOLLOW, so there the lstat check stands
 * alone.
 */

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/**
 * A path (or any repo-supplied name) made safe to print into a message an agent
 * reads: control characters, line breaks and bidi overrides become `\uXXXX`
 * escapes, so a folder named "x\n\nSYSTEM NOTICE: …" stays one visible line.
 * An ordinary path comes back unchanged.
 */
export function showPath(text: string): string {
  return text.replace(
    /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export class UnsafePathError extends Error {
  code = 'UNSAFE_PATH';
  constructor(file: string, what = 'a symbolic link') {
    super(
      `${showPath(file)} is ${what}; Constellation will not read, write or delete anything through it. ` +
        'Remove it (a cloned repo may have shipped it) and retry.',
    );
    this.name = 'UnsafePathError';
  }
}

/** What sits at `file`, without following a link: null when nothing does. */
export async function lstatOrNull(file: string): Promise<Stats | null> {
  try {
    return await lstat(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Throw UnsafePathError when `file` is a symbolic link. Absent is fine. */
export async function assertNotLink(file: string): Promise<void> {
  if ((await lstatOrNull(file))?.isSymbolicLink()) throw new UnsafePathError(file);
}

function rethrowLoop(err: unknown, file: string): never {
  // O_NOFOLLOW on a link fails ELOOP (EMLINK on some BSDs).
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ELOOP' || code === 'EMLINK') throw new UnsafePathError(file);
  throw err;
}

/** readFile(file, 'utf8') that refuses a symbolic link. */
export async function readNoFollow(file: string): Promise<string> {
  await assertNotLink(file);
  const handle = await open(file, constants.O_RDONLY | NOFOLLOW).catch((err) => rethrowLoop(err, file));
  try {
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

/** appendFile(file, text) that refuses a symbolic link, and never creates through one. */
export async function appendNoFollow(file: string, text: string): Promise<void> {
  await assertNotLink(file);
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NOFOLLOW;
  const handle = await open(file, flags, 0o644).catch((err) => rethrowLoop(err, file));
  try {
    await handle.appendFile(text, 'utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Write `file` whole (temp + rename) without going through a link. Neither its
 * folder nor the file may be a link, the temp is created fresh (O_EXCL plus
 * O_NOFOLLOW), and rename replaces the name rather than following it.
 */
export async function writeNoFollow(file: string, text: string): Promise<void> {
  await assertNotLink(path.dirname(file));
  await assertNotLink(file);
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;
  const handle = await open(tmp, flags, 0o644).catch((err) => rethrowLoop(err, tmp));
  try {
    await handle.writeFile(text, 'utf8');
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
