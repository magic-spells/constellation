import { describe, expect, it } from 'vitest';
import {
  isHandleShaped,
  isKnownHandle,
  typeForHandle,
  TYPE_FOLDERS,
} from '../src/core/handles.js';
import { TYPE_NAMES } from '../src/core/types.js';

describe('handle grammar', () => {
  it('accepts canonical handles', () => {
    expect(isHandleShaped('API-TICKETS')).toBe(true);
    expect(isHandleShaped('DATATYPE-CREATE-TICKET-INPUT')).toBe(true);
    expect(isHandleShaped('DB-2FA-CODES')).toBe(true);
  });

  it('rejects lowercase, underscores, and missing dash', () => {
    expect(isHandleShaped('api-tickets')).toBe(false);
    expect(isHandleShaped('API_TICKETS')).toBe(false);
    expect(isHandleShaped('APITICKETS')).toBe(false);
    expect(isHandleShaped('API-')).toBe(false);
    expect(isHandleShaped('-TICKETS')).toBe(false);
  });

  it('enforces length bounds', () => {
    expect(isHandleShaped('A-B')).toBe(true);
    expect(isHandleShaped(`API-${'X'.repeat(132)}`)).toBe(false);
  });
});

describe('typeForHandle', () => {
  it('maps every canonical prefix to its type', () => {
    for (const type of TYPE_NAMES) {
      expect(typeForHandle(`${type}-EXAMPLE`)).toBe(type);
    }
  });

  it('rejects v1 alias prefixes and unknown prefixes', () => {
    expect(typeForHandle('TYPE-USER')).toBeNull();
    expect(typeForHandle('COMP-BUTTON')).toBeNull();
    expect(typeForHandle('RULE-NO-ANY')).toBeNull();
    expect(typeForHandle('WIDGET-THING')).toBeNull();
  });
});

describe('isKnownHandle', () => {
  it('requires both shape and known prefix', () => {
    expect(isKnownHandle('API-TICKETS')).toBe(true);
    expect(isKnownHandle('WIDGET-THING')).toBe(false);
    expect(isKnownHandle('api-tickets')).toBe(false);
  });
});

describe('TYPE_FOLDERS', () => {
  it('covers all 17 types with unique folders', () => {
    const folders = Object.values(TYPE_FOLDERS);
    expect(Object.keys(TYPE_FOLDERS)).toHaveLength(17);
    expect(new Set(folders).size).toBe(17);
  });
});
