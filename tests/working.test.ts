import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendLog,
  dropItems,
  ensureGitignore,
  initWorking,
  installHook,
  parseWorking,
  localDay,
  readLog,
  readWorking,
  resolveWorkingAnchor,
  resolveWorkingDir,
  setItems,
  WorkingError,
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

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** A repo with a minimal plan and a commit — enough for branch/head in the header. */
async function makeRepo(): Promise<void> {
  repo = await mkdtemp(path.join(tmpdir(), 'constellation-working-'));
  planRoot = path.join(repo, 'constellation');
  await mkdir(planRoot, { recursive: true });
  await writeFile(path.join(planRoot, 'plan.md'), '---\nname: Working Fixture\n---\n\nBody.\n');
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'initial');
}

beforeEach(makeRepo);
afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

const EXAMPLE = `Updated 2026-09-17 06:56 · branch \`release/0.1.0\` @ 62da1b5 · next G3 C11 P4 F2 T15 Q8 I9 D12

## GOAL
- G1 [5] Finish Phase 6 so the platform can replace Clerk → [[FEATURE-PHASE-6-COMMERCE]]
## CONSTRAINT
- C3 [5] "Fable tokens use a lot of my limits" — Fable agents only for narrow core-auth passes
## PLAN
- P1 [4] ✓ orgs ✓ webhook → gate walk → deploy
## FOCUS
- F1 [5] Waiting on the Codex webhook re-review
## TASK
- T12 [4] Stripe webhook — \`../account-wt/stripe-webhook\` \`feat/stripe-webhook\` 148846a; agent a2c18f… → merge
## QUESTION
- Q2 [3] Cory: Stripe test keys + mapped prices
## IDEA
- I4 [2] No consumer for the account.anonymize job
## DECISION
- D6 [3] Personal orgs sealed — simpler, reversible
`;

describe('parse', () => {
  it('reads the header, the counters and one item per line', () => {
    const doc = parseWorking(EXAMPLE);
    expect(doc.header.branch).toBe('release/0.1.0');
    expect(doc.header.head).toBe('62da1b5');
    expect(doc.header.updated).toBe('2026-09-17 06:56');
    expect(doc.header.next).toEqual({ G: 3, C: 11, P: 4, F: 2, T: 15, Q: 8, I: 9, D: 12 });
    expect(doc.sections.map((s) => s.type)).toEqual(['G', 'C', 'P', 'F', 'T', 'Q', 'I', 'D']);
  });

  it('counts a hand-written line with no importance bracket as an item', () => {
    const doc = parseWorking('Updated x · next G1 C1 P1 F1 T1 Q1 I1 D1\n\n## TASK\n- T9 hand-edited\n');
    // Visible to the id guard, so the next task cannot reuse T9.
    expect(doc.header.next.T).toBe(10);
  });

  it('clamps an out-of-range importance rather than writing it back', () => {
    const doc = parseWorking(
      'Updated x · next G1 C1 P1 F1 T1 Q1 I1 D1\n\n## TASK\n- T1 [0] low\n- T2 [12] high\n',
    );
    const items = doc.sections.flatMap((sec) => sec.lines.flatMap((l) => (l.item ? [l.item] : [])));
    expect(items.map((i) => i.importance)).toEqual([1, 5]);
  });

  it('never hands out an id the file already uses, whatever the header claims', () => {
    const doc = parseWorking(
      'Updated x · next G1 C1 P1 F1 T1 Q1 I1 D1\n\n## TASK\n- T9 [3] hand-edited\n',
    );
    expect(doc.header.next.T).toBe(10);
  });
});

