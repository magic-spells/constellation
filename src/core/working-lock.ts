import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdir, readdir, readFile, rename, rm, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Cross-process mutual exclusion for `working.md`: a `<file>.lock` folder beside
 * it. The in-process withFileLock only orders writers inside one process; the
 * SessionStart hook, the MCP server and a second agent's server are separate
 * processes.
 *
 * The lock is held while `<file>.lock/` holds a `<token>.json` recording
 * { pid, host, token, createdAt }. A writer builds that folder whole under a temp
 * name, then renames it into place. A folder rename lands only where nothing is,
 * or an empty folder is, so exactly one writer takes a free lock.
 *
 * Release and breaking both unlink one exact `<token>.json`. Tokens are unique and
 * never reused, so an unlink can only free the lock it was aimed at: a waiter that
 * judged token S stale and acts late gets ENOENT, and never removes S's successor.
 * Release needs no read-then-remove check for the same reason. So breaking is a
 * plain unlink, with no breaker lock and no put-it-back step. The one overlap left
 * is the one any lease allows: a live holder that outruns LOCK_STALE_MS is broken.
 *
 * A holder is stale when its age is negative (a future clock) or over
 * LOCK_STALE_MS, when it is on this host and its pid is gone, or when its record
 * is unreadable or corrupt. Waiters re-check that on every poll, so a crashed
 * holder on this machine is cleared at once. An empty lock folder is a free lock;
 * rmdir removes it, and rmdir only succeeds while it is empty.
 */

export interface LockInfo {
  pid: number;
  host: string;
  token: string;
  createdAt: number;
}

export class LockBusyError extends Error {
  code = 'BUSY';
  constructor(message: string) {
    super(message);
    this.name = 'LockBusyError';
  }
}

/** A lock older than this belongs to a writer that died. */
export const LOCK_STALE_MS = 10_000;
/** How long a writer waits before failing BUSY — kept under the stale age. */
export const LOCK_WAIT_MS = 5_000;
/** Temp leftovers older than this are a crash's debris. */
export const TEMP_SWEEP_MS = 60_000;

/**
 * Rename errors that mean "taken, or Windows is busy with it" — retry. EEXIST and
 * ENOTEMPTY: a held folder is there. ENOTDIR: a plain file is there. EPERM: Windows
 * will not rename over any folder, or something holds a file open.
 */
