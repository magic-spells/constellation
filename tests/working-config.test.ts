import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHookSource, readHookSource } from '../src/cli/hook-input.js';
import {
  normalizeWorkingConfig,
  readWorkingConfigAt,
  writeWorkingConfigAt,
} from '../src/core/working-config.js';
import {
  clearForNewSession,
  ensureIgnored,
  initWorking,
  readLog,
  readWorking,
  setItems,
  trackedWorkingWarning,
} from '../src/core/working.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const tsxBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
);
const cliPath = path.join(repoRoot, 'src', 'cli', 'index.ts');

let repo: string;
let planRoot: string;
let dir: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** Run the CLI with stdin piped from `input` (never a TTY), as the hook does. */
function cli(cwd: string, args: string[], input = ''): string {
  return execFileSync(tsxBin, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    input,
    stdio: 'pipe',
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
  });
}

function cliStatus(cwd: string, args: string[]): number {
  try {
    cli(cwd, args);
    return 0;
  } catch (err) {
    return (err as { status: number }).status;
  }
}

beforeEach(async () => {
  repo = await realpath(await mkdtemp(path.join(tmpdir(), 'constellation-wcfg-')));
  planRoot = path.join(repo, 'constellation');
  dir = path.join(repo, '.constellation');
  await mkdir(planRoot, { recursive: true });
  await writeFile(path.join(planRoot, 'plan.md'), '---\nname: Fixture\n---\n\nBody.\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'initial');
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

/* ── reading the file ──────────────────────────────────────────────────── */

describe('config.json', () => {
  it('defaults to on + keep when the file is missing', async () => {
    const read = await readWorkingConfigAt(dir);
    expect(read).toMatchObject({
      config: { enabled: true, new_session: 'keep' },
      exists: false,
      warnings: [],
    });
  });

  it('fills a missing key from the defaults, silently', () => {
    expect(normalizeWorkingConfig({ working: { new_session: 'clear' } })).toEqual({
      config: { enabled: true, new_session: 'clear' },
      warnings: [],
    });
    expect(normalizeWorkingConfig({})).toEqual({
      config: { enabled: true, new_session: 'keep' },
      warnings: [],
    });
  });

  it('degrades a malformed file to the defaults with a warning, never a throw', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'config.json'), '{ nope', 'utf8');
    const broken = await readWorkingConfigAt(dir);
    expect(broken.config).toEqual({ enabled: true, new_session: 'keep' });
    expect(broken.exists).toBe(true);
    expect(broken.warnings[0]).toContain('not valid JSON');

    await writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({ working: { enabled: 'no', new_session: 'sometimes' } }),
      'utf8',
    );
    const wrong = await readWorkingConfigAt(dir);
    expect(wrong.config).toEqual({ enabled: true, new_session: 'keep' });
    expect(wrong.warnings).toHaveLength(2);

    expect(normalizeWorkingConfig([]).warnings[0]).toContain('not a JSON object');
    expect(normalizeWorkingConfig({ working: 3 }).warnings[0]).toContain('"working"');
  });

  it('writes both keys, keeps unknown ones, and ifMissing never overwrites', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'config.json'),
      JSON.stringify({ other: 1, working: { enabled: true, extra: 'x' } }),
      'utf8',
    );
    const kept = await writeWorkingConfigAt(dir, { enabled: false }, { ifMissing: true });
    expect(kept.written).toBe(false);
    expect(kept.config.enabled).toBe(true);

    await writeWorkingConfigAt(dir, { new_session: 'clear' });
    expect(JSON.parse(await readFile(path.join(dir, 'config.json'), 'utf8'))).toEqual({
      other: 1,
      working: { enabled: true, extra: 'x', new_session: 'clear' },
    });
  });
});

/* ── init: the user's answers ──────────────────────────────────────────── */

