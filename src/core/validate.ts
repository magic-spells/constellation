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

export async function loadSchemas(schemasDir?: string): Promise<SchemaSet> {
  const dir =
    schemasDir ?? path.join(fileURLToPath(new URL('../..', import.meta.url)), 'schemas');

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

  for (const [type, folder] of Object.entries(TYPE_FOLDERS)) {
    const file = `${folder}.json`;
    const schema = raw.get(file);
    if (!schema) continue;
    typeValidators.set(type as TypeName, ajv.getSchema(file) as ValidateFn);
    const props = Object.keys(
      (schema.properties as Record<string, unknown> | undefined) ?? {},
    );
    knownKeys.set(type as TypeName, new Set([...baseKeys, ...props]));
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
      for (const key of Object.keys(card.frontmatter)) {
        if (!known.has(key)) {
          issues.push({
            severity: 'warning',
            code: 'W003',
            message: `Unknown frontmatter field for ${card.type}: ${key}`,
            file: card.relPath,
          });
        }
      }
      return issues;
    },
  };
}
