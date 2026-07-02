import { readFile, rm } from 'node:fs/promises';
import { isHandleShaped, typeForHandle } from './handles.js';
import { loadPlan } from './indexer.js';
import { createRawCardFile, rewriteHandleInFile } from './writer.js';

/**
 * Rename a card's handle plan-wide — shared by the MCP `rename_card` tool and
 * the CLI `constellation rename` command. The card file moves to the new
 * handle's path (the folder follows the prefix, so a cross-type rename also
 * moves folders) with its bytes preserved, and every card that mentions the
 * old handle — connections lists, handle-shaped frontmatter values, [[links]],
 * mermaid node IDs, prose — is rewritten with whole-token matches only
 * (API-USER never touches API-USERS).
 */

export class RenameCardError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID_HANDLE' | 'CARD_EXISTS',
    message: string,
  ) {
    super(message);
    this.name = 'RenameCardError';
  }
}

export interface RenameResult {
  from: string;
  to: string;
  /** The card's path relative to the plan root (the old path on a noop). */
  file: string;
  /** Handles of the other cards whose references were rewritten, sorted. */
  references_updated: string[];
  /** True when from === to after normalization — nothing was changed. */
  noop: boolean;
}

export async function renameCard(
  root: string,
  fromRaw: string,
  toRaw: string,
): Promise<RenameResult> {
  const from = fromRaw.toUpperCase();
  const to = toRaw.toUpperCase();
  const index = await loadPlan(root);
  const card = index.cards.get(from);
  if (!card) throw new RenameCardError('NOT_FOUND', `No card with handle ${fromRaw}`);
  if (from === 'PLAN-PROJECT' || to === 'PLAN-PROJECT') {
    throw new RenameCardError(
      'INVALID_HANDLE',
      'PLAN-PROJECT (plan.md) is the plan root card and cannot be renamed to or from.',
    );
  }
  if (!isHandleShaped(to) || !typeForHandle(to)) {
    throw new RenameCardError(
      'INVALID_HANDLE',
      `${toRaw} is not a valid handle (uppercase PREFIX-NAME with a canonical prefix)`,
    );
  }
  if (to === from) {
    return { from, to, file: card.relPath, references_updated: [], noop: true };
  }
  if (index.cards.has(to)) {
    throw new RenameCardError('CARD_EXISTS', `${to} already exists`);
  }

  // Whole-token match; handles only contain [A-Z0-9-], so those delimit.
  const tokenOnce = new RegExp(`(?<![A-Z0-9-])${from}(?![A-Z0-9-])`);

  // Move the card file first (exclusive create refuses a stray file already
  // at the target path), rewriting self-references in the same pass.
  const raw = await readFile(card.filePath, 'utf8');
  const file = await createRawCardFile(
    root,
    to,
    raw.replace(new RegExp(tokenOnce.source, 'g'), to),
  );
  await rm(card.filePath);

  // Rewrite every card that mentions the old handle — structured refs and
  // prose alike. The frontmatter walk catches values the body test can't.
  const mentions = (value: unknown): boolean => {
    if (typeof value === 'string') return tokenOnce.test(value);
    if (Array.isArray(value)) return value.some(mentions);
    if (value && typeof value === 'object') return Object.values(value).some(mentions);
    return false;
  };
  const referencesUpdated: string[] = [];
  for (const other of index.cards.values()) {
    if (other.handle === from) continue;
    if (!tokenOnce.test(other.body) && !mentions(other.frontmatter)) continue;
    if (await rewriteHandleInFile(other.filePath, from, to)) {
      referencesUpdated.push(other.handle);
    }
  }
  referencesUpdated.sort();

  return { from, to, file, references_updated: referencesUpdated, noop: false };
}