describe('working.md writes', () => {
  it('round-trips the example file byte-for-byte apart from the header', async () => {
    const dir = await resolveWorkingDir(planRoot);
    await initWorking(planRoot);
    const file = path.join(dir, 'working.md');
    await writeFile(file, EXAMPLE, 'utf8');

    await setItems(planRoot, [{ id: 'Q2', importance: 4 }]);
    const after = await readFile(file, 'utf8');

    const before = EXAMPLE.split('\n');
    const now = after.split('\n');
    // Every line but the header and the one item touched is unchanged.
    expect(now.length).toBe(before.length);
    for (let i = 1; i < before.length; i++) {
      if (before[i].startsWith('- Q2')) continue;
      expect(now[i]).toBe(before[i]);
    }
    expect(now[0]).not.toBe(before[0]);
    expect(now.find((l) => l.startsWith('- Q2'))).toBe(
      '- Q2 [4] Cory: Stripe test keys + mapped prices',
    );
  });

  it('rewrites the header — updated, branch, head — on every write', async () => {
    await initWorking(planRoot);
    const result = await setItems(planRoot, [{ type: 'G', text: 'Ship it' }]);
    expect(result.header.branch).toBe('main');
    expect(result.header.head).toMatch(/^[0-9a-f]{7}$/);
    expect(result.header.updated).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  });

  it('allocates ids per type and never reuses one after a drop', async () => {
    await initWorking(planRoot);
    const first = await setItems(planRoot, [
      { type: 'G', text: 'goal' },
      { type: 'T', text: 'task one' },
      { type: 'T', text: 'task two' },
    ]);
    expect(first.ids).toEqual(['G1', 'T1', 'T2']);
    expect(first.header.next).toMatchObject({ G: 2, T: 3 });

    await dropItems(planRoot, ['T1', 'T2']);
    const second = await setItems(planRoot, [{ type: 'T', text: 'task three' }]);
    expect(second.ids).toEqual(['T3']);
  });

  it('refuses to change an item\'s type', async () => {
    await initWorking(planRoot);
    await setItems(planRoot, [{ type: 'T', text: 'task' }]);
    await expect(setItems(planRoot, [{ id: 'T1', type: 'G', text: 'task' }])).rejects.toMatchObject(
      { code: 'TYPE_IMMUTABLE' },
    );
  });

  it('supersedes FOCUS instead of appending, and logs the supersede', async () => {
    await initWorking(planRoot);
    await setItems(planRoot, [{ type: 'F', text: 'first step' }]);
    const second = await setItems(planRoot, [{ type: 'F', text: 'second step' }]);
    expect(second.superseded).toEqual(['F1']);

    const set = await readWorking(planRoot);
    expect(set.items.filter((i) => i.type === 'F').map((i) => i.id)).toEqual(['F2']);
    expect(await readLog(planRoot, 'today')).toContainEqual(
      expect.stringContaining('supersede F1 → F2'),
    );
  });

  it('mixes create and update in one batch', async () => {
    await initWorking(planRoot);
    await setItems(planRoot, [{ type: 'T', text: 'old' }]);
    const result = await setItems(planRoot, [
      { id: 'T1', text: 'updated' },
      { type: 'D', importance: 2, text: 'chose A over B' },
    ]);
    expect(result.ids).toEqual(['T1', 'D1']);
    const items = (await readWorking(planRoot)).items;
    expect(items.find((i) => i.id === 'T1')!.text).toBe('updated');
    expect(items.find((i) => i.id === 'D1')!.importance).toBe(2);
  });

  it('rejects newlines in item text', async () => {
    await initWorking(planRoot);
    await expect(
      setItems(planRoot, [{ type: 'T', text: 'line one\nline two' }]),
    ).rejects.toMatchObject({ code: 'BAD_TEXT' });
  });

  it('warns about a long line and about a crowded set, and writes anyway', async () => {
    await initWorking(planRoot);
    const long = await setItems(planRoot, [{ type: 'T', text: 'x'.repeat(200) }]);
    expect(long.warnings).toContain('long: T1');
    expect((await readWorking(planRoot)).items).toHaveLength(1);

    const many = await setItems(
      planRoot,
      Array.from({ length: 25 }, (_, i) => ({ type: 'I' as const, text: `idea ${i}` })),
    );
    expect(many.warnings.some((w) => w.startsWith('crowded: 26 items'))).toBe(true);
  });

  it('reports unknown ids rather than silently dropping nothing', async () => {
    await initWorking(planRoot);
    await expect(dropItems(planRoot, ['T99'], 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(dropItems(planRoot, ['nope'])).rejects.toMatchObject({ code: 'BAD_ID' });
  });

  it('logs one line for a multi-id drop with a reason', async () => {
    await initWorking(planRoot);
    await setItems(planRoot, [
      { type: 'T', text: 'a' },
      { type: 'T', text: 'b' },
    ]);
    const result = await dropItems(planRoot, ['T1', 'T2'], 'merged 148846a');
    expect(result.dropped).toEqual(['T1', 'T2']);
    expect(result.logged).toBe(true);
    const lines = await readLog(planRoot, 'today');
    expect(lines.filter((l) => l.includes('drop'))).toEqual([
      expect.stringMatching(/^- \d\d:\d\d drop T1, T2 — merged 148846a$/),
    ]);
  });

  it('picks up a bracket-less item, drops it, and gives a rewritten one a [3]', async () => {
    await initWorking(planRoot);
    const file = path.join(await resolveWorkingDir(planRoot), 'working.md');
    await writeFile(
      file,
      'Updated 2026-01-01 00:00 · next G1 C1 P1 F1 T1 Q1 I1 D1\n\n## TASK\n- T9 hand-edited\n- T10 also hand-edited\n',
      'utf8',
    );
    const set = await readWorking(planRoot);
    expect(set.items.map((i) => [i.id, i.importance, i.text])).toEqual([
      ['T9', 3, 'hand-edited'],
      ['T10', 3, 'also hand-edited'],
    ]);

    await setItems(planRoot, [{ id: 'T9', text: 'now tool-written' }]);
    const raw = await readFile(file, 'utf8');
    expect(raw).toContain('- T9 [3] now tool-written');
    // The line nobody touched keeps its exact bytes.
    expect(raw).toContain('- T10 also hand-edited');

    const dropped = await dropItems(planRoot, ['T10']);
    expect(dropped.dropped).toEqual(['T10']);
    expect(await readFile(file, 'utf8')).not.toContain('also hand-edited');
  });

  it('keeps a section whose last item goes but whose prose stays', async () => {
    await initWorking(planRoot);
    const file = path.join(await resolveWorkingDir(planRoot), 'working.md');
    await writeFile(
      file,
      'Updated 2026-01-01 00:00 · next G1 C1 P1 F1 T1 Q1 I1 D1\n\n## TASK\n<!-- keep me -->\n- T1 [3] only item\n',
      'utf8',
    );
    await dropItems(planRoot, ['T1']);
    const raw = await readFile(file, 'utf8');
    expect(raw).toContain('## TASK');
    expect(raw).toContain('<!-- keep me -->');
    expect(raw).not.toContain('only item');
  });

  it('empties out to a header-only file when the last item goes', async () => {
    await initWorking(planRoot);
    await setItems(planRoot, [{ type: 'T', text: 'only' }]);
    await dropItems(planRoot, ['T1']);
    const raw = await readFile(path.join(await resolveWorkingDir(planRoot), 'working.md'), 'utf8');
    expect(raw).not.toContain('## TASK');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('two overlapping batches both land', async () => {
    await initWorking(planRoot);
    await Promise.all([
      setItems(planRoot, [{ type: 'T', text: 'from A' }]),
      setItems(planRoot, [{ type: 'T', text: 'from B' }]),
    ]);
    const items = (await readWorking(planRoot)).items;
    expect(items.map((i) => i.text).sort()).toEqual(['from A', 'from B']);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });
});

describe('the log', () => {
  it('a numeric tail spans day files, oldest first', async () => {
    const { logDir } = await (async () => {
      await initWorking(planRoot);
      return { logDir: path.join(await resolveWorkingDir(planRoot), 'log') };
    })();
    await writeFile(path.join(logDir, '2026-01-01.md'), '- 09:00 day one a\n- 09:01 day one b\n');
    await writeFile(path.join(logDir, '2026-01-02.md'), '- 10:00 day two a\n');
    await appendLog(planRoot, 'today');

    const all = await readLog(planRoot, 10);
    expect(all.slice(0, 3)).toEqual([
      '- 09:00 day one a',
      '- 09:01 day one b',
      '- 10:00 day two a',
    ]);
    expect(all[all.length - 1]).toContain('today');

    expect(await readLog(planRoot, 2)).toEqual([
      '- 10:00 day two a',
      expect.stringContaining('today'),
    ]);
    // "today" is only today's file, whatever else is on disk.
    const todayOnly = await readLog(planRoot, 'today');
    expect(todayOnly).toHaveLength(1);
    expect(todayOnly[0]).toContain('today');
    expect(localDay()).toMatch(/^\d{4}-\d\d-\d\d$/);
  });
});

describe('no folder', () => {
  it('reads as exists: false and refuses to write', async () => {
    const set = await readWorking(planRoot);
    expect(set.exists).toBe(false);
    expect(set.items).toEqual([]);
    await expect(setItems(planRoot, [{ type: 'T', text: 'x' }])).rejects.toMatchObject({
      code: 'NO_WORKING_FOLDER',
    });
    await expect(appendLog(planRoot, 'x')).rejects.toBeInstanceOf(WorkingError);
  });
});

describe('init', () => {
  it('creates the folder, the rules, an empty set and the ignore lines — once', async () => {
    const first = await initWorking(planRoot);
    expect(first.gitignore).toBe('added');
    expect(first.created.map((f) => path.basename(f)).sort()).toEqual([
      'CLAUDE.md',
      'working.md',
    ]);
    const ignore = await readFile(path.join(repo, '.gitignore'), 'utf8');
    expect(ignore).toContain('.constellation/*');
    expect(ignore).toContain('!.constellation/CLAUDE.md');

    const second = await initWorking(planRoot);
    expect(second.created).toEqual([]);
    expect(second.gitignore).toBe('present');
    const again = await readFile(path.join(repo, '.gitignore'), 'utf8');
    expect(again).toBe(ignore);
  });

  it('merges the SessionStart hook without disturbing other settings, idempotently', async () => {
    const settingsDir = path.join(repo, '.claude');
    await mkdir(settingsDir, { recursive: true });
    await writeFile(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify(
        {
          permissions: { allow: ['Bash(npm test)'] },
          hooks: {
            Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }],
            SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] }],
          },
        },
        null,
        2,
      ),
    );

    expect(await installHook(repo)).toBe('installed');
    const raw = JSON.parse(await readFile(path.join(settingsDir, 'settings.json'), 'utf8'));
    expect(raw.permissions).toEqual({ allow: ['Bash(npm test)'] });
    expect(raw.hooks.Stop).toHaveLength(1);
    expect(raw.hooks.SessionStart).toHaveLength(2);
    expect(raw.hooks.SessionStart[0].hooks[0].command).toBe('echo hi');
    expect(raw.hooks.SessionStart[1]).toEqual({
      matcher: 'startup|resume|compact|clear',
      hooks: [{ type: 'command', command: 'npx --no-install constellation working 2>/dev/null || true' }],
    });

    expect(await installHook(repo)).toBe('present');
    const after = JSON.parse(await readFile(path.join(settingsDir, 'settings.json'), 'utf8'));
    expect(after).toEqual(raw);
  });

  it('leaves an unparseable settings.json exactly as it found it', async () => {
    const file = path.join(repo, '.claude', 'settings.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{ this is not json ', 'utf8');
    expect(await installHook(repo)).toBe('skipped');
    expect(await readFile(file, 'utf8')).toBe('{ this is not json ');
  });

  it('appends to a non-empty .gitignore and fills in a half-present pair', async () => {
    const file = path.join(repo, '.gitignore');
    await writeFile(file, 'node_modules\n.env\n', 'utf8');
    expect(await ensureGitignore(repo)).toBe('added');
    let raw = await readFile(file, 'utf8');
    expect(raw.startsWith('node_modules\n.env\n')).toBe(true);
    expect(raw).toContain('.constellation/*');
    expect(raw).toContain('!.constellation/CLAUDE.md');
    expect(await ensureGitignore(repo)).toBe('present');

    // Only one of the pair present: the other is added, the first is not duplicated.
    await writeFile(file, 'dist\n.constellation/*\n', 'utf8');
    expect(await ensureGitignore(repo)).toBe('added');
    raw = await readFile(file, 'utf8');
    expect(raw.match(/^\.constellation\/\*$/gm)).toHaveLength(1);
    expect(raw).toContain('!.constellation/CLAUDE.md');
  });

  it('creates settings.json when there is none', async () => {
    expect(await installHook(repo)).toBe('installed');
    const raw = JSON.parse(await readFile(path.join(repo, '.claude', 'settings.json'), 'utf8'));
    expect(raw.hooks.SessionStart[0].hooks[0].command).toBe(
      'npx --no-install constellation working 2>/dev/null || true',
    );
  });
});