describe('initWorking answers', () => {
  it('writes the answers into a new config.json and names no defaults', async () => {
    const result = await initWorking(planRoot, { enabled: true, new_session: 'clear' });
    expect(result.config).toEqual({ enabled: true, new_session: 'clear' });
    expect(result.config_created).toBe(true);
    expect(result.defaults_applied).toBeUndefined();
    expect(JSON.parse(await readFile(path.join(dir, 'config.json'), 'utf8'))).toEqual({
      working: { enabled: true, new_session: 'clear' },
    });
  });

  it('never overwrites an existing config.json, and says so', async () => {
    await initWorking(planRoot, { new_session: 'clear' });
    const again = await initWorking(planRoot, { new_session: 'keep' });
    expect(again.config.new_session).toBe('clear');
    expect(again.config_created).toBe(false);
    expect(again.config_unchanged).toContain('already exists');
    expect(JSON.parse(await readFile(path.join(dir, 'config.json'), 'utf8')).working.new_session).toBe(
      'clear',
    );
  });

  it('enabled: false records the answer, creates nothing else, still ignores the folder', async () => {
    const result = await initWorking(planRoot, { enabled: false, hook: true });
    expect(result.config.enabled).toBe(false);
    expect(result.hook).toBeUndefined();
    expect(await readdir(dir)).toEqual(['config.json']);
    expect((await readFile(path.join(repo, '.gitignore'), 'utf8')).split('\n')).toContain(
      '.constellation/',
    );
    expect(result.gitignore_check).toBe('ok');
  });
});

/* ── gitignore: checked, not assumed ───────────────────────────────────── */

describe('gitignore check', () => {
  it('ok on a fresh repo: the whole folder, CLAUDE.md included, is ignored', async () => {
    const result = await initWorking(planRoot);
    expect(result.gitignore_check).toBe('ok');
    expect(result.tracked).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(git(repo, 'check-ignore', '.constellation/CLAUDE.md').trim()).toBe(
      '.constellation/CLAUDE.md',
    );
  });

  it('fixed: a later rule un-ignoring the folder loses to our line moved last', async () => {
    await writeFile(path.join(repo, '.gitignore'), '.constellation/\nnode_modules\n!.constellation/\n');
    const result = await initWorking(planRoot);
    expect(result.gitignore).toBe('present');
    expect(result.gitignore_check).toBe('fixed');
    const raw = await readFile(path.join(repo, '.gitignore'), 'utf8');
    expect(raw.trimEnd().split('\n').at(-1)).toBe('.constellation/');
    expect(raw.match(/^\.constellation\/$/gm)).toHaveLength(1);
    expect(git(repo, 'status', '--porcelain', '--untracked-files=all')).not.toContain(
      '.constellation/',
    );
  });

  it('ok when a parent .gitignore tries to un-ignore a package folder', async () => {
    const pkg = path.join(repo, 'packages', 'foo');
    await mkdir(path.join(pkg, 'constellation'), { recursive: true });
    await writeFile(path.join(pkg, 'constellation', 'plan.md'), '---\nname: Foo\n---\n');
    await writeFile(path.join(repo, '.gitignore'), '!packages/foo/.constellation/\n');
    const result = await initWorking(path.join(pkg, 'constellation'));
    expect(result.gitignore_check).toBe('ok');
  });

  it('migrates the old pair and warns about an already-tracked CLAUDE.md, never untracking it', async () => {
    // A repo set up before 1.1: the pair in .gitignore and CLAUDE.md committed.
    await writeFile(
      path.join(repo, '.gitignore'),
      '# Constellation working memory (local scratchpad; the rules file is committed)\n.constellation/*\n!.constellation/CLAUDE.md\n',
    );
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'CLAUDE.md'), '# rules\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'old layout');

    const result = await initWorking(planRoot);
    expect(result.gitignore).toBe('migrated');
    expect(result.gitignore_check).toBe('ok');
    expect(result.tracked).toEqual(['.constellation/CLAUDE.md']);
    expect(result.warnings.join(' ')).toContain('git rm --cached -r .constellation');
    // Reported, not run: the file is still in the index.
    expect(git(repo, 'ls-files', '.constellation').trim()).toBe('.constellation/CLAUDE.md');
    expect(await trackedWorkingWarning(planRoot)).toContain('.constellation/CLAUDE.md');
  });

  it('skips quietly outside git', async () => {
    const loose = await realpath(await mkdtemp(path.join(tmpdir(), 'constellation-wcfg-nogit-')));
    try {
      await mkdir(path.join(loose, 'constellation'), { recursive: true });
      await writeFile(path.join(loose, 'constellation', 'plan.md'), '---\nname: L\n---\n');
      const result = await ensureIgnored(path.join(loose, 'constellation'));
      expect(result.gitignore_check).toBe('skipped');
      expect(result.warnings).toEqual([]);
    } finally {
      await rm(loose, { recursive: true, force: true });
    }
  });
});

