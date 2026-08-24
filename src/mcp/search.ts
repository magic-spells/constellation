import type { Card, PlanIndex, TypeName } from '../core/types.js';

export interface SearchHit {
  card: Card;
  score: number;
  excerpt: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** What the query actually matched on, after stopwords and quoting. */
  needles: string[];
  /** True when the AND pass found nothing and these hits come from the OR retry. */
  relaxed: boolean;
  /** Needles no card carries at all — the words worth dropping. */
  unmatched: string[];
}

/**
 * Dropped before the AND pass — otherwise a natural-language query would require
 * every card to contain "the" and "does".
 */
const STOPWORDS = new Set([
  'a', 'about', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but',
  'by', 'can', 'did', 'do', 'does', 'for', 'from', 'get', 'had', 'has', 'have',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'me', 'my', 'no',
  'not', 'of', 'on', 'or', 'our', 'out', 'so', 'than', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'to', 'up', 'use', 'used',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will',
  'with', 'would', 'you', 'your',
]);

/**
 * Split a query into needles. Double-quoted runs stay whole; bare tokens split
 * on whitespace and lose edge punctuation (`API-TICKETS,` matches the handle).
 * Stopwords and one-char tokens drop unless that would leave nothing.
 */
export function queryNeedles(q: string): string[] {
  const raw: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    if (m[1] !== undefined) {
      const phrase = m[1].trim().toLowerCase();
      if (phrase) raw.push(phrase);
    } else {
      const token = trimEdges(m[2].toLowerCase());
      if (token) raw.push(token);
    }
  }
  const significant = raw.filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return significant.length > 0 ? significant : raw;
}

