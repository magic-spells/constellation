import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { link, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Cross-process mutual exclusion for `working.md`: an exclusive `<file>.lock`
 * beside it. The in-process withFileLock only orders writers inside one process;
 * the SessionStart hook, the MCP server and a second agent's server are separate
 * processes.
 *
 * The lock is created whole — written to a temp file, then hard-linked into place
 * (link fails EEXIST like O_EXCL) — so a waiter never reads a half-written one.
 * It records who holds it: { pid, host, token, createdAt }.
 *
 * A lock is stale when its age is negative (a future clock) or over
 * LOCK_STALE_MS, when it is on this host and its pid is gone, or when it is
 * unreadable or corrupt. Waiters re-check that on every poll, so a crashed holder
 * on this machine is cleared at once. Breaking a stale lock is single-winner: it
 * is renamed to a unique `.stale` name (only one rename can succeed), its token
 * re-checked, then unlinked; everyone then takes the lock as normal. Release only
 * removes a lock whose token is ours.
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
/** Temp and `.stale` leftovers older than this are a crash's debris. */
export const TEMP_SWEEP_MS = 60_000;

/** Open/link errors that mean "someone else has it, or Windows is busy with it" — retry. */
const CONTENDED = new Set(['EEXIST', 'EPERM', 'EBUSY']);
/** Read errors that are transient (vanished, or held by Windows mid-delete). */
const TRANSIENT_READ = new Set(['ENOENT', 'EPERM', 'EBUSY']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return true;
    }
  }
  return false;
}

type LockRead = { state: 'gone' } | { state: 'transient' } | { state: 'held'; info: LockInfo | null };

async function readLock(lock: string): Promise<LockRead> {
  try {
    return { state: 'held', info: parseLock(await readFile(lock, 'utf8')) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? '';
    if (code === 'ENOENT') return { state: 'gone' };
    if (TRANSIENT_READ.has(code)) return { state: 'transient' };
    // Unreadable for good (EACCES, EISDIR…): nobody can be relying on it.
    return { state: 'held', info: null };
  }
}

/** Create the lock whole, or report that someone else holds it. */
async function tryCreate(lock: string, info: LockInfo): Promise<boolean> {
  const tmp = `${lock}.${info.token}.tmp`;
  await writeFile(tmp, JSON.stringify(info), 'utf8');
  try {
    await link(tmp, lock);
    return true;
  } catch (err) {
    if (CONTENDED.has((err as NodeJS.ErrnoException).code ?? '')) return false;
    throw err;
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * Break a lock judged stale, single-winner: rename it aside (only one waiter's
 * rename can succeed), then confirm the moved file is the one judged stale. If a
 * fresh lock was taken in between and moved by mistake, put it back.
 */
async function breakStale(lock: string, judged: LockInfo | null): Promise<void> {
  const aside = `${lock}.${newToken()}.stale`;
  try {
    await rename(lock, aside);
  } catch {
    return; // another waiter broke it first, or it was released
  }
  const moved = parseLock(await readFile(aside, 'utf8').catch(() => ''));
  if (judged && moved && moved.token !== judged.token && !isStale(moved)) {
    // Not the lock we judged: hand it back (fails harmlessly if a new one exists).
    await link(aside, lock).catch(() => undefined);
  }
  await rm(aside, { force: true });
}

/** Remove a crash's temp files and `.stale` leftovers beside `file`. */
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
    if (!name.startsWith(`${base}.`)) continue;
    if (!name.endsWith('.tmp') && !name.endsWith('.stale')) continue;
    const full = path.join(dir, name);
    const st = await stat(full).catch(() => null);
    if (st && now - st.mtimeMs > TEMP_SWEEP_MS) {
      await rm(full, { force: true });
      removed.push(full);
    }
  }
  return removed;
}

/** Release only a lock that is still ours. */
async function release(lock: string, token: string): Promise<void> {
  const current = await readLock(lock);
  if (current.state === 'held' && current.info?.token === token) {
    await rm(lock, { force: true });
  }
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
    const held = await readLock(lock);
    if (held.state === 'held' && isStale(held.info)) {
      await breakStale(lock, held.info);
      continue;
    }
    if (held.state === 'gone') continue;
    if (Date.now() > deadline) {
      throw new LockBusyError(
        `working.md is locked by another writer (${lock}); retry. If no writer is running, delete the lock file.`,
      );
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
