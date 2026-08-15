export const TYPE_NAMES = [
  'API', 'DB', 'DATATYPE', 'ROLE', 'DOC', 'DECISION', 'FILE', 'TEST', 'EXTERNAL',
  'EVENT', 'COMPONENT', 'PAGE', 'JOB', 'FLOW', 'STATE', 'DIAGRAM', 'AGENT', 'PLAN',
  'FEATURE', 'RELEASE', 'STYLE',
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

/**
 * Where a connection came from. `structured` = the `connections:` list or a
 * handle-shaped frontmatter value (a contract — a missing target is E005);
 * `prose` = a `[[HANDLE]]` body link or a mermaid node ID (aspirational — a
 * missing target is only W004). One edge can be both.
 */
export type EdgeSource = 'structured' | 'prose';

/** Which edges a graph walk may travel. */
export type EdgeFilter = 'structured' | 'prose' | 'both';

/** Undirected connection; endpoints are stored in sorted order so each pair is unique. */
export interface Connection {
  a: string;
  b: string;
  /** Provenance, in fixed order: structured before prose. Never empty. */
  sources: EdgeSource[];
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
  /** handle -> set of connected handles (both directions), every source. */
  connectedHandles: Map<string, Set<string>>;
  /** Same, restricted to STRUCTURED edges (connections: + frontmatter values). */
  structuredHandles: Map<string, Set<string>>;
  /** Same, restricted to PROSE edges ([[links]] + mermaid node IDs). */
  proseHandles: Map<string, Set<string>>;
  /** Structural issues found while loading (E001–E006, W001, W004). */
  issues: Issue[];
}
