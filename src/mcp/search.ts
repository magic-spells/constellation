import type { Card, PlanIndex, TypeName } from '../core/types.js';

export interface SearchHit {
  card: Card;
  score: number;
  excerpt: string;
}

/**
 * Scored full-text search over handle, name, kind, and body.
 * Handle matches dominate; body occurrences break ties.
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
    const body = card.body.toLowerCase();

    let score = 0;
    for (const token of tokens) {
      if (handle === token) score += 12;
      else if (handle.includes(token)) score += 6;
      if (name.includes(token)) score += 4;
      if (card.kind?.toLowerCase() === token || card.type.toLowerCase() === token)
        score += 2;
      score += Math.min(countOccurrences(body, token), 5);
    }
    if (score === 0) continue;

    hits.push({ card, score, excerpt: makeExcerpt(card.body, tokens) });
  }

  return hits.sort(
    (a, b) => b.score - a.score || a.card.handle.localeCompare(b.card.handle),
  );
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