describe('worktrees', () => {
  it('resolve to the main checkout, so there is one scratchpad per plan', async () => {
    await initWorking(planRoot);
    await setItems(planRoot, [{ type: 'T', text: 'in flight' }]);

    const wt = path.join(path.dirname(repo), `${path.basename(repo)}-wt`);
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/x', wt);
    try {
      const wtPlan = path.join(wt, 'constellation');
      const set = await readWorking(wtPlan);
      expect(set.exists).toBe(true);
      expect(set.items.map((i) => i.text)).toEqual(['in flight']);

      // The scratchpad is shared, but the two TRACKED files belong to this checkout.
      const fromWorktree = await initWorking(wtPlan, { hook: true });
      // realpath: on macOS /var is a symlink to /private/var, and the worktree
      // route resolves through git, which answers in real paths.
      expect(await realpath(fromWorktree.dir)).toBe(
        await realpath(await resolveWorkingDir(planRoot)),
      );
      await expect(readFile(path.join(wt, '.gitignore'), 'utf8')).resolves.toContain(
        '.constellation/*',
      );
      await expect(
        readFile(path.join(wt, '.claude', 'settings.json'), 'utf8'),
      ).resolves.toContain('constellation working');
      await expect(
        readFile(path.join(repo, '.claude', 'settings.json'), 'utf8'),
      ).rejects.toThrow();

      await appendLog(wtPlan, 'agent finished');
      expect(await readLog(planRoot, 'today')).toContainEqual(
        expect.stringContaining('agent finished'),
      );
    } finally {
      git(repo, 'worktree', 'remove', '--force', wt);
      await rm(wt, { recursive: true, force: true });
    }
  });
});

