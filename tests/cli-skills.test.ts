import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applySkillPickerKey,
  classifySkillTargets,
  detectSkillTargets,
  installSkills,
  SKILL_VERSION_FILE,
  skillDestination,
  type SkillTarget,
} from '../src/cli/skills.js';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'constellation-skills-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function target(config: string): SkillTarget {
  return { name: config, root: path.join(home, config) };
}

describe('detectSkillTargets', () => {
  it('finds only agent config dirs that exist', async () => {
    await mkdir(path.join(home, '.claude'), { recursive: true });
    await mkdir(path.join(home, '.cursor'), { recursive: true });
    await mkdir(path.join(home, '.agents'), { recursive: true });
    const found = await detectSkillTargets(home);
    expect(found.map((t) => t.name)).toEqual(['Claude Code', 'Cursor', 'Agents (shared)']);
  });

  it('returns nothing in an empty home', async () => {
    expect(await detectSkillTargets(home)).toEqual([]);
  });
});

describe('classifySkillTargets', () => {
  it('classifies fresh, current, stale, and symlinked destinations', async () => {
    const fresh = target('.claude');

    const current = target('.codex');
    await mkdir(skillDestination(current), { recursive: true });
    await writeFile(path.join(skillDestination(current), SKILL_VERSION_FILE), '1.0.0\n');

    const stale = target('.cursor');
    await mkdir(skillDestination(stale), { recursive: true });
    await writeFile(path.join(skillDestination(stale), SKILL_VERSION_FILE), '0.9.0\n');

    const linked = target('.linked');
    await mkdir(path.dirname(skillDestination(linked)), { recursive: true });
    await symlink(home, skillDestination(linked));

    const plan = await classifySkillTargets([fresh, current, stale, linked], '1.0.0');
    expect(plan.fresh).toEqual([fresh]);
    expect(plan.current).toEqual([current]);
    expect(plan.stale).toEqual([stale]);
    expect(plan.linked).toEqual([skillDestination(linked)]);
  });

  it('treats an unstamped existing install as stale', async () => {
    const t = target('.claude');
    await mkdir(skillDestination(t), { recursive: true });
    await writeFile(path.join(skillDestination(t), 'SKILL.md'), 'hand-copied\n');
    const plan = await classifySkillTargets([t], '1.0.0');
    expect(plan.stale).toEqual([t]);
  });
});

describe('installSkills', () => {
  it('copies the packaged skill, replaces prior contents, and stamps the version', async () => {
    const t = target('.claude');
    const dest = skillDestination(t);
    await mkdir(dest, { recursive: true });
    await writeFile(path.join(dest, 'leftover.md'), 'old\n');

    await installSkills([t], '1.2.3');

    const skill = await readFile(path.join(dest, 'SKILL.md'), 'utf8');
    expect(skill).toContain('constellation');
    await expect(readFile(path.join(dest, 'methodology.md'), 'utf8')).resolves.toBeTruthy();
    const stamp = await readFile(path.join(dest, SKILL_VERSION_FILE), 'utf8');
    expect(stamp.trim()).toBe('1.2.3');
    await expect(readFile(path.join(dest, 'leftover.md'), 'utf8')).rejects.toThrow();
  });
});

// The picker's key handling, as a pure reducer. Driving raw-mode stdin from a
// test needs a pty and hangs the moment input runs out, so the escape codes and
// wrap-around are tested here instead of through the terminal.
describe('skill picker keys', () => {
  const S = (cursor: number, checked: boolean[]) => ({ cursor, checked });
  const press = (state: ReturnType<typeof S>, key: string, n = 3) =>
    applySkillPickerKey(state, key, n);

  it('starts every target checked and toggles one with space', () => {
    const after = press(S(0, [true, true, true]), ' ');
    expect(after.action).toBe('redraw');
    expect(after.state.checked).toEqual([false, true, true]);
    // Toggling is per-row, and the cursor does not move.
    expect(after.state.cursor).toBe(0);
  });

  it('wraps the cursor at both ends', () => {
    expect(press(S(0, [true, true, true]), '\x1b[A').state.cursor).toBe(2);
    expect(press(S(2, [true, true, true]), '\x1b[B').state.cursor).toBe(0);
    // j/k mirror the arrows.
    expect(press(S(0, [true, true, true]), 'k').state.cursor).toBe(2);
    expect(press(S(2, [true, true, true]), 'j').state.cursor).toBe(0);
  });

  it('makes `a` a true toggle, not a one-way "select all"', () => {
    // Anything unchecked → check everything.
    expect(press(S(0, [true, false, true]), 'a').state.checked).toEqual([true, true, true]);
    // Already all checked → clear, so pressing twice returns you where you were.
    expect(press(S(0, [true, true, true]), 'a').state.checked).toEqual([false, false, false]);
  });

  it('separates confirm from cancel', () => {
    expect(press(S(0, [true, true, true]), '\r').action).toBe('confirm');
    expect(press(S(0, [true, true, true]), '\n').action).toBe('confirm');
    // Esc and Ctrl+C cancel — raw mode swallows SIGINT, so 0x03 is explicit.
    expect(press(S(0, [true, true, true]), '\x1b').action).toBe('cancel');
    expect(press(S(0, [true, true, true]), '\x03').action).toBe('cancel');
  });

  it('ignores unmapped keys without disturbing state', () => {
    const before = S(1, [true, false, true]);
    const after = press(before, 'z');
    expect(after.action).toBe('ignore');
    expect(after.state).toBe(before);
  });
});