/* ── new_session: clear ────────────────────────────────────────────────── */

async function seedSet(): Promise<void> {
  await initWorking(planRoot);
  await setItems(planRoot, [
    { type: 'G', importance: 5, text: 'ship it' },
    { type: 'C', importance: 5, text: '"never tag or publish"' },
    { type: 'T', text: 'stripe webhook' },
    { type: 'Q', text: 'test keys?' },
  ]);
}

describe('clearForNewSession', () => {
  it('keeps CONSTRAINT lines, drops the rest and logs each one with its text', async () => {
    await seedSet();
    const { dropped } = await clearForNewSession(planRoot);
    expect(dropped).toEqual(['G1', 'T1', 'Q1']);
    const set = await readWorking(planRoot);
    expect(set.items.map((i) => i.id)).toEqual(['C1']);
    const log = await readLog(planRoot, 'today');
    expect(log).toEqual([
      expect.stringMatching(/drop G1 — new session · \[5\] ship it$/),
      expect.stringMatching(/drop T1 — new session · \[3\] stripe webhook$/),
      expect.stringMatching(/drop Q1 — new session · \[3\] test keys\?$/),
    ]);
    // Ids are never reused after a clear.
    expect((await setItems(planRoot, [{ type: 'T', text: 'next' }])).ids).toEqual(['T2']);
  });

  it('writes nothing when only constraints are left', async () => {
    await initWorking(planRoot);
    await setItems(planRoot, [{ type: 'C', text: 'rule' }]);
    const before = await readFile(path.join(dir, 'working.md'), 'utf8');
    expect((await clearForNewSession(planRoot)).dropped).toEqual([]);
    expect(await readFile(path.join(dir, 'working.md'), 'utf8')).toBe(before);
  });
});

/* ── the hook's stdin ──────────────────────────────────────────────────── */