describe('monorepos', () => {
  it('puts the scratchpad and .gitignore at the code root, the hook at the repo root', async () => {
    const pkg = path.join(repo, 'packages', 'foo');
    const pkgPlan = path.join(pkg, 'constellation');
    await mkdir(pkgPlan, { recursive: true });
    await writeFile(path.join(pkgPlan, 'plan.md'), '---\nname: Foo\n---\n\nBody.\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'package plan');

    const result = await initWorking(pkgPlan, { hook: true });
    expect(result.dir).toBe(path.join(pkg, '.constellation'));
    expect(result.hook).toBe('installed');
    // .gitignore ignores a sibling of the plan, so it lives with the plan…
    await expect(readFile(path.join(pkg, '.gitignore'), 'utf8')).resolves.toContain(
      '.constellation/*',
    );
    await expect(readFile(path.join(repo, '.gitignore'), 'utf8')).rejects.toThrow();
    // …while Claude Code reads settings at the repo root.
    await expect(
      readFile(path.join(repo, '.claude', 'settings.json'), 'utf8'),
    ).resolves.toContain('constellation working');
    await expect(
      readFile(path.join(pkg, '.claude', 'settings.json'), 'utf8'),
    ).rejects.toThrow();

    await setItems(pkgPlan, [{ type: 'T', text: 'package work' }]);
    expect((await readWorking(pkgPlan)).items).toHaveLength(1);
    // The repo-root plan, if there were one, would have its own folder.
    expect(await resolveWorkingDir(planRoot)).toBe(path.join(repo, '.constellation'));
  });
});

describe('constellation working (the hook command)', () => {
  it('prints the set with its preamble', async () => {
    await initWorking(planRoot);
    await setItems(planRoot, [{ type: 'T', text: 'in flight' }]);
    const out = execFileSync(tsxBin, [cliPath, 'working'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
    });
    expect(out).toContain('Working memory · ');
    expect(out).toContain('verify against git/worktrees before acting');
    expect(out).toContain('- T1 [3] in flight');
  });

  it('prints nothing and exits 0 when there is no working folder', async () => {
    const out = execFileSync(tsxBin, [cliPath, 'working'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
    });
    expect(out.trim()).toBe('');
  });
});

/* ── no plan: working memory anchors at the git root ─────────────────────── */

function cli(cwd: string, ...args: string[]): string {
  return execFileSync(tsxBin, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, NO_UPDATE_NOTIFIER: '1' },
  });
}

