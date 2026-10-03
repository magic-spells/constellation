// The trust check fails closed: inside a git repo, a git that errors (missing,
// a held lock, a corrupt index, a hostile config) means the folder is refused —
// never read as "nothing tracked".
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A switchable stub over child_process.execFile: when on, `git ls-files` fails.
const gitStub = vi.hoisted(() => ({ failLsFiles: false }));
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const failing = (args: unknown) => gitStub.failLsFiles && Array.isArray(args) && args.includes('ls-files');
  const execFile = ((file: string, args: unknown, ...rest: unknown[]) => {
    if (failing(args)) {
      const cb = rest.find((r) => typeof r === 'function') as ((err: Error) => void) | undefined;
      const err = new Error('fatal: index file corrupt');
      queueMicrotask(() => cb?.(err));
      return undefined as never;
    }
    return (real.execFile as (...a: unknown[]) => unknown)(file, args, ...rest);
  }) as typeof real.execFile;
  const realAsync = promisify(real.execFile);
  Object.defineProperty(execFile, promisify.custom, {
    value: (file: string, args: string[], opts: object) =>
      failing(args) ? Promise.reject(new Error('fatal: index file corrupt')) : realAsync(file, args, opts),
  });
  return { ...real, execFile };
});

const { initWorking, readWorking, setItems } = await import('../src/core/working.js');

let repo: string;
let planRoot: string;

beforeEach(async () => {
  gitStub.failLsFiles = false;
  repo = await realpath(await mkdtemp(path.join(tmpdir(), 'constellation-wtrust-')));
  planRoot = path.join(repo, 'constellation');
  await mkdir(planRoot, { recursive: true });
  await writeFile(path.join(planRoot, 'plan.md'), '---\nname: Trust\n---\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  await initWorking(planRoot);
  await setItems(planRoot, [{ type: 'T', text: 'ours' }]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe('the trust check when git fails', () => {
  it('refuses the folder rather than trusting it', async () => {
    gitStub.failLsFiles = true;
    const err = await readWorking(planRoot).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'UNTRUSTED_WORKING' });
    expect((err as Error).message).toContain('could not ask git');
    expect((err as Error).message).toContain('index file corrupt');
    await expect(setItems(planRoot, [{ type: 'T', text: 'x' }])).rejects.toMatchObject({
      code: 'UNTRUSTED_WORKING',
    });
  });

  it('works again once git does', async () => {
    expect((await readWorking(planRoot)).items.map((i) => i.text)).toEqual(['ours']);
  });
});