describe('hook stdin', () => {
  it('parses source and tolerates empty or invalid input', () => {
    expect(parseHookSource('{"hook_event_name":"SessionStart","source":"startup"}')).toBe('startup');
    expect(parseHookSource('')).toBeNull();
    expect(parseHookSource('not json')).toBeNull();
    expect(parseHookSource('[1]')).toBeNull();
    expect(parseHookSource('{"source":3}')).toBeNull();
  });

  it('never reads a TTY', async () => {
    const stream = Object.assign(new PassThrough(), { isTTY: true });
    stream.write('{"source":"startup"}');
    expect(await readHookSource(stream, 1000)).toBeNull();
  });

  it('reads a closed pipe, and gives up on one nobody closes', async () => {
    const closed = new PassThrough();
    closed.end('{"source":"clear"}');
    expect(await readHookSource(closed, 1000)).toBe('clear');

    const empty = new PassThrough();
    empty.end();
    expect(await readHookSource(empty, 1000)).toBeNull();

    const open = new PassThrough();
    const started = Date.now();
    expect(await readHookSource(open, 50)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

/* ── the CLI ───────────────────────────────────────────────────────────── */

describe('constellation working (hook) with settings', { timeout: 30_000 }, () => {
  it('prints nothing when working memory is off', async () => {
    await seedSet();
    cli(repo, ['working', 'off']);
    expect(cli(repo, ['working'], '{"source":"startup"}')).toBe('');
  });

  it('clear: startup and clear drop all but constraints; compact and resume never do', async () => {
    await seedSet();
    cli(repo, ['working', 'new-session', 'clear']);

    for (const source of ['compact', 'resume']) {
      const out = cli(repo, ['working'], JSON.stringify({ source }));
      expect(out).toContain('- T1 [3] stripe webhook');
    }
    // Empty and invalid input: just print.
    expect(cli(repo, ['working'], '')).toContain('- T1 [3] stripe webhook');
    expect(cli(repo, ['working'], '{oops')).toContain('- T1 [3] stripe webhook');

    const out = cli(repo, ['working'], JSON.stringify({ source: 'startup' }));
    expect(out).toContain('- C1 [5] "never tag or publish"');
    expect(out).not.toContain('stripe webhook');
    expect((await readLog(planRoot, 'today')).join('\n')).toContain('drop T1 — new session');

    await setItems(planRoot, [{ type: 'T', text: 'after the clear' }]);
    const cleared = cli(repo, ['working'], JSON.stringify({ source: 'clear' }));
    expect(cleared).not.toContain('after the clear');
    expect(cleared).toContain('never tag or publish');
  });

  it('keep (the default) never clears, whatever the source', async () => {
    await seedSet();
    const out = cli(repo, ['working'], JSON.stringify({ source: 'startup' }));
    expect(out).toContain('- T1 [3] stripe webhook');
  });
});

describe('constellation working on | off | new-session | config', { timeout: 30_000 }, () => {
  it('sets and prints the settings', async () => {
    expect(cli(repo, ['working', 'config'])).toContain('(no file — defaults)');

    const off = cli(repo, ['working', 'off']);
    expect(off).toContain('Working memory off');
    expect(off).toContain('.gitignore: added (check: ok)');
    expect((await readWorkingConfigAt(dir)).config.enabled).toBe(false);

    cli(repo, ['working', 'on']);
    cli(repo, ['working', 'new-session', 'clear']);
    expect((await readWorkingConfigAt(dir)).config).toEqual({ enabled: true, new_session: 'clear' });

    const config = cli(repo, ['working', 'config']);
    expect(config).toMatch(/enabled\s+true/);
    expect(config).toMatch(/new_session\s+clear/);

    expect(cliStatus(repo, ['working', 'new-session', 'sometimes'])).toBe(2);
  });

  it('install-hook takes the answers as flags, and refuses while switched off', async () => {
    const out = cli(repo, ['working', 'install-hook', '--new-session', 'clear']);
    expect(out).toContain('Working memory at');
    expect(out).toContain('SessionStart hook: installed');
    expect((await readWorkingConfigAt(dir)).config).toEqual({ enabled: true, new_session: 'clear' });

    cli(repo, ['working', 'off']);
    expect(cliStatus(repo, ['working', 'install-hook'])).toBe(2);
  });

  it('install-hook --no-working records the answer and installs nothing', async () => {
    const out = cli(repo, ['working', 'install-hook', '--no-working']);
    expect(out).toContain('Working memory off');
    expect(await readdir(dir)).toEqual(['config.json']);
    await expect(readFile(path.join(repo, '.claude', 'settings.json'), 'utf8')).rejects.toThrow();
  });
});

describe('constellation init', { timeout: 30_000 }, () => {
  let bare: string;
  beforeEach(async () => {
    bare = await realpath(await mkdtemp(path.join(tmpdir(), 'constellation-wcfg-init-')));
    git(bare, 'init', '-q', '-b', 'main');
  });
  afterEach(async () => {
    await rm(bare, { recursive: true, force: true });
  });

  it('with no TTY and no flags, sets up working memory with the defaults', async () => {
    const out = cli(bare, ['init', '--name', 'X']);
    expect(out).toContain('Working memory at');
    expect(out).toContain('(defaults: enabled, new_session)');
    expect((await readFile(path.join(bare, '.gitignore'), 'utf8')).split('\n')).toContain(
      '.constellation/',
    );
    await expect(readFile(path.join(bare, '.constellation', 'working.md'), 'utf8')).resolves.toMatch(
      /^Updated /,
    );
  });

  it('--no-working still ignores .constellation/ and creates no working.md', async () => {
    cli(bare, ['init', '--no-working']);
    expect((await readFile(path.join(bare, '.gitignore'), 'utf8')).split('\n')).toContain(
      '.constellation/',
    );
    expect(await readdir(path.join(bare, '.constellation'))).toEqual(['config.json']);
    expect((await readWorkingConfigAt(path.join(bare, '.constellation'))).config.enabled).toBe(false);
  });

  it('--new-session clear lands in config.json', async () => {
    cli(bare, ['init', '--working', '--new-session', 'clear']);
    expect((await readWorkingConfigAt(path.join(bare, '.constellation'))).config).toEqual({
      enabled: true,
      new_session: 'clear',
    });
  });
});
