import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A switchable stub over fs/promises.rename, to play a file held open by another
// program (EBUSY) — the one failure a real filesystem will not produce on demand.
// Only working.md's own temp rename fails; the lock's rename into place does not.
const renameStub = vi.hoisted(() => ({ failures: 0 }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (renameStub.failures > 0 && String(from).endsWith('.tmp') && !String(to).endsWith('.lock')) {
        renameStub.failures -= 1;
        throw Object.assign(new Error(`EBUSY: resource busy or locked, rename '${from}'`), {
          code: 'EBUSY',
        });
      }
      return real.rename(from, to);
    },
  };
});

const { withWriteLock, sweepDebris, LOCK_WAIT_MS } = await import('../src/core/working-lock.js');
const { dropItems, initWorking, readLog, readWorking, setItems } = await import(
  '../src/core/working.js'
);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const cliPath = path.join(repoRoot, 'src', 'cli', 'index.ts');
const workerPath = path.join(repoRoot, 'tests', 'lock-worker.ts');

let repo: string;
let planRoot: string;
let file: string;
let lock: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
}

/** A readable label as a lock token: 16 hex characters, the only shape a record name has. */
function hexToken(label: string): string {
  return Buffer.from(label).toString('hex').padEnd(16, '0').slice(0, 16);
}

/** Plant a holder in the lock folder: a record, or raw (corrupt) text. */
async function writeLock(info: Record<string, unknown> | string): Promise<void> {
  await mkdir(lock, { recursive: true });
  const name = `${hexToken(typeof info === 'string' ? 'corrupt' : String(info.token))}.json`;
  await writeFile(path.join(lock, name), typeof info === 'string' ? info : JSON.stringify(info));
}

async function expectUnlocked(): Promise<void> {
  await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
}

