import { cp, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';

// The skill payload ships inside the npm package: from dist/cli/skills.js (or
// src/cli/skills.ts) '../..' is the package root, and skill/ lives there.
const PKG_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const SKILL_SRC_DIR = path.join(PKG_ROOT, 'skill');

// Records which CLI version wrote an installed skill. The payload ships with the
// package, so "which CLI wrote it" IS the skill's version — without the stamp we
// can only ask whether the directory exists, never whether it is current. A
// dotfile so it does not read as skill content to the agent loading it.
export const SKILL_VERSION_FILE = '.constellation-skill-version';

export interface SkillTarget {
  /** Human label, e.g. "Claude Code". */
  name: string;
  /** The agent config root, e.g. ~/.claude — skill goes in <root>/skills/constellation. */
  root: string;
}

export const SUPPORTED_SKILL_TARGETS = [
  { name: 'Claude Code', config: '.claude' },
  { name: 'Codex', config: '.codex' },
  { name: 'Cursor', config: '.cursor' },
  { name: 'Agents (shared)', config: '.agents' },
] as const;

export function skillDestination(target: SkillTarget): string {
  return path.join(target.root, 'skills', 'constellation');
}

async function pathState(p: string): Promise<'missing' | 'symlink' | 'present'> {
  try {
    const st = await lstat(p);
    return st.isSymbolicLink() ? 'symlink' : 'present';
  } catch {
    return 'missing';
  }
}

/** Detect which supported agent config dirs exist under the home directory. */
export async function detectSkillTargets(homeDir = os.homedir()): Promise<SkillTarget[]> {
  const found: SkillTarget[] = [];
  for (const t of SUPPORTED_SKILL_TARGETS) {
    const root = path.join(homeDir, t.config);
    if ((await pathState(root)) !== 'missing') found.push({ name: t.name, root });
  }
  return found;
}

export interface SkillPlan {
  fresh: SkillTarget[];
  current: SkillTarget[];
  stale: SkillTarget[];
  linked: string[];
}

/** Classify each target by what's already at its destination. */
export async function classifySkillTargets(
  targets: SkillTarget[],
  version: string,
): Promise<SkillPlan> {
  const plan: SkillPlan = { fresh: [], current: [], stale: [], linked: [] };
  for (const target of targets) {
    const dest = skillDestination(target);
    const state = await pathState(dest);
    if (state === 'symlink') {
      plan.linked.push(dest);
      continue;
    }
    if (state === 'missing') {
      plan.fresh.push(target);
      continue;
    }
    let installed: string | null = null;
    try {
      installed = (await readFile(path.join(dest, SKILL_VERSION_FILE), 'utf8')).trim();
    } catch {
      // No stamp: a hand-copied or pre-stamp install — treat as stale.
    }
    (installed === version ? plan.current : plan.stale).push(target);
  }
  return plan;
}

/** Copy the packaged skill into each destination and stamp the version. */
export async function installSkills(targets: SkillTarget[], version: string): Promise<void> {
  for (const target of targets) {
    const dest = skillDestination(target);
    await mkdir(path.dirname(dest), { recursive: true });
    await rm(dest, { recursive: true, force: true });
    await cp(SKILL_SRC_DIR, dest, { recursive: true });
    await writeFile(path.join(dest, SKILL_VERSION_FILE), `${version}\n`);
    console.log(`${pc.green('✓')} Installed skill ${version} → ${dest} (${target.name})`);
  }
}

async function confirm(question: string, fallback: boolean): Promise<boolean> {
  if (!process.stdin.isTTY) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    if (answer === '') return fallback;
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * `constellation add skills` — install/refresh the packaged authoring skill into
 * detected agent config dirs. Re-running after a CLI upgrade is the normal way to
 * refresh, so an existing install asks rather than refusing; the refusal only
 * survives on a non-TTY, where a script must name the clobber with --overwrite.
 */
export async function addSkills(
  version: string,
  opts: { overwrite?: boolean; skillRoot?: string[] } = {},
): Promise<void> {
  // Explicit roots are explicit intent: skip detection entirely.
  const targets: SkillTarget[] =
    opts.skillRoot && opts.skillRoot.length > 0
      ? opts.skillRoot.map((root) => ({ name: root, root: path.resolve(root) }))
      : await detectSkillTargets();

  if (targets.length === 0) {
    console.log(
      pc.yellow('No agent config folders found') +
        ` (looked for ${SUPPORTED_SKILL_TARGETS.map((t) => `~/${t.config}`).join(', ')}).` +
        ' Point at one explicitly with --skill-root <dir>.',
    );
    return;
  }

  if (opts.overwrite) {
    // Explicit intent: write every target, symlinked destinations included.
    await installSkills(targets, version);
    return;
  }

  const plan = await classifySkillTargets(targets, version);
  for (const dest of plan.linked) {
    console.log(`${pc.yellow('!')} ${dest} is a symlink — left as is.`);
  }
  for (const target of plan.current) {
    console.log(
      `${pc.green('✓')} ${skillDestination(target)} already has skill ${version} — up to date.`,
    );
  }

  const install = [...plan.fresh];
  if (plan.stale.length > 0) {
    const paths = plan.stale.map(skillDestination);
    if (!process.stdin.isTTY) {
      console.error(
        pc.red('Refusing to overwrite existing skill installation(s) (use --overwrite):') +
          `\n  ${paths.join('\n  ')}`,
      );
      process.exitCode = 1;
      return;
    }
    const ok = await confirm(
      `Update ${paths.length === 1 ? 'the skill' : `${paths.length} skills`} at:\n  ${paths.join('\n  ')}\nto version ${version}? [Y/n] `,
      true,
    );
    if (ok) install.push(...plan.stale);
    else console.log(`${pc.yellow('!')} Left as is: ${paths.join(', ')}`);
  }

  if (install.length === 0) {
    if (plan.current.length > 0 && plan.stale.length === 0) {
      console.log(`Run ${pc.bold('constellation add skills --overwrite')} to reinstall anyway.`);
    }
    return;
  }
  await installSkills(install, version);
}

/**
 * Post-upgrade offer: the new package is on disk, so refresh installed skills
 * from the NEW global binary (not this process's old payload).
 */
export async function offerSkillUpdateAfterUpgrade(): Promise<void> {
  const targets = await detectSkillTargets();
  if (targets.length === 0) return;
  const installed = (
    await Promise.all(
      targets.map(async (t) => ((await pathState(skillDestination(t))) === 'present' ? t : null)),
    )
  ).filter((t): t is SkillTarget => t !== null);
  if (installed.length === 0) return;
  const ok = await confirm('Also update the installed Constellation skills? [Y/n] ', true);
  if (!ok) return;
  const { spawn } = await import('node:child_process');
  const bin = process.platform === 'win32' ? 'constellation.cmd' : 'constellation';
  const child = spawn(bin, ['add', 'skills', '--overwrite'], { stdio: 'inherit' });
  await new Promise<void>((resolve) => {
    child.on('error', () => {
      console.error(
        pc.yellow('Could not run the upgraded CLI — run `constellation add skills` manually.'),
      );
      resolve();
    });
    child.on('close', () => resolve());
  });
}