describe('without a plan', () => {
  let bare: string;

  beforeEach(async () => {
    bare = await realpath(await mkdtemp(path.join(tmpdir(), 'constellation-noplan-')));
    await writeFile(path.join(bare, 'index.html'), '<p>site</p>\n');
    git(bare, 'init', '-b', 'main');
    git(bare, 'config', 'user.email', 'test@example.com');
    git(bare, 'config', 'user.name', 'Test');
    git(bare, 'add', '-A');
    git(bare, 'commit', '-q', '-m', 'initial');
  });
  afterEach(async () => {
    await rm(bare, { recursive: true, force: true });
  });

  it('inits, sets, lists, logs and prints at the git root', async () => {
    const sub = path.join(bare, 'assets', 'css');
    await mkdir(sub, { recursive: true });
    const anchor = await resolveWorkingAnchor({ start: sub });
    expect(anchor).not.toBeNull();
    expect(anchor!.plan).toBeNull();
    expect(anchor!.dir).toBe(path.join(bare, '.constellation'));

    const init = await initWorking(anchor!);
    expect(init.dir).toBe(path.join(bare, '.constellation'));
    expect(init.gitignore).toBe('added');
    await expect(readFile(path.join(bare, '.gitignore'), 'utf8')).resolves.toContain(
      '.constellation/*',
    );
    // No plan folder was invented along the way.
    await expect(readFile(path.join(bare, 'constellation', 'plan.md'), 'utf8')).rejects.toThrow();

    const set = await setItems(anchor!, [{ type: 'T', text: 'site work' }]);
    expect(set.ids).toEqual(['T1']);
    expect(set.header.branch).toBe('main');
    expect((await readWorking(anchor!)).items.map((i) => i.text)).toEqual(['site work']);

    await appendLog(anchor!, 'agent finished');
    expect(await readLog(anchor!, 'today')).toContainEqual(
      expect.stringContaining('agent finished'),
    );

    // The hook command prints it from anywhere in the repo.
    expect(cli(sub, 'working')).toContain('- T1 [3] site work');
  });

  it('install-hook works in a repo with no plan', async () => {
    expect(cli(bare, 'working', 'install-hook')).toContain('Working memory at');
    await expect(
      readFile(path.join(bare, '.claude', 'settings.json'), 'utf8'),
    ).resolves.toContain('constellation working');
    await expect(
      readFile(path.join(bare, '.constellation', 'working.md'), 'utf8'),
    ).resolves.toMatch(/^Updated /);
  });

  it('shares the main checkout folder from a linked worktree', async () => {
    const main = (await resolveWorkingAnchor({ start: bare }))!;
    await initWorking(main);
    await setItems(main, [{ type: 'T', text: 'in flight' }]);

    const wt = `${bare}-wt`;
    git(bare, 'worktree', 'add', '-q', '-b', 'feat/x', wt);
    try {
      const fromWt = (await resolveWorkingAnchor({ start: wt }))!;
      expect(await realpath(fromWt.dir)).toBe(await realpath(main.dir));
      expect((await readWorking(fromWt)).items.map((i) => i.text)).toEqual(['in flight']);

      // Tracked files belong to the checkout the call came from.
      await initWorking(fromWt, { hook: true });
      await expect(readFile(path.join(wt, '.gitignore'), 'utf8')).resolves.toContain(
        '.constellation/*',
      );
      await expect(
        readFile(path.join(wt, '.claude', 'settings.json'), 'utf8'),
      ).resolves.toContain('constellation working');
      await expect(
        readFile(path.join(bare, '.claude', 'settings.json'), 'utf8'),
      ).rejects.toThrow();

      await appendLog(fromWt, 'wt agent done');
      expect(await readLog(main, 'today')).toContainEqual(
        expect.stringContaining('wt agent done'),
      );
      expect(cli(wt, 'working')).toContain('- T1 [3] in flight');
    } finally {
      git(bare, 'worktree', 'remove', '--force', wt);
      await rm(wt, { recursive: true, force: true });
    }
  });

  it('prints nothing and exits 0 with no plan and no folder', () => {
    expect(cli(bare, 'working')).toBe('');
  });
});

