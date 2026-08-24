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
    'Install (or refresh) the Constellation authoring skill into ~/.claude, ~/.codex, ~/.cursor, ~/.agents',
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
  .description('Scaffold a constellation/ folder with a starter plan.md')
  .action(async (target: string, opts: { name?: string }) => {
    const { initPlan } = await import('../core/scaffold.js');
    try {
      const { root, name: projectName } = await initPlan(target, { name: opts.name });
      console.log(pc.green('✓') + ` Created ${path.relative(process.cwd(), root)}/plan.md`);
      console.log(
        `  Project name: ${pc.bold(projectName)} ${pc.dim('— edit the name: field in plan.md to change it')}`,
      );
      console.log(
        '\nAdd cards as <type>/<HANDLE>.md (e.g. api/API-LIST-USERS.md),\nthen run `constellation lint` to validate.',
      );
    } catch (err) {
      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      process.exit(2);
    }
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
  .description('Serve a website rendering the plan, editable in place')
  .action(async (
    target: string | null | undefined,
    opts: { port: string; plan?: string; open: boolean; readonly?: boolean },
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
            })
          : await startServer({
              plans: discovered as DiscoveredPlan[],
              scanRoot: scanRoot as string,
              defaultPlan,
              port,
              readonly: opts.readonly ?? false,
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
        console.log(
          `      ${mark} ${plan.id.padEnd(18)}${plan.name.padEnd(30)}${cards}`,
        );
      }
    } else {
      line('Plan:', planLabel);
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
