#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { Command } from 'commander';
import pc from 'picocolors';
import { lintPlan } from '../core/lint.js';
import { listConnectedRepos } from '../core/repos.js';
import {
  countPlanCards,
  discoverPlans,
  exists,
  findPlanUp,
  findRepoRoot,
  identifyPlans,
  includeDiscoveredPlan,
  resolvePlanDir,
  type DiscoveredPlan,
} from '../core/resolve.js';
import type { Issue } from '../core/types.js';
import type { NewSessionMode } from '../core/working-config.js';
import type { GitignoreReport, WorkingAnchor, WorkingInitResult } from '../core/working.js';
import { notifyUpdate } from './update-check.js';

const require = createRequire(import.meta.url);
const { name, version } = require('../../package.json') as { name: string; version: string };

const program = new Command();

async function openUrl(url: string): Promise<void> {
  try {
    const { spawn } = await import('node:child_process');
    const child =
      process.platform === 'darwin'
        ? spawn('open', [url], { stdio: 'ignore', detached: true })
        : process.platform === 'win32'
          ? spawn('cmd', ['/c', 'start', '', url], {
              stdio: 'ignore',
              detached: true,
              windowsHide: true,
            })
          : spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Opening the browser is best-effort; the server URL is still printed.
  }
}

async function upgradeCli(): Promise<void> {
  const { spawn } = await import('node:child_process');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // `--prefer-online` forces a fresh registry read for the packument. Without
  // it npm may answer `@latest` from its cached copy, which is up to five
  // minutes stale — and the single most likely moment to run `upgrade` is right
  // after hearing a release exists, which is exactly inside that window. The
  // symptom is the worst kind: the command succeeds and installs the version
  // you already had.
  const child = spawn(npm, ['install', '-g', '--prefer-online', `${name}@latest`], {
    stdio: 'inherit',
  });
  const code = await new Promise<number>((resolve) => {
    child.on('error', () => resolve(1));
    child.on('close', (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) process.exit(code);
  const { offerSkillUpdateAfterUpgrade } = await import('./skills.js');
  await offerSkillUpdateAfterUpgrade();
  process.exit(0);
}

program
  .name('constellation')
  .description('Files-first architecture planning for AI-assisted development')
  .version(version);

// Update notice on every human command, but never for `mcp` (its stdout is JSON-RPC).
if (process.argv[2] !== 'mcp') notifyUpdate(name, version);

for (const command of ['version', 'v']) {
  program
    .command(command)
    .description('Print the Constellation CLI version')
    .action(() => {
      console.log(version);
    });
}

program
  .command('upgrade')
  .description('Upgrade the globally installed Constellation CLI with npm')
  .action(async () => {
    await upgradeCli();
  });

const add = program
  .command('add')
  .description('Install Constellation extras into agent config folders');

add
  .command('skills')
  .description(
    'Install (or refresh) the Constellation skills — the authoring skill and the /working command — into ~/.claude, ~/.codex, ~/.cursor, ~/.agents',
  )
  .option('--overwrite', 'replace existing installs without asking, symlinks included')
  .option(
    '--skill-root <dir...>',
    'install into these config folders instead of auto-detecting',
  )
  .action(async (opts: { overwrite?: boolean; skillRoot?: string[] }) => {
    const { addSkills } = await import('./skills.js');
    await addSkills(version, opts);
  });

program
  .command('lint')
  .argument(
    '[path]',
    'plan folder, or a directory containing constellation/ (default: walk up from cwd)',
  )
  .description('Validate the plan: handles, references, folders, schemas')
  .action(async (target: string | null | undefined) => {
    const root = await resolvePlanDir(target ?? undefined);
    if (!root) {
      console.error(
        pc.red('No constellation/ folder found.') +
          ' Run `constellation init` to create one.',
      );
      process.exit(2);
    }

    const result = await lintPlan(root);
    const byFile = new Map<string, Issue[]>();
    for (const issue of result.issues) {
      if (!byFile.has(issue.file)) byFile.set(issue.file, []);
      byFile.get(issue.file)!.push(issue);
    }

    for (const [file, issues] of byFile) {
      console.log(pc.underline(file));
      for (const issue of issues) {
        const tag =
          issue.severity === 'error'
            ? pc.red(`error ${issue.code}`)
            : pc.yellow(`warn  ${issue.code}`);
        console.log(`  ${tag}  ${issue.message}`);
      }
    }
    if (byFile.size > 0) console.log();

    const summary = [
      `${result.index.cards.size} cards`,
      `${result.index.connections.length} connections`,
      result.errors.length > 0
        ? pc.red(`${result.errors.length} errors`)
        : pc.green('0 errors'),
      result.warnings.length > 0
        ? pc.yellow(`${result.warnings.length} warnings`)
        : '0 warnings',
    ].join(', ');
    console.log(`${result.errors.length > 0 ? pc.red('✗') : pc.green('✓')} ${summary}`);

    process.exit(result.errors.length > 0 ? 1 : 0);
  });

program
  .command('init')
  .argument('[path]', 'directory to create the plan in (default: cwd)', '.')
  .option(
    '-n, --name <name>',
    'project name shown as the viewer title (default: a title-cased folder name)',
  )
  .option('--working', 'use working memory (.constellation/) on this repo (skips the question)')
  .option('--no-working', 'do not use working memory on this repo')
  .option('--new-session <mode>', 'keep | clear — clear keeps only CONSTRAINT items each new session')
  .description('Scaffold a constellation/ folder with a starter plan.md and set up working memory')
  .action(async (
    target: string,
    opts: { name?: string; working?: boolean; newSession?: string },
  ) => {
    parseNewSession(opts.newSession);
    const { initPlan } = await import('../core/scaffold.js');
    let root: string;
    try {
      const created = await initPlan(target, { name: opts.name });
      root = created.root;
      console.log(pc.green('✓') + ` Created ${path.relative(process.cwd(), root)}/plan.md`);
      console.log(
        `  Project name: ${pc.bold(created.name)} ${pc.dim('— edit the name: field in plan.md to change it')}`,
      );
    } catch (err) {
      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      process.exit(2);
    }
    // constellation/ is the tracked plan; .constellation/ is local memory, gitignored
    // here whatever the answers — init is the moment that must happen.
    try {
      const { anchorForPlan, initWorking } = await import('../core/working.js');
      const anchor = await anchorForPlan(root);
      printWorkingInit(await initWorking(anchor, await workingAnswers(anchor, opts)));
    } catch (err) {
      console.log(
        pc.yellow(`  working memory not set up: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    console.log(
      '\nAdd cards as <type>/<HANDLE>.md (e.g. api/API-LIST-USERS.md),\nthen run `constellation lint` to validate.',
    );
  });

program
  .command('rename')
  .argument('<from>', 'current handle (e.g. API-OLD-NAME)')
  .argument('<to>', 'new handle — a different prefix also moves the type folder')
  .argument(
    '[path]',
    'plan folder, or a directory containing constellation/ (default: walk up from cwd)',
  )
  .description('Rename a card and rewrite every reference to it across the plan')
  .action(async (from: string, to: string, target: string | null | undefined) => {
    const root = await resolvePlanDir(target ?? undefined);
    if (!root) {
      console.error(
        pc.red('No constellation/ folder found.') +
          ' Run `constellation init` to create one.',
      );
      process.exit(2);
    }
    const { renameCard, RenameCardError } = await import('../core/rename.js');
    try {
      const result = await renameCard(root, from, to);
      if (result.noop) {
        console.log(pc.dim(`${result.from} → ${result.to}: same handle, nothing to do.`));
        return;
      }
      console.log(
        `${pc.green('✓')} ${result.from} → ${pc.bold(result.to)}  (${result.file})`,
      );
      console.log(
        result.references_updated.length > 0
          ? `  references rewritten in: ${result.references_updated.join(', ')}`
          : pc.dim('  no other card referenced it'),
      );
      const lint = await lintPlan(root);
      if (lint.errors.length > 0) {
        console.log(
          pc.yellow(
            `  plan now has ${lint.errors.length} lint error(s) — run \`constellation lint\` for details`,
          ),
        );
      }
    } catch (err) {
      if (err instanceof RenameCardError) {
        console.error(pc.red(err.message));
        process.exit(2);
      }
      throw err;
    }
  });

// `working` is what the SessionStart hook runs, so it must be silent and exit 0
// wherever there is nothing to print — no working folder, no plan and no git to
// anchor one, or working memory switched off in .constellation/config.json. A hook
// that errors on every unrelated repo gets uninstalled.
// Working memory never reads a card: with no plan it anchors at the git root.
const WORKING_PATH_HELP =
  'plan folder, a directory containing constellation/, or any directory in a git repo (default: cwd)';

/** Resolve the working anchor or exit 2 — the settings and init commands need one. */
async function requireWorkingAnchor(target: string | null | undefined): Promise<WorkingAnchor> {
  const { resolveWorkingAnchor } = await import('../core/working.js');
  const anchor = await resolveWorkingAnchor({ start: target ?? undefined });
  if (!anchor) {
    console.error(
      pc.red('No git repo or plan here to anchor .constellation/') + ' — run `git init` first.',
    );
    process.exit(2);
  }
  return anchor;
}

function parseNewSession(value: string | undefined): NewSessionMode | undefined {
  if (value === undefined) return undefined;
  if (value === 'keep' || value === 'clear') return value;
  console.error(pc.red(`new session mode must be keep or clear, not "${value}".`));
  process.exit(2);
}

/**
 * The two working memory questions, asked once per repo: only on a TTY, only
 * when config.json does not exist yet, and only for what no flag answered.
 * Anything left unanswered falls to the defaults (on, keep).
 */
async function workingAnswers(
  anchor: WorkingAnchor,
  opts: { working?: boolean; newSession?: string },
): Promise<{ enabled?: boolean; new_session?: NewSessionMode }> {
  let enabled = opts.working;
  let mode = parseNewSession(opts.newSession);
  const { readWorkingConfig } = await import('../core/working.js');
  if (process.stdin.isTTY && !(await readWorkingConfig(anchor)).exists) {
    const { confirm } = await import('./skills.js');
    if (enabled === undefined) {
      enabled = await confirm('Use working memory on this repo? [Y/n] ', true);
    }
    if (mode === undefined && enabled !== false) {
      const clear = await confirm(
        'Clear the working memory with every new session? Constraints are kept; it resets the one list all sessions in this repo share, so it suits one session at a time. [y/N] ',
        false,
      );
      mode = clear ? 'clear' : 'keep';
    }
  }
  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(mode !== undefined ? { new_session: mode } : {}),
  };
}

function printGitignore(report: GitignoreReport): void {
  console.log(pc.dim(`  .gitignore: ${report.gitignore} (check: ${report.gitignore_check})`));
  for (const warning of report.warnings) console.log(pc.yellow(`  warning: ${warning}`));
}

function printWorkingInit(result: WorkingInitResult): void {
  if (result.config.enabled) {
    console.log(`${pc.green('✓')} Working memory at ${result.dir}`);
  } else {
    console.log(`${pc.green('✓')} Working memory off ${pc.dim(`(${result.dir}/config.json)`)}`);
  }
  for (const file of result.created) {
    console.log(pc.dim(`  created ${path.relative(process.cwd(), file)}`));
  }
  console.log(
    pc.dim(
      `  settings: enabled ${result.config.enabled}, new_session ${result.config.new_session}` +
        (result.defaults_applied ? ` (defaults: ${result.defaults_applied.join(', ')})` : ''),
    ),
  );
  if (result.config_unchanged) console.log(pc.dim(`  ${result.config_unchanged}`));
  printGitignore(result);
}

const working = program
  .command('working')
  .argument('[path]', WORKING_PATH_HELP)
  .description('Print the working memory set (.constellation/working.md)')
  .action(async (target: string | null | undefined) => {
    const {
      clearForNewSession,
      readWorkingConfig,
      readWorkingRaw,
      resolveWorkingAnchor,
      workingPreamble,
    } = await import('../core/working.js');
    const anchor = await resolveWorkingAnchor({ start: target ?? undefined }).catch(() => null);
    if (!anchor) return;
    const settings = await readWorkingConfig(anchor);
    if (!settings.config.enabled) return;
    let notice: string | null = null;
    // stdin is read only when the user chose "clear": the default path stays
    // exactly what it was, and a manual run on a TTY never waits for input.
    // Compact and resume never clear — surviving those is the point of the set.
    if (settings.config.new_session === 'clear') {
      const { readHookSource } = await import('./hook-input.js');
      const source = await readHookSource();
      if (source === 'startup' || source === 'clear') {
        await clearForNewSession(anchor).catch((err: unknown) => {
          // Another writer held the list the whole wait: say so rather than
          // leaving a stale set that looks freshly cleared.
          const code = (err as { code?: string }).code;
          if (code === 'BUSY' || code === 'CONFLICT') {
            notice = 'working memory: list busy, not cleared this session';
          }
        });
      }
    }
    const found = await readWorkingRaw(anchor).catch(() => null);
    if (!found) return;
    if (notice) console.log(notice);
    console.log(workingPreamble(found.path));
    console.log();
    console.log(found.text.trimEnd());
  });

working
  .command('install-hook')
  .argument('[path]', WORKING_PATH_HELP)
  .option('--working', 'use working memory on this repo (skips the question)')
  .option('--no-working', 'do not use working memory on this repo')
  .option('--new-session <mode>', 'keep | clear — clear keeps only CONSTRAINT items each new session')
  .description('Create .constellation/ and add the SessionStart hook to .claude/settings.json')
  .action(async (
    target: string | null | undefined,
    opts: { working?: boolean; newSession?: string },
  ) => {
    const { initWorking, readWorkingConfig } = await import('../core/working.js');
    const anchor = await requireWorkingAnchor(target);
    const settings = await readWorkingConfig(anchor);
    if (settings.exists && !settings.config.enabled) {
      console.error(
        pc.yellow('Working memory is off for this repo') +
          ` (${settings.path}). Turn it on first: constellation working on`,
      );
      process.exit(2);
    }
    const answers = await workingAnswers(anchor, opts);
    const result = await initWorking(anchor, { hook: true, ...answers });
    printWorkingInit(result);
    if (!result.config.enabled) return;
    console.log(
      result.hook === 'skipped'
        ? pc.yellow('  hook: skipped — .claude/settings.json is not readable JSON; add the hook by hand')
        : pc.dim(`  SessionStart hook: ${result.hook}`),
    );
  });

/** `working on|off|new-session`: the user changing a setting on purpose. */
async function setWorking(
  target: string | null | undefined,
  patch: { enabled?: boolean; new_session?: NewSessionMode },
): Promise<void> {
  const { readWorkingRaw, setWorkingConfig } = await import('../core/working.js');
  const anchor = await requireWorkingAnchor(target);
  const result = await setWorkingConfig(anchor, patch);
  console.log(
    `${pc.green('✓')} Working memory ${result.config.enabled ? 'on' : 'off'}, new_session ${result.config.new_session} ${pc.dim(`(${result.path})`)}`,
  );
  printGitignore(result);
  if (result.config.enabled && !(await readWorkingRaw(anchor))) {
    console.log(pc.dim('  no working.md yet — `constellation working install-hook` creates it'));
  }
}

working
  .command('on')
  .argument('[path]', WORKING_PATH_HELP)
  .description('Turn working memory on for this repo (.constellation/config.json)')
  .action(async (target: string | null | undefined) => setWorking(target, { enabled: true }));

working
  .command('off')
  .argument('[path]', WORKING_PATH_HELP)
  .description('Turn working memory off for this repo: no working_* tools, a silent hook')
  .action(async (target: string | null | undefined) => setWorking(target, { enabled: false }));

working
  .command('new-session')
  .argument(
    '<mode>',
    'keep: the set carries over · clear: a new session keeps only CONSTRAINT items (one list shared by every session in the repo, so best for one session at a time)',
  )
  .argument('[path]', WORKING_PATH_HELP)
  .description('Choose what a new session (startup or /clear) does to the working set')
  .action(async (mode: string, target: string | null | undefined) =>
    setWorking(target, { new_session: parseNewSession(mode) }),
  );

working
  .command('config')
  .argument('[path]', WORKING_PATH_HELP)
  .description('Print the effective working memory settings')
  .action(async (target: string | null | undefined) => {
    const { readWorkingConfig } = await import('../core/working.js');
    const anchor = await requireWorkingAnchor(target);
    const settings = await readWorkingConfig(anchor);
    console.log(
      `Working memory settings · ${settings.path}${settings.exists ? '' : pc.dim(' (no file — defaults)')}`,
    );
    console.log(`  enabled      ${settings.config.enabled}`);
    console.log(`  new_session  ${settings.config.new_session}`);
    for (const warning of settings.warnings) console.log(pc.yellow(`  warning: ${warning}`));
  });

program
  .command('mcp')
  .description('Run the Constellation MCP server over stdio')
  .action(async () => {
    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer();
  });

program
  .command('serve')
  .argument('[path]', 'plan folder or a directory containing constellation/')
  .option('-p, --port <port>', 'port to listen on', '4747')
  .option('--plan <id>', 'set the default plan without filtering the served set')
  .option('--no-open', 'do not open the browser')
  .option('--readonly', 'disable editing from the browser')
  .option(
    '--dev-origin <origin>',
    'view through a forwarded or proxied port (ssh -L, VS Code, the puzzle dev proxy): ' +
      'also accept that loopback Host and Origin, e.g. http://localhost:8080',
  )
  .description('Serve a website rendering the plan, editable in place')
  .action(async (
    target: string | null | undefined,
    opts: { port: string; plan?: string; open: boolean; readonly?: boolean; devOrigin?: string },
  ) => {
    const explicit = target !== null && target !== undefined;
    let root: string;
    let scanRoot: string | undefined;
    let discovered: DiscoveredPlan[] | undefined;
    let defaultPlan: string | undefined;

    if (explicit) {
      const resolved = await resolvePlanDir(target);
      if (!resolved) {
        console.error(pc.red('No constellation/ folder found.'));
        process.exit(2);
      }
      root = resolved;
      if (opts.plan && opts.plan !== 'root') {
        console.error(pc.red(`Unknown plan "${opts.plan}". Known plans: root`));
        process.exit(2);
      }
    } else {
      const cwd = process.cwd();
      const upwardPlan = await findPlanUp(cwd);
      scanRoot = (await findRepoRoot(cwd)) ?? cwd;
      discovered = await discoverPlans(scanRoot);
      if (upwardPlan) {
        discovered = await includeDiscoveredPlan(discovered, scanRoot, upwardPlan);
      }
      if (discovered.length === 0) {
        console.error(pc.red('No constellation/ folder found.'));
        process.exit(2);
      }

      const identified = identifyPlans(discovered);
      const automaticDefault =
        identified.find((plan) => path.resolve(plan.root) === path.resolve(upwardPlan ?? '')) ??
        identified.find((plan) => plan.id === 'root') ??
        identified[0];
      const selected = opts.plan
        ? identified.find(
            (plan) => plan.id === opts.plan || plan.aliases.includes(opts.plan as string),
          )
        : automaticDefault;
      if (!selected) {
        console.error(
          pc.red(
            `Unknown plan "${opts.plan}". Known plans: ${identified.map((plan) => plan.id).join(', ')}`,
          ),
        );
        process.exit(2);
      }
      defaultPlan = selected.id;
      root = selected.root;
    }
    const { startServer } = await import('../serve/server.js');
    const started = Date.now();

    // A busy port is not a failure worth stopping for — serving a second plan
    // (or restarting after a stray process kept the socket) is routine, and
    // "pick another port yourself" made the user do arithmetic the CLI can do.
    // So walk upward until one binds. The chosen port is always printed in the
    // banner below, and `taken` drives a note so a URL that is not the port you
    // asked for never looks like a typo.
    const requested = Number(opts.port);
    const MAX_PORT_TRIES = 20;
    let running: Awaited<ReturnType<typeof startServer>> | undefined;
    let port = requested;
    let taken = 0;

    while (running === undefined) {
      try {
        running = explicit
          ? await startServer({
              planRoot: root,
              port,
              readonly: opts.readonly ?? false,
              devOrigins: opts.devOrigin ? [opts.devOrigin] : undefined,
            })
          : await startServer({
              plans: discovered as DiscoveredPlan[],
              scanRoot: scanRoot as string,
              defaultPlan,
              port,
              readonly: opts.readonly ?? false,
              devOrigins: opts.devOrigin ? [opts.devOrigin] : undefined,
            });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        // EACCES shows up the same way for a privileged port (<1024) that is
        // free but not ours to bind, and walking upward from 80 to 99 would be
        // twenty useless attempts — so only EADDRINUSE advances.
        const retryable = code === 'EADDRINUSE' && taken + 1 < MAX_PORT_TRIES && port < 65535;
        if (retryable) {
          taken += 1;
          port += 1;
          continue;
        }
        if (code === 'EADDRINUSE') {
          console.error(
            pc.red(`Ports ${requested}–${port} are all in use.`) +
              ` Pick another with: constellation serve -p <port>`,
          );
        } else {
          console.error(pc.red(err instanceof Error ? err.message : String(err)));
        }
        process.exit(2);
      }
    }
    const elapsed = Date.now() - started;

    let planLabel = root;
    if (!running.multi) {
      // Card count is banner garnish — never let a broken card block serving.
      try {
        const { loadPlan } = await import('../core/indexer.js');
        const plan = await loadPlan(root);
        planLabel += pc.dim(`  (${plan.cards.size} cards)`);
      } catch {
        /* banner shows the path alone */
      }
    }

    const baseUrl = `http://localhost:${running.port}/`;
    const url = running.multi
      ? `${baseUrl}#/p/${running.defaultPlan}/`
      : baseUrl;
    const line = (label: string, value: string) =>
      console.log(`  ${pc.green('➜')}  ${pc.bold(label.padEnd(8))}${value}`);
    console.log();
    console.log(
      `  ${pc.bold(pc.cyan('✦ Constellation'))} ${pc.dim(`v${version}`)}  ready in ${pc.bold(`${elapsed}ms`)}`,
    );
    console.log();
    line('Local:', pc.cyan(url));
    if (taken > 0) {
      line(
        'Port:',
        pc.dim(
          `${requested} was in use, using ${running.port}` +
            (taken > 1 ? ` (tried ${taken + 1})` : ''),
        ),
      );
    }
    if (running.multi) {
      line('Plans:', '');
      console.log(
        `      ${pc.dim('  ')}${pc.bold('id'.padEnd(18))}${pc.bold('name'.padEnd(30))}${pc.bold('cards')}`,
      );
      for (const plan of running.plans) {
        let cards = 0;
        try {
          cards = await countPlanCards(plan.root);
        } catch {
          /* a watcher or concurrent edit can make banner garnish unavailable */
        }
        const mark = plan.id === running.defaultPlan ? '•' : ' ';
        const from = plan.repo.kind === 'connected' ? pc.dim(`  ↳ ${plan.repo.path}`) : '';
        console.log(
          `      ${mark} ${plan.id.padEnd(18)}${plan.name.padEnd(30)}${String(cards).padEnd(6)}${from}`,
        );
      }
    } else {
      line('Plan:', planLabel);
    }
    // Declared connected repos that could not be served stay visible here and
    // as disabled rows in the viewer's workspace switcher.
    for (const down of running.unavailable) {
      line('Skip:', pc.yellow(down.repo.name) + pc.dim(`  ${down.reason}`));
    }
    if (opts.readonly) line('Mode:', pc.dim('read-only (browser edits disabled)'));

    // "press q to quit": raw-mode stdin so a single keypress ends the server,
    // only when stdin is a real TTY (pipes/CI keep plain Ctrl+C semantics).
    // Raw mode swallows Ctrl+C's SIGINT, so 0x03 is handled explicitly.
    const tty = process.stdin.isTTY === true && typeof process.stdin.setRawMode === 'function';
    if (tty) {
      console.log(`\n  ${pc.dim('press q to quit')}`);
    }
    console.log();

    if (tty) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', (chunk: Buffer) => {
        const key = chunk.toString();
        if (key === 'q' || key === 'Q' || key === '\u0003') {
          // Raw mode echoes nothing, so no leading newline is needed.
          console.log(pc.dim('  shutting down…'));
          process.stdin.setRawMode(false);
          process.stdin.pause();
          void running.close().then(
            () => process.exit(0),
            () => process.exit(0),
          );
        }
      });
    }

    if (opts.open) {
      await openUrl(url);
    }
  });

program
  .command('repos')
  .argument(
    '[path]',
    'plan folder, or a directory containing constellation/ (default: walk up from cwd)',
  )
  .description('List the sibling repos declared in connected_repos')
  .action(async (target: string | null | undefined) => {
    const root = await resolvePlanDir(target ?? undefined);
    if (!root) {
      console.error(
        pc.red('No constellation/ folder found.') +
          ' Run `constellation init` to create one.',
      );
      process.exit(2);
    }
    const repos = await listConnectedRepos(root);
    if (repos.length === 0) {
      console.log(pc.dim('No connected repos declared in plan.md (connected_repos).'));
      return;
    }
    for (const r of repos) {
      const status = r.reachable
        ? pc.green('✓ reachable')
        : pc.yellow('• not found here');
      console.log(`${pc.bold(r.name)}  ${pc.dim(r.path)}  ${status}`);
      if (r.description) console.log(`  ${r.description}`);
    }
    console.log();
    console.log(
      pc.dim(
        `${repos.length} connected repo${repos.length === 1 ? '' : 's'}. ` +
          'Paths are relative to this repo; "not found here" just means a different local layout.',
      ),
    );
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(pc.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
