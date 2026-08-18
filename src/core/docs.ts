import type { Card, PlanIndex, TypeName } from './types.js';

/**
 * Compile the plan's cards into ONE ordered document — the thing `/docs`
 * renders and prints. Membership is self-declared (`section:` on the card),
 * section ORDER is authored once on PLAN-PROJECT (`doc_sections`), and position
 * inside a section comes from `order:`. Nothing here is stored: the document is
 * derived on every load like every other view of the graph.
 *
 * This module is the single source of ordering for every consumer. Heading
 * levels and link resolution are RENDER concerns — `prepareDocBody` below is
 * the render half, deliberately separate from the tree so a consumer that wants
 * the raw bodies can still have them.
 */

export interface DocCard {
  handle: string;
  /** The card's display name — rendered as its heading in the document. */
  name: string;
  type: TypeName;
  /** The card's body, exactly as written. */
  body: string;
  /**
   * The card's frontmatter, so the document can render a card's STRUCTURE and
   * not just its prose — a STYLE card's swatches and specimens are the content,
   * and a document that printed only its body would be missing the point of it.
   */
  frontmatter: Record<string, unknown>;
}

export interface DocSection {
  /** The slug cards carry as `section:`. */
  id: string;
  name: string;
  summary: string;
  cards: DocCard[];
}

interface DeclaredSection {
  id: string;
  name: string;
  summary: string;
}

/**
 * A card's section. Any non-empty string groups, not just a well-formed slug:
 * a typo'd `section: Getting Started` should show up in the document (where it
 * is obvious and fixable) rather than vanish — the schema's W002 is what says
 * it isn't a slug.
 */
function sectionOf(card: Card): string {
  const raw = card.frontmatter.section;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** A card's position in its section; unset sorts after every numbered card. */
function orderOf(card: Card): number {
  const raw = card.frontmatter.order;
  return typeof raw === 'number' && Number.isFinite(raw)
    ? raw
    : Number.POSITIVE_INFINITY;
}

/** `getting-started` → `Getting Started`, for a section nobody registered. */
function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** PLAN-PROJECT's `doc_sections`, lenient: a malformed entry is skipped. */
function declaredSections(project: Card | undefined): DeclaredSection[] {
  const list = project?.frontmatter.doc_sections;
  if (!Array.isArray(list)) return [];
  const out: DeclaredSection[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id.trim()) continue;
    out.push({
      id: e.id.trim(),
      name: typeof e.name === 'string' && e.name ? e.name : titleFromSlug(e.id.trim()),
      summary: typeof e.summary === 'string' ? e.summary : '',
    });
  }
  return out;
}

/** `order`, then `name`, then handle — a total order, so the document is stable. */
function byDocOrder(a: Card, b: Card): number {
  const orderA = orderOf(a);
  const orderB = orderOf(b);
  if (orderA !== orderB) return orderA < orderB ? -1 : 1;
  const nameCompare = (a.name ?? a.handle).localeCompare(b.name ?? b.handle);
  return nameCompare !== 0 ? nameCompare : a.handle.localeCompare(b.handle);
}

function toDocCard(card: Card): DocCard {
  return {
    handle: card.handle,
    name: card.name ?? card.handle,
    type: card.type,
    body: card.body,
    frontmatter: card.frontmatter,
  };
}

/**
 * The document, in author-intended order: registered sections first in the
 * order PLAN-PROJECT lists them, then any slug that appears on cards but was
 * never registered, appended alphabetically with a name title-cased from the
 * slug. Forgetting to register a section is not an error — the section still
 * reads, just at the end.
 *
 * A registered section with no cards is dropped: it would render as a heading
 * over nothing, in the viewer and on paper alike.
 */
export function compileDocs(index: PlanIndex): DocSection[] {
  const members = new Map<string, Card[]>();
  for (const card of index.cards.values()) {
    const id = sectionOf(card);
    if (!id) continue;
    const existing = members.get(id);
    if (existing) existing.push(card);
    else members.set(id, [card]);
  }
  if (members.size === 0) return [];

  const sections: DocSection[] = [];
  const placed = new Set<string>();

  for (const declared of declaredSections(index.cards.get('PLAN-PROJECT'))) {
    if (placed.has(declared.id)) continue;
    placed.add(declared.id);
    const cards = members.get(declared.id);
    if (!cards) continue;
    sections.push({ ...declared, cards: cards.sort(byDocOrder).map(toDocCard) });
  }

  const unregistered = [...members.keys()].filter((id) => !placed.has(id)).sort();
  for (const id of unregistered) {
    sections.push({
      id,
      name: titleFromSlug(id),
      summary: '',
      cards: members.get(id)!.sort(byDocOrder).map(toDocCard),
    });
  }

  return sections;
}

const FENCE = /^(```+|~~~+)/;

/**
 * Push every ATX heading in a body down `by` levels, capped at h6. Fenced
 * blocks are skipped WHOLE — a `# comment` inside a bash fence is a comment,
 * not a heading, and rewriting it would corrupt the code (the same
 * fence-skipping the board's `summaryOf` does).
 */
export function shiftHeadings(body: string, by = 2): string {
  let fence = '';
  return body
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      const delimiter = FENCE.exec(trimmed)?.[1];

      if (fence) {
        // Inside a fence: only its own closing delimiter is meaningful.
        if (delimiter && trimmed.startsWith(fence)) fence = '';
        return line;
      }
      if (delimiter) {
        fence = delimiter;
        return line;
      }

      const heading = /^(#{1,6})(\s)/.exec(line);
      if (!heading) return line;
      const level = Math.min(6, heading[1].length + by);
      return '#'.repeat(level) + line.slice(heading[1].length);
    })
    .join('\n');
}

/**
 * Drop a leading H1 that just restates the card's `name:`. Many cards open that
 * way, and in the compiled document the name is already the card's heading — so
 * shifting the line would print the title twice. The comparison is loose
 * (trimmed, case-insensitive) because the two are written by hand.
 */
export function stripTitleHeading(body: string, name: string): string {
  const label = name.trim().toLowerCase();
  if (!label) return body;
  const opening = /^\s*#[ \t]+(.+?)[ \t]*(?:\n|$)/.exec(body);
  if (!opening || opening[1].trim().toLowerCase() !== label) return body;
  return body.slice(opening[0].length).replace(/^\n+/, '');
}

/**
 * A card's body as it enters the document: the duplicate title dropped, its own
 * headings pushed two levels down so the card's `##` lands under the `###` the
 * document gives its name. Heading levels are ASSIGNED, never trusted.
 */
export function prepareDocBody(body: string, name: string): string {
  return shiftHeadings(stripTitleHeading(body, name), 2);
}
