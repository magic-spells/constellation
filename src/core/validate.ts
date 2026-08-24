import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { TYPE_FOLDERS } from './handles.js';
import type { Card, Issue, TypeName } from './types.js';

// ajv ships CJS; createRequire sidesteps ESM default-export interop quirks.
const require = createRequire(import.meta.url);
const ajvModule = require('ajv/dist/2020.js');
const Ajv2020 = ajvModule.default ?? ajvModule;

type ValidateFn = ((data: unknown) => boolean) & {
  errors?: Array<{ instancePath: string; message?: string }> | null;
};

export interface SchemaSet {
  /** Schema-violation (W002) and unknown-field (W003) issues for one card. */
  validateCard(card: Card): Issue[];
}

// The four reserved keys, plus any cross-type metadata fields card.json defines
// (code_refs, verified_sha, verified_at, notes). Deriving the base allow-list
// from card.json — rather than a hardcoded list — means a new optional metadata
// field is blessed on every type the moment it is added to the schema, and AJV
// validates its shape (W002) on every card via cardValidator.
const RESERVED_KEYS = ['name', 'kind', 'status', 'connections'];

function baseKeysFrom(cardSchema: Record<string, unknown> | undefined): string[] {
  const props = (cardSchema?.properties as Record<string, unknown> | undefined) ?? {};
  const keys = Object.keys(props);
  return keys.length > 0 ? keys : RESERVED_KEYS;
}

// W003 answers its own question: the message names the fields the type accepts,
// so an agent does not need a describe_type round-trip to fix a typo. The two
// sources stay visible as two groups — the type's own fields, then the
// cross-type keys card.json blesses on all 21 types — because the fix differs
// (a wrong type-specific field is usually the wrong card type).

/** Longest field list rendered before it collapses to "+N more". */
const MAX_LISTED_FIELDS = 12;

/** Case- and separator-insensitive, so codeRefs ~ code_refs is a zero-cost hit. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Levenshtein distance, two-row DP. Short strings only; no dependency needed. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return a.length || b.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let row = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, row] = [row, prev];
  }
  return prev[b.length];
}

/**
 * The nearest known field to `key`, or undefined when nothing is close enough.
 * The budget scales with length (1 edit for short names, 3 for long ones) so a
 * plural slip or a transposition hits while unrelated names stay silent.
 */
function suggestKey(key: string, known: Iterable<string>): string | undefined {
  const target = normalizeKey(key);
  if (!target) return undefined;
  let best: { key: string; dist: number } | undefined;
  for (const candidate of known) {
    const norm = normalizeKey(candidate);
    const dist = editDistance(target, norm);
    const budget = Math.min(3, Math.max(1, Math.floor(Math.max(target.length, norm.length) / 4)));
    if (dist > budget) continue;
    if (!best || dist < best.dist || (dist === best.dist && candidate < best.key)) {
      best = { key: candidate, dist };
    }
  }
  return best?.key;
}

/** Sorted for stable output; truncated with a count so the line stays readable. */
function renderFields(keys: string[]): string {
  const sorted = [...keys].sort();
  if (sorted.length <= MAX_LISTED_FIELDS) return sorted.join(', ');
  const shown = sorted.slice(0, MAX_LISTED_FIELDS).join(', ');
  return `${shown}, +${sorted.length - MAX_LISTED_FIELDS} more`;
}

function fieldHint(type: string, ownKeys: string[], baseKeys: string[]): string {
  // The reserved four are structure every card already carries, not metadata you
  // add — listing them pads every warning. They stay suggestion candidates.
  const metadata = baseKeys.filter((key) => !RESERVED_KEYS.includes(key));
  const groups = [
    ownKeys.length === 0
      ? `${type} has no type-specific fields`
      : `valid ${type} fields: ${renderFields(ownKeys)}`,
  ];
  if (metadata.length > 0) groups.push(`any card: ${renderFields(metadata)}`);
  return groups.join('; ');
}

// Schemas are static package files; compile them once per directory per process.
// Rebuilding Ajv on every lint (i.e. every MCP write) is pure waste.
const schemaSetCache = new Map<string, Promise<SchemaSet>>();

export function loadSchemas(schemasDir?: string): Promise<SchemaSet> {
  const dir =
    schemasDir ?? path.join(fileURLToPath(new URL('../..', import.meta.url)), 'schemas');
  let cached = schemaSetCache.get(dir);
  if (!cached) {
    cached = buildSchemaSet(dir);
    // A failed load (e.g. transient fs error) must not poison the process.
    cached.catch(() => schemaSetCache.delete(dir));
    schemaSetCache.set(dir, cached);
  }
  return cached;
}

async function buildSchemaSet(dir: string): Promise<SchemaSet> {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const raw = new Map<string, Record<string, unknown>>();
  for (const file of files) {
    const schema = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    raw.set(file, schema);
    ajv.addSchema(schema, file);
  }

  const cardValidator = ajv.getSchema('card.json') as ValidateFn;
  const baseKeys = baseKeysFrom(raw.get('card.json'));
  const typeValidators = new Map<TypeName, ValidateFn>();
  const knownKeys = new Map<TypeName, Set<string>>();
  // Hints are the same for every card of a type; build the strings once.
  const fieldHints = new Map<TypeName, string>();

  for (const [type, folder] of Object.entries(TYPE_FOLDERS)) {
    const file = `${folder}.json`;
    const schema = raw.get(file);
    if (!schema) continue;
    typeValidators.set(type as TypeName, ajv.getSchema(file) as ValidateFn);
    const props = Object.keys(
      (schema.properties as Record<string, unknown> | undefined) ?? {},
    ).filter((key) => !baseKeys.includes(key));
    knownKeys.set(type as TypeName, new Set([...baseKeys, ...props]));
    fieldHints.set(type as TypeName, fieldHint(type, props, baseKeys));
  }

  return {
    validateCard(card: Card): Issue[] {
      const issues: Issue[] = [];
      const validators = [cardValidator, typeValidators.get(card.type)].filter(
        Boolean,
      ) as ValidateFn[];

      for (const validate of validators) {
        if (!validate(card.frontmatter)) {
          for (const err of validate.errors ?? []) {
            issues.push({
              severity: 'warning',
              code: 'W002',
              message: `Frontmatter${err.instancePath || ''} ${err.message ?? 'is invalid'}`,
              file: card.relPath,
            });
          }
        }
      }

      const known = knownKeys.get(card.type) ?? new Set(baseKeys);
      const hint = fieldHints.get(card.type) ?? fieldHint(card.type, [], baseKeys);
      for (const key of Object.keys(card.frontmatter)) {
        if (!known.has(key)) {
          const near = suggestKey(key, known);
          const lead = near ? ` — did you mean "${near}"?` : '';
          issues.push({
            severity: 'warning',
            code: 'W003',
            message: `Unknown frontmatter field for ${card.type}: ${key}${lead} (${hint})`,
            file: card.relPath,
          });
        }
      }
      return issues;
    },
  };
}
