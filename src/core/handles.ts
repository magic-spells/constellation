import { TYPE_NAMES, type TypeName } from './types.js';

/** Handle grammar: PREFIX-NAME, uppercase letters/digits/dashes. */
export const HANDLE_PATTERN = /^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$/;

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 135;

/** Folder each type's cards live in, relative to the plan root. */
export const TYPE_FOLDERS: Record<TypeName, string> = {
  API: 'api',
  DB: 'db',
  DATATYPE: 'datatype',
  ROLE: 'role',
  DOC: 'doc',
  FILE: 'file',
  TEST: 'test',
  EXTERNAL: 'external',
  EVENT: 'event',
  COMPONENT: 'component',
  PAGE: 'page',
  JOB: 'job',
  FLOW: 'flow',
  STATE: 'state',
  DIAGRAM: 'diagram',
  AGENT: 'agent',
  PLAN: 'plan',
};

const TYPE_SET = new Set<string>(TYPE_NAMES);

/** True when the string matches the handle grammar (prefix may be unknown). */
export function isHandleShaped(value: string): boolean {
  return (
    value.length >= HANDLE_MIN_LENGTH &&
    value.length <= HANDLE_MAX_LENGTH &&
    HANDLE_PATTERN.test(value)
  );
}

/** Type for a handle's prefix, or null when the prefix is not one of the 17. */
export function typeForHandle(handle: string): TypeName | null {
  const dash = handle.indexOf('-');
  if (dash <= 0) return null;
  const prefix = handle.slice(0, dash);
  return TYPE_SET.has(prefix) ? (prefix as TypeName) : null;
}

/** Shaped AND carries a known prefix — the test used for reference extraction. */
export function isKnownHandle(value: string): boolean {
  return isHandleShaped(value) && typeForHandle(value) !== null;
}
