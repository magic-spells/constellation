#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Command } from 'commander';
import pc from 'picocolors';
import { lintPlan } from '../core/lint.js';
import { exists, resolvePlanDir } from '../core/resolve.js';
import type { Issue } from '../core/types.js';

const program = new Command();

program
  .name('constellation')
  .description('Files-first architecture planning for AI-assisted development');

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
  .description('Scaffold a constellation/ folder with a starter plan.md')
  .action(async (target: string) => {
    const { initPlan } = await import('../core/scaffold.js');
    try {
      const root = await initPlan(target);
      console.log(pc.green('✓') + ` Created ${path.relative(process.cwd(), root)}/plan.md`);
      console.log(
        '\nAdd cards as <type>/<HANDLE>.md (e.g. api/API-LIST-USERS.md),\nthen run `constellation lint` to validate.',
      );
    } catch (err) {
      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      process.exit(2);
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
  .option('--no-open', 'do not open the browser')
  .option('--readonly', 'disable editing from the browser')
  .description('Serve a website rendering the plan, editable in place')
  .action(async (
    target: string | null | undefined,
    opts: { port: string; open: boolean; readonly?: boolean },
  ) => {
    const root = await resolvePlanDir(target ?? undefined);
    if (!root) {
      console.error(pc.red('No constellation/ folder found.'));
      process.exit(2);
    }
    const { startServer } = await import('../serve/server.js');
    let running: Awaited<ReturnType<typeof startServer>>;
    try {
      running = await startServer({
        planRoot: root,
        port: Number(opts.port),
        readonly: opts.readonly ?? false,
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'EADDRINUSE') {
        console.error(
          pc.red(`Port ${opts.port} is already in use.`) +
            ` Pick another with: constellation serve -p <port>`,
        );
      } else {
        console.error(pc.red(err instanceof Error ? err.message : String(err)));
      }
      process.exit(2);
    }
    const url = `http://localhost:${running.port}`;
    console.log(`${pc.green('✓')} Constellation viewer at ${pc.underline(url)}`);
    console.log(pc.dim(`  plan: ${root}`));
    if (opts.open) {
      const { spawn } = await import('node:child_process');
      const cmd =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      spawn(cmd, [url], { stdio: 'ignore', detached: true }).unref();
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(pc.red(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
