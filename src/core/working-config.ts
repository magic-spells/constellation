import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { withFileLock, writeAtomic } from './writer.js';

/**
 * `.constellation/config.json` — the per-repo working memory settings. Local like
 * the rest of the folder (never tracked), and the user's choice: asked once when
 * working memory is first set up, changed afterwards only by the user (the CLI's
 * `working on|off|new-session`). A missing file or key means the defaults, which
 * are exactly the behaviour before the file existed; a malformed one degrades to
 * the defaults with a warning and never throws.
 */

export const WORKING_CONFIG_FILE = 'config.json';

export type NewSessionMode = 'keep' | 'clear';
export const NEW_SESSION_MODES: NewSessionMode[] = ['keep', 'clear'];

export interface WorkingConfig {
  /** false: no working_* tools, no orient.working, a silent hook. */
  enabled: boolean;
  /** clear: a fresh session (startup / clear) drops every item but CONSTRAINT lines. */
  new_session: NewSessionMode;
}

export const DEFAULT_WORKING_CONFIG: Readonly<WorkingConfig> = Object.freeze({
  enabled: true,
  new_session: 'keep',
});

export interface WorkingConfigRead {
  config: WorkingConfig;
  /** True when config.json is on disk (even if it was malformed). */
  exists: boolean;
  path: string;
  /** Why some or all of the file was ignored; empty when it read cleanly. */
  warnings: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Pull the two settings out of a parsed file; anything unusable falls back. */
export function normalizeWorkingConfig(raw: unknown): {
  config: WorkingConfig;
  warnings: string[];
} {
  const config: WorkingConfig = { ...DEFAULT_WORKING_CONFIG };
  const warnings: string[] = [];
  if (!isObject(raw)) {
    warnings.push('config.json is not a JSON object — using the defaults');
    return { config, warnings };
  }
  if (raw.working === undefined) return { config, warnings };
  if (!isObject(raw.working)) {
    warnings.push('config.json "working" is not an object — using the defaults');
    return { config, warnings };
  }
  const { enabled, new_session: mode } = raw.working;
  if (enabled !== undefined) {
    if (typeof enabled === 'boolean') config.enabled = enabled;
    else warnings.push('config.json "working.enabled" is not true or false — using true');
  }
  if (mode !== undefined) {
    if (mode === 'keep' || mode === 'clear') config.new_session = mode;
    else warnings.push('config.json "working.new_session" is not "keep" or "clear" — using "keep"');
  }
  return { config, warnings };
}

async function readRaw(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function parseRaw(raw: string): { value: unknown; error: boolean } {
  try {
    return { value: JSON.parse(raw) as unknown, error: false };
  } catch {
    return { value: null, error: true };
  }
}

/** The effective settings for the working folder `dir`. Never throws. */
export async function readWorkingConfigAt(dir: string): Promise<WorkingConfigRead> {
  const file = path.join(dir, WORKING_CONFIG_FILE);
  const raw = await readRaw(file);
  if (raw === null) {
    return { config: { ...DEFAULT_WORKING_CONFIG }, exists: false, path: file, warnings: [] };
  }
  const parsed = parseRaw(raw);
  if (parsed.error) {
    return {
      config: { ...DEFAULT_WORKING_CONFIG },
      exists: true,
      path: file,
      warnings: ['config.json is not valid JSON — using the defaults'],
    };
  }
  const { config, warnings } = normalizeWorkingConfig(parsed.value);
  return { config, exists: true, path: file, warnings };
}

export interface WorkingConfigWrite {
  config: WorkingConfig;
  path: string;
  /** True when this call created the file. */
  created: boolean;
  /** False when `ifMissing` found a file and left it alone. */
  written: boolean;
  warnings: string[];
}

/**
 * Write settings into `<dir>/config.json`, creating the folder. Both keys are
 * always spelled out so the file documents itself; any other keys already in the
 * file are kept. `ifMissing` writes only when there is no file yet — the init
 * path, which must never overwrite an answer the user already gave.
 */
export async function writeWorkingConfigAt(
  dir: string,
  patch: Partial<WorkingConfig>,
  opts: { ifMissing?: boolean } = {},
): Promise<WorkingConfigWrite> {
  const file = path.join(dir, WORKING_CONFIG_FILE);
  await mkdir(dir, { recursive: true });
  return withFileLock(file, async () => {
    const raw = await readRaw(file);
    if (raw !== null && opts.ifMissing) {
      const current = await readWorkingConfigAt(dir);
      return {
        config: current.config,
        path: file,
        created: false,
        written: false,
        warnings: current.warnings,
      };
    }
    const warnings: string[] = [];
    let base: Record<string, unknown> = {};
    if (raw !== null) {
      const parsed = parseRaw(raw);
      if (!parsed.error && isObject(parsed.value)) base = parsed.value;
      else warnings.push('config.json was malformed — replaced it');
    }
    const current = normalizeWorkingConfig(base).config;
    const config: WorkingConfig = {
      enabled: patch.enabled ?? current.enabled,
      new_session: patch.new_session ?? current.new_session,
    };
    const working = isObject(base.working) ? base.working : {};
    const next = { ...base, working: { ...working, ...config } };
    await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
    return { config, path: file, created: raw === null, written: true, warnings };
  });
}