describe('plans still resolve exactly as before', () => {
  it('a subfolder plan anchors at its code root from anywhere inside it', async () => {
    // The resolver realpaths its start (macOS /var → /private/var); compare in one spelling.
    const real = await realpath(repo);
    const planRoot = path.join(real, 'constellation');
    const pkg = path.join(real, 'packages', 'foo');
    const pkgPlan = path.join(pkg, 'constellation');
    await mkdir(path.join(pkg, 'src'), { recursive: true });
    await mkdir(pkgPlan, { recursive: true });
    await writeFile(path.join(pkgPlan, 'plan.md'), '---\nname: Foo\n---\n\nBody.\n');

    const expected = await resolveWorkingDir(pkgPlan);
    expect(expected).toBe(path.join(pkg, '.constellation'));
    for (const start of [pkg, path.join(pkg, 'src'), pkgPlan]) {
      const anchor = (await resolveWorkingAnchor({ start }))!;
      expect(anchor.plan).toBe(pkgPlan);
      expect(anchor.dir).toBe(expected);
    }
    // The repo root still finds its own plan, not the package's.
    const rootAnchor = (await resolveWorkingAnchor({ start: real }))!;
    expect(rootAnchor.plan).toBe(planRoot);
    expect(rootAnchor.dir).toBe(await resolveWorkingDir(planRoot));
  });

  it('an explicit plan wins over the start directory', async () => {
    const anchor = (await resolveWorkingAnchor({ plan: planRoot, start: tmpdir() }))!;
    expect(anchor.plan).toBe(planRoot);
    expect(anchor.dir).toBe(await resolveWorkingDir(planRoot));
  });
});

