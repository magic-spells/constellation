import type { Card, PlanIndex, TypeName } from '../core/types.js';

export interface SearchHit {
  card: Card;
  score: number;
  excerpt: string;
}

/**
 * Scored full-text search over handle, name, kind, body, and appended notes.
 * Handle matches dominate; body/note occurrences break ties.
 */
export function searchCards(
  index: PlanIndex,
  q: string,
  types?: TypeName[],
): SearchHit[] {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const typeFilter = types && types.length > 0 ? new Set(types) : null;

  const hits: SearchHit[] = [];
  for (const card of index.cards.values()) {
    if (typeFilter && !typeFilter.has(card.type)) continue;

    const handle = card.handle.toLowerCase();
    const name = (card.name ?? '').toLowerCase();
    // Notes are memory (append_note) — they must be findable like the body is.
    const noteLines = noteLinesOf(card);
    const text =
      noteLines.length > 0
        ? `${card.body}\n${noteLines.join('\n')}`
        : card.body;
    const searchable = text.toLowerCase();

    let score = 0;
    for (const token of tokens) {
      if (handle === token) score += 12;
      else if (handle.includes(token)) score += 6;
      if (name.includes(token)) score += 4;
      if (card.kind?.toLowerCase() === token || card.type.toLowerCase() === token)
        score += 2;
      score += Math.min(countOccurrences(searchable, token), 5);
    }
    if (score === 0) continue;

    hits.push({ card, score, excerpt: makeExcerpt(text, tokens) });
  }

  return hits.sort(
    (a, b) => b.score - a.score || a.card.handle.localeCompare(b.card.handle),
  );
}

/** A card's notes as `note(kind): text` lines — searchable and excerpt-able. */
function noteLinesOf(card: Card): string[] {
  const notes = card.frontmatter.notes;
  if (!Array.isArray(notes)) return [];
  const out: string[] = [];
  for (const n of notes) {
    if (!n || typeof n !== 'object') continue;
    const note = n as Record<string, unknown>;
    if (typeof note.text !== 'string') continue;
    const kind = typeof note.kind === 'string' ? note.kind : 'note';
    out.push(`note(${kind}): ${note.text}`);
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = haystack.indexOf(needle);
  while (pos !== -1 && count < 5) {
    count += 1;
    pos = haystack.indexOf(needle, pos + needle.length);
  }
  return count;
}

function makeExcerpt(body: string, tokens: string[]): string {
  const lines = body.split('\n');
  const hit =
    lines.find((line) => {
      const lower = line.toLowerCase();
      return tokens.some((t) => lower.includes(t));
    }) ?? lines.find((line) => line.trim().length > 0);
  return (hit ?? '').trim().slice(0, 160);
}
