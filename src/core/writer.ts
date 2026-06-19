import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { TYPE_FOLDERS, typeForHandle } from './handles.js';

// The `(?:\r?\n)?` before the closing fence keeps a truly-empty block (`---\n---`)
// matchable, so a frontmatter-only write doesn't mistake it for body and duplicate it.
const FM_BLOCK = /^---\r?\n([\s\S]*?)(?:\r?\n)?---\r?\n?/;
const RESERVED_FRONTMATTER_KEYS = new Set(['name', 'kind', 'status', 'connections']);

export function reservedFieldKeys(fields?: Record<string, unknown>): string[] {
  return Object.keys(fields ?? {}).filter((key) => RESERVED_FRONTMATTER_KEYS.has(key));
}

/**
 * Deep-merge a patch into a frontmatter object. Plain objects merge recursively,
 * arrays replace wholesale, explicit null deletes the key. Returns a new object
 * preserving the target's key order (new keys append).
 */
export function deepMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
    } else if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface CardPatch {
  name?: string | null;
  kind?: string | null;
  status?: string | null;
  /** Replaces the whole list; null deletes it. */
  connections?: string[] | null;
  /** Type-specific frontmatter; deep-merged (arrays replace, null deletes). */
  fields?: Record<string, unknown>;
}

/** Shared patch semantics for MCP update_card and the viewer's PATCH endpoint. */
export function applyCardPatch(
  frontmatter: Record<string, unknown>,
  patch: CardPatch,
): Record<string, unknown> {
  const reserved = reservedFieldKeys(patch.fields);
  if (reserved.length > 0) {
    throw new Error(`fields cannot contain reserved keys: ${reserved.join(', ')}`);
  }
  const patchObject: Record<string, unknown> = { ...(patch.fields ?? {}) };
  if (patch.name !== undefined) patchObject.name = patch.name;
  if (patch.kind !== undefined) patchObject.kind = patch.kind;
  if (patch.status !== undefined) patchObject.status = patch.status;
  if (patch.connections !== undefined) {
    patchObject.connections =
      patch.connections === null
        ? null
        : patch.connections.map((c) => c.toUpperCase());
  }
  return deepMerge(frontmatter, patchObject);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export type NoteKind = 'decision' | 'gotcha' | 'state' | 'deviation' | 'verified';

export interface CardNote {
  kind: NoteKind;
  text: string;
  sha?: string;
}

/**
 * Append a typed note to a card's `notes` array (append-only memory). Preserves
 * frontmatter key order — when `notes` already exists it is updated in place, so
 * updateCardFile re-serializes only that one key and leaves the rest byte-for-byte.
 */
export function withAppendedNote(
  frontmatter: Record<string, unknown>,
  note: CardNote,
): Record<string, unknown> {
  const existing = Array.isArray(frontmatter.notes) ? frontmatter.notes : [];
  const entry: Record<string, unknown> = { kind: note.kind, text: note.text };
  if (note.sha) entry.sha = note.sha;
  return { ...frontmatter, notes: [...existing, entry] };
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

interface BodyHeading {
  line: number;
  level: number;
  text: string;
}

/** Markdown headings in a body, skipping any inside fenced code blocks. */
function scanHeadings(lines: string[]): BodyHeading[] {
  const out: BodyHeading[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING_RE.exec(lines[i]);
    if (m) out.push({ line: i, level: m[1].length, text: m[2].trim() });
  }
  return out;
}

/** Heading texts of a body (fence-aware) — for surfacing the available sections. */
export function bodyHeadingTexts(body: string): string[] {
  return scanHeadings(body.split('\n')).map((h) => h.text);
}

/**
 * Replace the content under a markdown heading (matched by heading text,
 * case-insensitively) with `newContent`, keeping the heading line and every
 * other section byte-for-byte. The replaced span runs from just after the
 * heading to the next heading of the same or higher level (or end of body).
 * Headings inside fenced code blocks are ignored, so a `#`-line in a ```sh block
 * is never mistaken for a section. Returns null when the heading is absent OR
 * ambiguous (more than one match) — the caller tells the two apart via
 * bodyHeadingTexts and reports accordingly.
 */
export function replaceBodySection(
  body: string,
  heading: string,
  newContent: string,
): string | null {
  const target = heading.trim().replace(/^#+\s*/, '').toLowerCase();
  const lines = body.split('\n');
  const headings = scanHeadings(lines);
  const matches = headings.filter((h) => h.text.toLowerCase() === target);
  if (matches.length !== 1) return null; // absent or ambiguous

  const { line: startIdx, level } = matches[0];
  const next = headings.find((h) => h.line > startIdx && h.level <= level);
  const endIdx = next ? next.line : lines.length;

  const before = lines.slice(0, startIdx + 1).join('\n');
  const after = lines.slice(endIdx).join('\n');
  const content = newContent.replace(/\s+$/, '');
  return after.trim().length > 0
    ? `${before}\n\n${content}\n\n${after}`
    : `${before}\n\n${content}\n`;
}

function dumpFrontmatter(fm: Record<string, unknown>): string {
  // js-yaml dumps in insertion order; deepMerge preserves it, so existing key
  // order survives a rewrite. Style normalizes (flow maps may become block).
  return yaml.dump(fm, { lineWidth: 100, noRefs: true });
}

export function composeCard(
  fm: Record<string, unknown>,
  body: string,
): string {
  const fmText =
    Object.keys(fm).length > 0 ? `---\n${dumpFrontmatter(fm)}---\n\n` : '';
  return `${fmText}${body.replace(/\s+$/, '')}\n`;
}

/** Path a handle's card file belongs at, relative to the plan root. */
export function relPathForHandle(handle: string): string {
  if (handle === 'PLAN-PROJECT') return 'plan.md';
  const type = typeForHandle(handle);
  if (!type) throw new Error(`Unknown handle prefix: ${handle}`);
  return path.join(TYPE_FOLDERS[type], `${handle}.md`);
}

export async function createCardFile(
  planRoot: string,
  handle: string,
  fm: Record<string, unknown>,
  body: string,
): Promise<string> {
  const relPath = relPathForHandle(handle);
  const filePath = path.join(planRoot, relPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, composeCard(fm, body), { flag: 'wx' });
  return relPath;
}

export interface CardFileUpdate {
  /** Complete new frontmatter object. Omit to leave frontmatter bytes untouched. */
  frontmatter?: Record<string, unknown>;
  /** Complete new body. Omit to leave the body untouched. */
  body?: string;
}

/**
 * Re-serialize frontmatter while keeping the original text of every top-level
 * key whose value is unchanged — a status flip must not reformat the columns
 * table next to it. Returns null when the original can't be segmented safely.
 */
function rewriteFrontmatter(
  originalInner: string,
  next: Record<string, unknown>,
): string | null {
  let originalParsed: Record<string, unknown>;
  try {
    const parsed = yaml.load(originalInner);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    originalParsed = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  // Split the original YAML into one text segment per top-level key.
  const segments = new Map<string, string>();
  let currentKey: string | null = null;
  let currentLines: string[] = [];
  for (const line of originalInner.split('\n')) {
    const keyMatch = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (keyMatch) {
      if (currentKey) segments.set(currentKey, currentLines.join('\n'));
      currentKey = keyMatch[1];
      currentLines = [line];
    } else if (currentKey) {
      currentLines.push(line);
    } else if (line.trim() !== '') {
      // Leading content that is not a plain key (quoted key, doc marker…).
      return null;
    }
  }
  if (currentKey) segments.set(currentKey, currentLines.join('\n'));
  if (segments.size !== Object.keys(originalParsed).length) return null;

  const parts: string[] = [];
  for (const [key, value] of Object.entries(next)) {
    const original = segments.get(key);
    if (
      original !== undefined &&
      JSON.stringify(originalParsed[key]) === JSON.stringify(value)
    ) {
      parts.push(original.replace(/\n+$/, ''));
    } else {
      parts.push(yaml.dump({ [key]: value }, { lineWidth: 100, noRefs: true }).trimEnd());
    }
  }
  return `${parts.join('\n')}\n`;
}

/**
 * Rewrite a card file. A body-only update preserves the original frontmatter
 * block byte-for-byte; a frontmatter update re-serializes only the top-level
 * keys whose values changed, keeping everything else byte-identical.
 */
export async function updateCardFile(
  filePath: string,
  update: CardFileUpdate,
): Promise<void> {
  const raw = await readFile(filePath, 'utf8');
  const match = raw.match(FM_BLOCK);
  const originalFmBlock = match ? match[0] : '';
  const originalBody = match ? raw.slice(match[0].length) : raw;

  let fmText: string;
  if (update.frontmatter !== undefined) {
    if (Object.keys(update.frontmatter).length === 0) {
      fmText = '';
    } else {
      const inner =
        (match && rewriteFrontmatter(match[1], update.frontmatter)) ??
        dumpFrontmatter(update.frontmatter);
      fmText = `---\n${inner}---\n\n`;
    }
  } else {
    fmText = originalFmBlock;
    // Keep the original separation when we keep the original block.
    if (fmText && update.body !== undefined && !fmText.endsWith('\n\n')) {
      fmText = `${fmText}\n`;
    }
  }

  let body = update.body !== undefined ? update.body.replace(/\s+$/, '') : originalBody;
  // The frontmatter block already supplies the blank-line separation.
  if (fmText.endsWith('\n\n')) body = body.replace(/^\n+/, '');
  const trailingNewline = update.body !== undefined ? '\n' : '';
  await writeFile(filePath, `${fmText}${body}${trailingNewline}`, 'utf8');
}
