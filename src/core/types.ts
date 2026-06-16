export const TYPE_NAMES = [
  'API', 'DB', 'DATATYPE', 'ROLE', 'DOC', 'FILE', 'TEST', 'EXTERNAL', 'EVENT',
  'COMPONENT', 'PAGE', 'JOB', 'FLOW', 'STATE', 'DIAGRAM', 'AGENT', 'PLAN',
] as const;

export type TypeName = (typeof TYPE_NAMES)[number];

export interface CardRefs {
  /** Handles listed in the frontmatter `connections` key. */
  connections: string[];
  /** Handle-shaped values found elsewhere in frontmatter (e.g. response_schema). */
  frontmatter: string[];
  /** [[HANDLE]] wiki-links in the body. */
  body: string[];
  /** Handle-shaped identifiers inside ```mermaid blocks. */
  mermaid: string[];
}

export interface Card {
  handle: string;
  type: TypeName;
  /** Path relative to the plan root, e.g. api/API-TICKETS.md */
  relPath: string;
  /** Absolute path on disk. */
  filePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  name?: string;
  kind?: string;
  status?: string;
  refs: CardRefs;
}

/** Undirected connection; endpoints are stored in sorted order so each pair is unique. */
export interface Connection {
  a: string;
  b: string;
}

/**
 * A sibling repo declared in PLAN-PROJECT `connected_repos`. A repo-level link
 * only — never a card connection. The path is local topology (relative to the
 * repo root, or absolute) and is never validated by lint.
 */
export interface ConnectedRepo {
  /** Lowercase id used as the `repo` selector. */
  name: string;
  /** Path to the connected repo's root, relative to this repo's root (or absolute). */
  path: string;
  description?: string;
}

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  /** Path relative to the plan root. */
  file: string;
}

export interface PlanIndex {
  /** Absolute path of the plan root (the constellation/ folder). */
  root: string;
  /** Cards by handle. */
  cards: Map<string, Card>;
  connections: Connection[];
  /** handle -> set of connected handles (both directions). */
  connectedHandles: Map<string, Set<string>>;
  /** Structural issues found while loading (E001–E006, W001, W004). */
  issues: Issue[];
}
