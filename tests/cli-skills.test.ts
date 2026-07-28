import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
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
    const found = await detectSkillTargets(home);
    expect(found.map((t) => t.name)).toEqual(['Claude Code', 'Cursor']);
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
