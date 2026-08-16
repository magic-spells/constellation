import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isHandleShaped,
  isKnownHandle,
  typeForHandle,
  TYPE_FOLDERS,
} from './handles.js';
import { parseFile } from './parse.js';
import {
  extractFrontmatterRefs,
  extractMermaidRefs,
  extractWikiLinks,
} from './extract.js';
import type { Card, Connection, Issue, PlanIndex } from './types.js';

/** Load a plan folder into an index: cards, edges, and structural issues. */
export async function loadPlan(root: string): Promise<PlanIndex> {
  const absRoot = path.resolve(root);
  const issues: Issue[] = [];
  const cards = new Map<string, Card>();

  for (const relPath of await listMarkdownFiles(absRoot)) {
    const filePath = path.join(absRoot, relPath);
    const raw = await readFile(filePath, 'utf8');
    const card = readCard(relPath, filePath, raw, issues);
    if (!card) continue;

    const existing = cards.get(card.handle);
    if (existing) {
      issues.push({
        severity: 'error',
        code: 'E003',
        message: `Duplicate handle ${card.handle} (also defined in ${existing.relPath})`,
        file: relPath,
      });
      continue;
    }
    cards.set(card.handle, card);
  }

  resolveRefs(cards, issues);
  const connections = buildConnections(cards);

  return {
    root: absRoot,
    cards,
    connections,
    connectedHandles: adjacency(connections),
    issues,
  };
}

/** handle -> neighbors, both directions, over the given connections. */
function adjacency(connections: Connection[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const conn of connections) {
    if (!map.has(conn.a)) map.set(conn.a, new Set());
    if (!map.has(conn.b)) map.set(conn.b, new Set());
    map.get(conn.a)!.add(conn.b);
    map.get(conn.b)!.add(conn.a);
  }
  return map;
}

/** A card's neighbors in the connection graph — the whole graph, as the viewer draws it. */
export function neighborsOf(index: PlanIndex, handle: string): Set<string> {
  return index.connectedHandles.get(handle) ?? new Set();
}

function readCard(
  relPath: string,
  filePath: string,
  raw: string,
  issues: Issue[],
): Card | null {
  // The one special file: plan.md at the plan root is PLAN-PROJECT.
  const isRootPlan = relPath === 'plan.md';
  const handle = isRootPlan ? 'PLAN-PROJECT' : path.basename(relPath, '.md');

  if (!isHandleShaped(handle)) {
    issues.push({
      severity: 'error',
      code: 'E001',
      message: `Filename is not a valid handle: ${handle}`,
      file: relPath,
    });
    return null;
  }

  const type = typeForHandle(handle);
  if (!type) {
    issues.push({
      severity: 'error',
      code: 'E002',
      message: `Unknown handle prefix: ${handle.split('-')[0]}- (expected one of the 21 canonical prefixes)`,
      file: relPath,
    });
    return null;
  }

  const parsed = parseFile(raw);
  if (parsed.yamlError) {
    issues.push({
      severity: 'error',
      code: 'E006',
      message: `Invalid YAML frontmatter: ${parsed.yamlError}`,
      file: relPath,
    });
  }

  if (!isRootPlan) {
    const folder = relPath.includes(path.sep) ? relPath.split(path.sep)[0] : '';
    const expected = TYPE_FOLDERS[type];
    if (folder !== expected) {
      issues.push({
        severity: 'warning',
        code: 'W001',
        message: `${handle} is a ${type} card and belongs in ${expected}/`,
        file: relPath,
      });
    }
  }

  const fm = parsed.frontmatter;
  const connections: string[] = [];
  if (fm.connections !== undefined) {
    const list = Array.isArray(fm.connections) ? fm.connections : null;
    if (list === null) {
      issues.push({
        severity: 'error',
        code: 'E004',
        message: `connections must be a list of handles`,
        file: relPath,
      });
    } else {
      for (const entry of list) {
        if (typeof entry === 'string' && isKnownHandle(entry)) {
          if (entry !== handle) connections.push(entry);
        } else {
          issues.push({
            severity: 'error',
            code: 'E004',
            message: `connections entry is not a valid handle: ${JSON.stringify(entry)}`,
            file: relPath,
          });
        }
      }
    }
  }

  return {
    handle,
    type,
    relPath,
    filePath,
    frontmatter: fm,
    body: parsed.body,
    name: typeof fm.name === 'string' ? fm.name : undefined,
    kind: typeof fm.kind === 'string' ? fm.kind : undefined,
    status: typeof fm.status === 'string' ? fm.status : undefined,
    refs: {
      connections: [...new Set(connections)],
      frontmatter: extractFrontmatterRefs(fm, handle),
      body: extractWikiLinks(parsed.body),
      mermaid: extractMermaidRefs(parsed.body),
    },
  };
}

function resolveRefs(cards: Map<string, Card>, issues: Issue[]): void {
  for (const card of cards.values()) {
    // Structured references are contracts: missing targets are errors.
    for (const target of [...card.refs.connections, ...card.refs.frontmatter]) {
      if (!cards.has(target)) {
        issues.push({
          severity: 'error',
          code: 'E005',
          message: `Reference to ${target} does not resolve to a card`,
          file: card.relPath,
        });
      }
    }
    // Prose links are hyperlinks, not edges, and may point at cards not yet
    // written — a dangling one is still a dead link, so: warning, never error.
    for (const target of [...card.refs.body, ...card.refs.mermaid]) {
      if (target !== card.handle && !cards.has(target)) {
        issues.push({
          severity: 'warning',
          code: 'W004',
          message: `Body reference [[${target}]] does not resolve to a card`,
          file: card.relPath,
        });
      }
    }
  }
}

/**
 * Undirected, deduped edges — from FRONTMATTER ONLY: the `connections:` list and
 * handle-shaped values in other frontmatter fields. A `[[HANDLE]]` body link or a
 * mermaid node ID is a hyperlink and a pointer for readers, never an edge: the
 * graph is the set of relationships an author declared on purpose. Declaring the
 * same edge from both sides still yields exactly one connection. This changes
 * nothing about lint: E005 vs W004 is still decided per-ref in resolveRefs, over
 * link refs that never become an edge.
 */
function buildConnections(cards: Map<string, Card>): Connection[] {
  const byKey = new Map<string, Connection>();
  for (const card of cards.values()) {
    for (const target of [...card.refs.connections, ...card.refs.frontmatter]) {
      if (target === card.handle || !cards.has(target)) continue;
      const [a, b] =
        card.handle < target ? [card.handle, target] : [target, card.handle];
      byKey.set(`${a}\u0000${b}`, { a, b });
    }
  }
  return [...byKey.values()];
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, '');
  return out.sort();

  async function walk(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (rel === '') throw err;
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(relPath);
      }
    }
  }
}