beforeEach(async () => {
  renameStub.failures = 0;
  repo = await realpath(await mkdtemp(path.join(tmpdir(), 'constellation-wlock-')));
  planRoot = path.join(repo, 'constellation');
  await mkdir(planRoot, { recursive: true });
  await writeFile(path.join(planRoot, 'plan.md'), '---\nname: Lock\n---\n');
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  await initWorking(planRoot);
  file = path.join(repo, '.constellation', 'working.md');
  lock = `${file}.lock`;
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('stale locks', () => {
  it('breaks a lock from the future instead of waiting on it forever', async () => {
    await writeLock({ pid: process.pid, host: hostname(), token: 'future', createdAt: Date.parse('2030-01-01') });
    const started = Date.now();
    await setItems(planRoot, [{ type: 'T', text: 'lands' }]);
    expect(Date.now() - started).toBeLessThan(2000);
    await expectUnlocked();
  });

  it('breaks a dead pid on this host at once', async () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid!;
    await writeLock({ pid: dead, host: hostname(), token: 'dead', createdAt: Date.now() });
    const started = Date.now();
    await setItems(planRoot, [{ type: 'T', text: 'lands' }]);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('breaks a corrupt lock', async () => {
    await writeLock('{ half a lo');
    await setItems(planRoot, [{ type: 'T', text: 'lands' }]);
    expect((await readWorking(planRoot)).items).toHaveLength(1);
  });

  it('waits on a live holder, then fails BUSY', async () => {
    await writeLock({ pid: process.pid, host: hostname(), token: 'live', createdAt: Date.now() });
    await expect(
      withWriteLock(file, async () => 'never', { waitMs: 100 }),
    ).rejects.toMatchObject({ code: 'BUSY' });
    // Not ours, so not removed.
    expect(await readdir(lock)).toEqual([`${hexToken('live')}.json`]);
  });

  it('reads a plain lock file from an earlier build: waits on a live one, breaks a stale one', async () => {
    await writeFile(lock, JSON.stringify({ pid: process.pid, host: hostname(), token: 'live', createdAt: Date.now() }));
    await expect(
      withWriteLock(file, async () => 'never', { waitMs: 100 }),
    ).rejects.toMatchObject({ code: 'BUSY' });
    expect(JSON.parse(await readFile(lock, 'utf8')).token).toBe('live');
    await writeFile(lock, JSON.stringify({ pid: process.pid, host: hostname(), token: 'old', createdAt: 1 }));
    await setItems(planRoot, [{ type: 'T', text: 'lands' }]);
    await expectUnlocked();
  });

  it('treats an empty lock folder as free', async () => {
    await mkdir(lock);
    await setItems(planRoot, [{ type: 'T', text: 'lands' }]);
    await expectUnlocked();
  });

  it('breaks a stale lock single-winner: concurrent waiters never overlap', async () => {
    await writeLock({ pid: process.pid, host: hostname(), token: 'old', createdAt: 1 });
    let active = 0;
    let peak = 0;
    const runs = Array.from({ length: 12 }, () =>
      withWriteLock(file, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      }),
    );
    await Promise.all(runs);
    expect(peak).toBe(1);
    await expectUnlocked();
  });

  it(
    'breaks a stale lock single-winner across processes: holders never overlap',
    async () => {
      const events = path.join(repo, 'events.log');
      const go = path.join(repo, 'go');
      const workers = 8; // processes
      const crashers = 3; // each dies holding the lock, leaving a dead-pid holder to break
      const lanes = 4; // concurrent writers per process
      const rounds = 4;
      // Planted stale: a long-gone holder, then a dead pid on this host, then corrupt.
      const planted: Array<Record<string, unknown> | string> = [
        { pid: process.pid, host: hostname(), token: 'old', createdAt: 1 },
        { pid: spawnSync(process.execPath, ['-e', '']).pid!, host: hostname(), token: 'dead', createdAt: Date.now() },
        '{ half a lo',
      ];
      for (const stale of planted) {
        await rm(lock, { recursive: true, force: true });
        await rm(go, { force: true });
        await writeFile(events, '');
        await writeLock(stale);
        const children = Array.from({ length: workers }, (_, i) => {
          const mode = i < crashers ? 'crash' : 'normal';
          const child = spawn(
            process.execPath,
            ['--import', 'tsx', workerPath, file, events, go, String(rounds), String(lanes), mode],
            { cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe'] },
          );
          let stderr = '';
          child.stderr!.on('data', (d) => (stderr += d));
          return new Promise<void>((resolve, reject) =>
            child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${code}: ${stderr}`)))),
          );
        });
        // Release them all at once, so every waiter meets the stale lock together.
        for (;;) {
          const ready = (await readFile(events, 'utf8')).split('\n').filter((l) => l.startsWith('ready'));
          if (ready.length === workers) break;
          await new Promise((r) => setTimeout(r, 20));
        }
        await writeFile(go, '');
        await Promise.all(children);

        const lines = (await readFile(events, 'utf8')).trim().split('\n');
        expect(lines.filter((l) => l.startsWith('OVERLAP'))).toEqual([]);
        // Every enter (or crash) finds nobody inside; every exit closes its own enter.
        let inside: string | null = null;
        const count = { enter: 0, crash: 0 };
        for (const line of lines) {
          const [event, who] = line.split(' ');
          if (event === 'enter' || event === 'crash') {
            expect(inside).toBeNull();
            count[event] += 1;
            if (event === 'enter') inside = who;
          } else if (event === 'exit') {
            expect(inside).toBe(who);
            inside = null;
          }
        }
        expect(inside).toBeNull();
        expect(count).toEqual({ enter: (workers - crashers) * lanes * rounds, crash: crashers });
        await expectUnlocked();
      }
    },
    60_000,
  );
});

describe('release', () => {
  it('never removes a lock that is not ours', async () => {
    await withWriteLock(file, async () => {
      // Somebody broke ours and took the lock meanwhile.
      await rm(lock, { recursive: true });
      await writeLock({ pid: process.pid, host: hostname(), token: 'theirs', createdAt: Date.now() });
    });
    expect(await readdir(lock)).toEqual([`${hexToken('theirs')}.json`]);
  });

  it('removes our own lock', async () => {
    await withWriteLock(file, async () => {
      const [name] = await readdir(lock);
      const held = JSON.parse(await readFile(path.join(lock, name), 'utf8'));
      expect(held).toMatchObject({ pid: process.pid, host: hostname() });
      expect(name).toBe(`${held.token}.json`);
    });
    await expectUnlocked();
  });
});

describe('debris', () => {
  it('sweeps temp files a crash left behind, and only old ones', async () => {
    const old = `${file}.999.0.abc.tmp`;
    const fresh = `${file}.999.1.abd.tmp`;
    // A lock folder a crash left half-built under its temp name.
    const lockTmp = `${lock}.${hexToken('dead')}.tmp`;
    await writeFile(old, 'x');
    await writeFile(fresh, 'x');
    await mkdir(lockTmp);
    await writeFile(path.join(lockTmp, `${hexToken('dead')}.json`), 'x');
    const past = new Date(Date.now() - 5 * 60_000);
    await utimes(old, past, past);
    await utimes(lockTmp, past, past);
    await setItems(planRoot, [{ type: 'T', text: 'sweep' }]);
    await expect(readFile(old, 'utf8')).rejects.toThrow();
    await expect(stat(lockTmp)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(fresh, 'utf8')).resolves.toBe('x');
    expect(await sweepDebris(file)).toEqual([]);
  });
});

describe('a held target file (EBUSY on rename)', () => {
  it('retries the rename and lands', async () => {
    renameStub.failures = 2;
    await setItems(planRoot, [{ type: 'T', text: 'after two busy renames' }]);
    expect((await readWorking(planRoot)).items.map((i) => i.text)).toEqual([
      'after two busy renames',
    ]);
    expect(renameStub.failures).toBe(0);
  });

  it('logs an abort line after the drop it logged, when the rename never lands', async () => {
    await setItems(planRoot, [{ type: 'T', text: 'stays' }]);
    renameStub.failures = 100;
    await expect(dropItems(planRoot, ['T1'], 'merged')).rejects.toMatchObject({ code: 'EBUSY' });
    renameStub.failures = 0;
    const log = await readLog(planRoot, 'today');
    expect(log.at(-2)).toMatch(/drop T1 — merged$/);
    expect(log.at(-1)).toMatch(/abort — EBUSY/);
    // The change did not land, and the lock was released.
    expect((await readWorking(planRoot)).items.map((i) => i.id)).toEqual(['T1']);
    await expectUnlocked();
  });
});

describe('the hook when the list is busy', () => {
  it('says it could not clear, then prints the set', async () => {
    await setItems(planRoot, [{ type: 'T', text: 'still here' }]);
    await writeFile(
      path.join(repo, '.constellation', 'config.json'),
      '{ "working": { "enabled": true, "new_session": "clear" } }\n',
    );
    // A live holder (this test process) for longer than the hook will wait.
    await writeLock({ pid: process.pid, host: hostname(), token: 'busy', createdAt: Date.now() });
    const out = execFileSync(tsxBin, [cliPath, 'working'], {
      cwd: repo,
      encoding: 'utf8',
      input: JSON.stringify({ source: 'startup' }),
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
    });
    expect(out.split('\n')[0]).toBe('working memory: list busy, not cleared this session');
    expect(out).toContain('- T1 [3] still here');
  }, LOCK_WAIT_MS + 20_000);
});