/** Strip leading/trailing punctuation, keeping path, handle and identifier characters. */
function trimEdges(token: string): string {
  return token
    .replace(/^["'`([{<*~,;:!?.]+/, '')
    .replace(/["'`)\]}>*~,;:!?.]+$/, '');
}

/**
 * Scored full-text search over handle, name, kind/type, `summary`, `path`,
 * `code_refs`, body, and appended notes.
 *
 * Matching is AND: every significant needle must appear somewhere on the card.
 * Scoring only orders the cards that already matched — handle matches dominate,
 * body/note occurrences break ties.
 */
export function searchCards(
  index: PlanIndex,
  q: string,
  types?: TypeName[],
): SearchHit[] {
  const needles = queryNeedles(q);
  if (needles.length === 0) return [];
  return andHits(scorePlan(index, needles, types).candidates, needles);
}

/**
 * `searchCards` plus the dead-end fallback: when no card carries EVERY needle,
 * the same needles run again as OR, so an over-specified query lands on the
 * neighborhood instead of a bare zero (and agents stop learning to
 * under-specify). A relaxed result names the needles no card carries at all and
 * ranks by how many needles a card matched before falling back to the AND score.
 * Nothing changes when the AND pass matched at least one card.
 */
export function searchPlan(
  index: PlanIndex,
  q: string,
  types?: TypeName[],
): SearchResult {
  const needles = queryNeedles(q);
  if (needles.length === 0) return { hits: [], needles, relaxed: false, unmatched: [] };
  const { candidates, present } = scorePlan(index, needles, types);
  // Plan-wide, filters ignored: a term is worth dropping only when NOTHING in
  // the plan carries it. Scoped to the filtered candidates it would tell an
  // agent to drop the very word that names what it is looking for, just because
  // the card carrying it is of another type.
  const unmatched = needles.filter((_, i) => !present[i]);
  const strict = andHits(candidates, needles);
  if (strict.length > 0 || needles.length < 2) {
    return { hits: strict, needles, relaxed: false, unmatched };
  }
  const hits = [...candidates]
    .sort(
      (a, b) =>
        b.matchedCount - a.matchedCount ||
        b.score - a.score ||
        a.card.handle.localeCompare(b.card.handle),
    )
    .map((c) => toHit(c, needles));
  return { hits, needles, relaxed: true, unmatched };
}

/** A candidate card: its score plus which needles it matched. */
interface ScoredCard {
  card: Card;
  score: number;
  /** The card's searchable prose, kept so an excerpt can be cut from it later. */
  text: string;
  /** Per-needle, in query order. */
  matched: boolean[];
  matchedCount: number;
}

interface ScoredPlan {
  /** Cards that survived the filters and matched at least one needle, unsorted. */
  candidates: ScoredCard[];
  /** Per-needle: does ANY card in the plan carry it, filters ignored? */
  present: boolean[];
}

/**
 * Score the plan once: the filtered candidate set, plus which needles exist
 * anywhere in the plan. Needle presence is recorded BEFORE a filter discards a
 * card, so `unmatched` stays a statement about the plan while hit selection
 * stays filtered.
 */
function scorePlan(
  index: PlanIndex,
  needles: string[],
  types?: TypeName[],
): ScoredPlan {
  const typeFilter = types && types.length > 0 ? new Set(types) : null;

  const candidates: ScoredCard[] = [];
  const present: boolean[] = needles.map(() => false);
  for (const card of index.cards.values()) {
    const included = !typeFilter || typeFilter.has(card.type);
    // A filtered-out card is still scored while some needle is unaccounted for;
    // once every needle is known present it has nothing left to tell us.
    if (!included && present.every(Boolean)) continue;

    const handle = card.handle.toLowerCase();
    const name = (card.name ?? '').toLowerCase();
    const bound = boundValues(card);
    const text = cardText(card);
    const searchable = `${handle}\n${name}\n${card.kind ?? ''}\n${card.type}\n${text}`
      .toLowerCase();

    let score = 0;
    let matchedCount = 0;
    const matched: boolean[] = [];
    for (const needle of needles) {
      let hit = false;
      if (handle === needle) {
        score += 12;
        hit = true;
      } else if (handle.includes(needle)) {
        score += 6;
        hit = true;
      }
      if (name.includes(needle)) {
        score += 4;
        hit = true;
      }
      if (card.kind?.toLowerCase() === needle || card.type.toLowerCase() === needle) {
        score += 2;
        hit = true;
      }
      // A card that BINDS the queried path outranks one that mentions it in prose.
      if (bound.some((b) => b === needle)) {
        score += 10;
        hit = true;
      } else if (bound.some((b) => b.includes(needle))) {
        score += 3;
        hit = true;
      }
      const occurrences = countOccurrences(searchable, needle);
      score += Math.min(occurrences, 5);
      if (occurrences > 0) hit = true;
      matched.push(hit);
      if (hit) matchedCount += 1;
    }
    for (let i = 0; i < needles.length; i += 1) {
      if (matched[i]) present[i] = true;
    }
    if (!included) continue;
    if (matchedCount === 0 || score === 0) continue;

    candidates.push({ card, score, text, matched, matchedCount });
  }
  return { candidates, present };
}

/** The AND pass: cards that matched every needle, in the canonical ranked order. */
function andHits(candidates: ScoredCard[], needles: string[]): SearchHit[] {
  return candidates
    .filter((c) => c.matchedCount === needles.length)
    .sort((a, b) => b.score - a.score || a.card.handle.localeCompare(b.card.handle))
    .map((c) => toHit(c, needles));
}

/** Cut the excerpt here, not while scoring — only returned hits pay for it. */
function toHit(scored: ScoredCard, needles: string[]): SearchHit {
  return {
    card: scored.card,
    score: scored.score,
    excerpt: makeExcerpt(scored.text, needles),
  };
}

/**
 * Searchable prose: `summary`/`path`/`code_refs` frontmatter, body, then notes —
 * as readable lines so the excerpt can quote whichever matched.
 */
function cardText(card: Card): string {
  const lines: string[] = [];
  const fm = card.frontmatter;
  if (typeof fm.summary === 'string' && fm.summary.trim()) {
    lines.push(`summary: ${fm.summary}`);
  }
  if (typeof fm.path === 'string' && fm.path.trim()) {
    lines.push(`path: ${fm.path}`);
  }
  const refs = Array.isArray(fm.code_refs)
    ? fm.code_refs.filter((r): r is string => typeof r === 'string')
    : [];
  if (refs.length > 0) lines.push(`code_refs: ${refs.join(', ')}`);
  lines.push(card.body);
  lines.push(...noteLinesOf(card));
  return lines.join('\n');
}

/** The card's own binding values — its `path` and each `code_ref` path, lowercased. */
function boundValues(card: Card): string[] {
  const out: string[] = [];
  const fm = card.frontmatter;
  if (typeof fm.path === 'string' && fm.path.trim()) out.push(fm.path.trim().toLowerCase());
  if (Array.isArray(fm.code_refs)) {
    for (const ref of fm.code_refs) {
      if (typeof ref !== 'string' || !ref.trim()) continue;
      out.push(ref.trim().toLowerCase());
      const colon = ref.indexOf(':');
      if (colon > 0) out.push(ref.slice(0, colon).trim().toLowerCase());
    }
  }
  return out;
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

function makeExcerpt(body: string, needles: string[]): string {
  const lines = body.split('\n');
  const hit =
    lines.find((line) => {
      const lower = line.toLowerCase();
      return needles.some((t) => lower.includes(t));
    }) ?? lines.find((line) => line.trim().length > 0);
  return (hit ?? '').trim().slice(0, 160);
}