describe('outside git with no plan', () => {
  let loose: string;
  beforeEach(async () => {
    loose = await mkdtemp(path.join(tmpdir(), 'constellation-loose-'));
  });
  afterEach(async () => {
    await rm(loose, { recursive: true, force: true });
  });

  function installHookFails(cwd: string): { status: number; stderr: string } {
    try {
      cli(cwd, 'working', 'install-hook');
    } catch (err) {
      const e = err as { status: number; stderr: string };
      return { status: e.status, stderr: e.stderr };
    }
    return { status: 0, stderr: '' };
  }

  it('has no anchor, so reads are quiet and init is refused', async () => {
    expect(await resolveWorkingAnchor({ start: loose })).toBeNull();
    expect(cli(loose, 'working')).toBe('');

    const { status, stderr } = installHookFails(loose);
    expect(status).toBe(2);
    expect(stderr).toContain('No git repo or plan here to anchor .constellation/');
    await expect(
      readFile(path.join(loose, '.constellation', 'working.md'), 'utf8'),
    ).rejects.toThrow();
  });

  it('never climbs to an ancestor plan outside git', async () => {
    // loose/constellation is a real plan; loose/site and loose/site/deep are not in git.
    await mkdir(path.join(loose, 'constellation'), { recursive: true });
    await writeFile(path.join(loose, 'constellation', 'plan.md'), '---\nname: Other\n---\n');
    const site = path.join(loose, 'site');
    const deep = path.join(site, 'deep');
    await mkdir(deep, { recursive: true });

    expect(await resolveWorkingAnchor({ start: site })).toBeNull();
    expect(await resolveWorkingAnchor({ start: deep })).toBeNull();
    expect(cli(deep, 'working')).toBe('');
    expect(installHookFails(site).status).toBe(2);
    expect(installHookFails(deep).status).toBe(2);
    // Nothing was written anywhere up the tree.
    for (const p of [
      path.join(loose, '.constellation'),
      path.join(loose, '.gitignore'),
      path.join(loose, '.claude'),
      path.join(site, '.constellation'),
      path.join(site, '.gitignore'),
      path.join(site, '.claude'),
      path.join(deep, '.constellation'),
    ]) {
      await expect(readFile(p, 'utf8')).rejects.toThrow();
    }
  });

  it('accepts only a directory holding plan.md as a plan', async () => {
    const notAPlan = path.join(loose, 'a');
    await mkdir(path.join(notAPlan, 'constellation'), { recursive: true });
    expect(await resolveWorkingAnchor({ start: notAPlan })).toBeNull();
    const fileNamed = path.join(loose, 'b');
    await mkdir(fileNamed);
    await writeFile(path.join(fileNamed, 'constellation'), 'not a folder\n');
    expect(await resolveWorkingAnchor({ start: fileNamed })).toBeNull();

    // An exact plan at the start directory still works without git.
    const real = await realpath(loose);
    await mkdir(path.join(real, 'c', 'constellation'), { recursive: true });
    await writeFile(path.join(real, 'c', 'constellation', 'plan.md'), '---\nname: C\n---\n');
    const anchor = (await resolveWorkingAnchor({ start: path.join(real, 'c') }))!;
    expect(anchor.plan).toBe(path.join(real, 'c', 'constellation'));
    expect(anchor.dir).toBe(path.join(real, 'c', '.constellation'));
  });

  it('resolves a symlinked start to one spelling', async () => {
    const target = await realpath(await mkdtemp(path.join(tmpdir(), 'constellation-linked-')));
    try {
      git(target, 'init', '-q', '-b', 'main');
      const link = path.join(loose, 'link');
      await symlink(target, link);
      const anchor = (await resolveWorkingAnchor({ start: link }))!;
      expect(anchor.dir).toBe(path.join(target, '.constellation'));
      expect(anchor.gitRoot).toBe(target);
      expect(anchor.codeRoot).toBe(target);
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });
});
