import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * `constellation/atlas.json` — how the author wants the city laid out.
 *
 * This is the plan's SECOND non-card file, after `.sync.json`, and the bar for
 * that is high. What earns it: everything in here is authored *presentation*,
 * never a graph fact. Which cards exist, what connects to what and which
 * feature owns a card all stay derived from the cards themselves and are
 * recomputed on every load. This file only records where a person decided to
 * put things and how they want the map coloured — input, not derived state.
 *
 * So the invariant is intact: nothing derived is stored. A pin is not a derived
 * value; it is a preference that cannot be computed from the graph at all.
 *
 * Why not PLAN-PROJECT frontmatter, where `doc_sections` lives: pins are
 * per-card coordinates whose volume would swamp the project card, and they are
 * tuned interactively by dragging. `doc_sections` is a short list a human types
 * once. Different shape, different home. See DECISION-ATLAS-CONFIG-FILE.
 *
 * Absent file = fully computed layout, which is the normal case. Every field is
 * optional and a malformed file degrades to defaults rather than failing the
 * viewer — a hand-edited config must never be able to take the atlas down.
 */
export const ATLAS_CONFIG_FILE = 'atlas.json';

export interface AtlasConfig {
  /** District order; ids not listed follow, sorted by size then id. */
  districts?: string[];
  /** handle → [col, row] within its district. */
  pin?: Record<string, [number, number]>;
  /** handle → silhouette name, overriding the type default. */
  shape?: Record<string, string>;
  /** handle → height in cells, overriding the lens. */
  height?: Record<string, number>;
  /** Default lens. */
  lens?: string;
  /** Default renderer: 'iso' | 'lit'. */
  engine?: string;
  /** Handles to leave off the map entirely. */
  hide?: string[];
}

const HANDLE = /^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$/;

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return out.length ? out : undefined;
}

function handleMap<T>(
  value: unknown,
  coerce: (raw: unknown) => T | undefined,
): Record<string, T> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, T> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!HANDLE.test(key)) continue;
    const coerced = coerce(raw);
    if (coerced !== undefined) out[key] = coerced;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Coerce arbitrary parsed JSON into a config. Unknown keys and bad values are
 * dropped silently: this file is hand-editable, so "mostly right" must still
 * work rather than erroring at someone over a stray field.
 */
export function normalizeAtlasConfig(raw: unknown): AtlasConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;

  const config: AtlasConfig = {};
  const districts = stringArray(input.districts);
  if (districts) config.districts = districts;

  const pin = handleMap(input.pin, (v) => {
    if (!Array.isArray(v) || v.length !== 2) return undefined;
    const [col, row] = v;
    if (!Number.isInteger(col) || !Number.isInteger(row)) return undefined;
    if (col < 0 || row < 0) return undefined;
    return [col, row] as [number, number];
  });
  if (pin) config.pin = pin;

  const shape = handleMap(input.shape, (v) =>
    typeof v === 'string' && v.length ? v : undefined,
  );
  if (shape) config.shape = shape;

  const height = handleMap(input.height, (v) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined,
  );
  if (height) config.height = height;

  if (typeof input.lens === 'string' && input.lens) config.lens = input.lens;
  if (typeof input.engine === 'string' && input.engine) config.engine = input.engine;

  const hide = stringArray(input.hide)?.filter((h) => HANDLE.test(h));
  if (hide?.length) config.hide = hide;

  return config;
}

/** Read the config. Missing or unparseable file → `{}`; never throws. */
export async function readAtlasConfig(planRoot: string): Promise<AtlasConfig> {
  try {
    const text = await readFile(join(planRoot, ATLAS_CONFIG_FILE), 'utf8');
    return normalizeAtlasConfig(JSON.parse(text));
  } catch {
    return {};
  }
}

/**
 * Write the config, normalized. Atomic (temp + rename) for the same reason card
 * writes are: a half-written config read by a live viewer is worse than none.
 */
export async function writeAtlasConfig(
  planRoot: string,
  config: AtlasConfig,
): Promise<AtlasConfig> {
  const normalized = normalizeAtlasConfig(config);
  const target = join(planRoot, ATLAS_CONFIG_FILE);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await rename(temp, target);
  return normalized;
}