const CONTENDED = new Set(['EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EPERM', 'EBUSY']);
/** Read errors that are transient (vanished, or held by Windows mid-delete). */
const TRANSIENT_READ = new Set(['ENOENT', 'EPERM', 'EBUSY']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errCode = (err: unknown) => (err as NodeJS.ErrnoException).code ?? '';

function newToken(): string {
  return randomBytes(8).toString('hex');
}

function parseLock(raw: string): LockInfo | null {
  try {
    const value = JSON.parse(raw) as Partial<LockInfo>;
    if (
      typeof value?.pid === 'number' &&
      typeof value.host === 'string' &&
      typeof value.token === 'string' &&
      typeof value.createdAt === 'number'
    ) {
      return value as LockInfo;
    }
  } catch {
    // corrupt — handled by the caller
  }
  return null;
}

/** True when `info` cannot belong to a live holder. */
export function isStale(info: LockInfo | null, now = Date.now()): boolean {
  if (!info) return true;
  const age = now - info.createdAt;
  if (age < 0 || age > LOCK_STALE_MS) return true;
  if (info.host === hostname()) {
    try {
      process.kill(info.pid, 0);
    } catch (err) {
      if (errCode(err) === 'ESRCH') return true;
    }
  }
  return false;
}

/** One holder record: the exact path that frees it, and what it says. */
interface Holder {
  path: string;
  info: LockInfo | null;
}

type LockRead = { state: 'free' } | { state: 'transient' } | { state: 'held'; holders: Holder[] };

/** Read one holder record; null when it vanished (released or broken meanwhile). */
async function readHolder(file: string): Promise<Holder | null | 'transient'> {
  try {
    return { path: file, info: parseLock(await readFile(file, 'utf8')) };
  } catch (err) {
    const code = errCode(err);
    if (code === 'ENOENT') return null;
    if (TRANSIENT_READ.has(code)) return 'transient';
    // Unreadable for good (EACCES, EISDIR…): nobody can be relying on it.
    return { path: file, info: null };
  }
}

async function readLock(lock: string): Promise<LockRead> {
  let names: string[];
  try {
    names = await readdir(lock);
  } catch (err) {
    const code = errCode(err);
    if (code === 'ENOENT') return { state: 'free' };
    if (code === 'ENOTDIR') {
      // A plain file: a lock left by an earlier build of this module, judged alike.
      const holder = await readHolder(lock);
      if (holder === 'transient') return { state: 'transient' };
      return holder ? { state: 'held', holders: [holder] } : { state: 'free' };
    }
    if (TRANSIENT_READ.has(code)) return { state: 'transient' };
    throw err;
  }
  const holders: Holder[] = [];
  for (const name of names) {
    const holder = await readHolder(path.join(lock, name));
    if (holder === 'transient') return { state: 'transient' };
    if (holder) holders.push(holder);
  }
  return holders.length > 0 ? { state: 'held', holders } : { state: 'free' };
}

/** Take the lock whole, or report that someone else holds it. */
async function tryCreate(lock: string, info: LockInfo): Promise<boolean> {
  const tmp = `${lock}.${info.token}.tmp`;
  await mkdir(tmp, { recursive: true });
  try {
    await writeFile(path.join(tmp, `${info.token}.json`), JSON.stringify(info), 'utf8');
    await rename(tmp, lock);
    return true;
  } catch (err) {
    if (CONTENDED.has(errCode(err))) return false;
    throw err;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Unlink one holder record by its exact name; ENOENT just means it is already
 * gone. Given an earlier build's plain-file lock, unlink fails on the folder a
 * newer writer may have put there since, so it never frees a newer lock.
 */
async function removeHolder(file: string): Promise<void> {
  await unlink(file).catch(() => undefined);
}

/** Remove the lock folder only while it is empty (free); a no-op once anyone holds it. */
async function removeIfEmpty(lock: string): Promise<void> {
  await rmdir(lock).catch(() => undefined);
}

/** Remove the temp files and temp lock folders a crash left beside `file`. */
export async function sweepDebris(file: string, now = Date.now()): Promise<string[]> {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const removed: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.startsWith(`${base}.`) || !name.endsWith('.tmp')) continue;
    const full = path.join(dir, name);
    const st = await stat(full).catch(() => null);
    if (st && now - st.mtimeMs > TEMP_SWEEP_MS) {
      await rm(full, { recursive: true, force: true });
      removed.push(full);
    }
  }
  return removed;
}

/** Release only our own lock: unlinking our token's record cannot free anyone else's. */
async function release(lock: string, token: string): Promise<void> {
  await removeHolder(path.join(lock, `${token}.json`));
  await removeIfEmpty(lock);
}

/** Run `fn` holding `<file>.lock`. Throws LockBusyError after LOCK_WAIT_MS. */
export async function withWriteLock<T>(
  file: string,
  fn: () => Promise<T>,
  opts: { waitMs?: number } = {},
): Promise<T> {
  const lock = `${file}.lock`;
  const info: LockInfo = { pid: process.pid, host: hostname(), token: newToken(), createdAt: 0 };
  const deadline = Date.now() + (opts.waitMs ?? LOCK_WAIT_MS);
  for (;;) {
    info.createdAt = Date.now();
    if (await tryCreate(lock, info)) break;
    if (Date.now() > deadline) {
      throw new LockBusyError(
        `working.md is locked by another writer (${lock}); retry. If no writer is running, delete that folder.`,
      );
    }
    const held = await readLock(lock);
    if (held.state === 'free') {
      // An empty folder: rename replaces it on POSIX; Windows needs it gone first.
      await removeIfEmpty(lock);
      continue;
    }
    if (held.state === 'held' && held.holders.every((h) => isStale(h.info))) {
      for (const h of held.holders) await removeHolder(h.path);
      await removeIfEmpty(lock);
      continue;
    }
    await sleep(10 + Math.random() * 30);
  }
  try {
    await sweepDebris(file);
    return await fn();
  } finally {
    await release(lock, info.token);
  }
}
