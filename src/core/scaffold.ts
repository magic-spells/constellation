import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stampFormatReview } from './git.js';
import { CONSTELLATION_VERSION } from './version.js';

/** Turn a folder slug into a human-readable project name: pyramid-server → Pyramid Server. */
export function titleCaseFromSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ') // kebab / snake → spaces
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // split camelCase
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The starter plan.md body, parameterized by the project's display name. */
export function starterPlan(name: string): string {
  return `---
name: ${name}
---

# Project Plan

## Current state

- (what exists, what is in flight)

## Conventions

- (project-wide rules cards should follow)

## Last synced

Code has not been reconciled against this plan yet.
`;
}

/**
 * `.constellation/CLAUDE.md` — the rules for the working set, committed so an
 * agent with no MCP server still knows the format. Keep it short: it is read
 * at session start and after every compaction, so every line is a recurring
 * token bill. The full guidance lives in the skill (`working-memory.md`).
 */
export function workingClaudeMd(): string {
  return `# Working memory (\`.constellation/\`)

\`working.md\` is short-term memory for the current stretch of work: what is in flight,
what is next, what waits on the user, what was decided. Cards say what the system is;
this says what we are doing about it this week. One line per item, grouped by type:

    Updated 2026-09-17 06:56 · branch \`release/1.0.0\` @ 62da1b5 · next G3 C11 P4 F2 T15 Q8 I9 D12

    ## TASK
    - T12 [4] Stripe webhook — wt stripe-webhook, 148846a, opus a2c1 → merge

Types, in file order: **G**OAL (outcome wanted) · **C**ONSTRAINT (rule the user stated,
quoted verbatim) · **P**LAN (ordered steps, \`✓\` done, \`→\` next) · **F**OCUS (the step right
now; one line, replaced not appended) · **T**ASK (in-flight work: worktree, branch, head,
holder, next step) · **Q**UESTION (only the user can answer) · **I**DEA · **D**ECISION.

Rules:
- Ids are \`<prefix><n>\`, allocated per type, never reused or renumbered. Type is fixed at
  creation. \`[1-5]\` is importance — what gets cut first; G and C at 5 are never cut.
- There is no status. An item is here or it is dropped; dropping with a reason is how you
  check something off, and the reason goes to \`log/YYYY-MM-DD.md\`, which is the history.
- Read it at session start and right after every compaction, before acting on the summary.
  Verify against \`git worktree list\` / \`git log -1\` where the two disagree.
- Write the moment state changes: a dispatch, a merge, a decision, a user rule, a blocker.
  Close what you finished in the same turn it lands.
- Keep lines short — aim under 100 characters, hard ceiling 160. A headline, not a
  sentence: identifiers, not descriptions. Link cards as \`[[HANDLE]]\`; never restate them.
- Only the orchestrating session edits \`working.md\`. Sub-agents append to the log.
- More than ~25 live items means sweep, not achievement. A decision that outlives the
  stretch becomes a DECISION card; an idea that becomes work becomes a TASK or a card.

Everything in this folder except this file is gitignored.
`;
}

/**
 * Create constellation/ with a starter plan.md. Throws if it already exists.
 * The project name defaults to a title-cased version of the target folder
 * (so pyramid-server → "Pyramid Server"); pass opts.name to override it. The
 * resolved name is returned so callers can echo / confirm it.
 */
export async function initPlan(
  targetDir: string,
  opts: { name?: string } = {},
): Promise<{ root: string; name: string }> {
  const resolvedTarget = path.resolve(targetDir);
  const root = path.join(resolvedTarget, 'constellation');
  const name =
    opts.name?.trim() ||
    titleCaseFromSlug(path.basename(resolvedTarget)) ||
    'Project plan';
  try {
    await access(root);
    throw new Error(`${root} already exists`);
  } catch (err) {
    if (err instanceof Error && err.message.endsWith('already exists')) throw err;
  }
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'plan.md'), starterPlan(name), { flag: 'wx' });
  // A plan born on this version was authored under this version's rules, so it
  // must never be offered the one-time format-upgrade review. No sync point yet —
  // nothing has been reconciled — just the review stamp.
  await stampFormatReview(root, CONSTELLATION_VERSION);
  return { root, name };
}
