import { isKnownHandle } from './handles.js';

const WIKI_LINK = /\[\[([^\[\]]+)\]\]/g;
const MERMAID_BLOCK = /```mermaid[^\n]*\n([\s\S]*?)```/g;
const HANDLE_TOKEN = /(?<![A-Za-z0-9-])[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*(?![A-Za-z0-9-])/g;

/** [[HANDLE]] wiki-links. Non-handle-shaped link targets are ignored. */
export function extractWikiLinks(body: string): string[] {
  const out: string[] = [];
  for (const match of body.matchAll(WIKI_LINK)) {
    const target = match[1].trim();
    if (isKnownHandle(target)) out.push(target);
  }
  return dedupe(out);
}

/** Handle-shaped identifiers inside ```mermaid fences. */
export function extractMermaidRefs(body: string): string[] {
  const out: string[] = [];
  for (const block of body.matchAll(MERMAID_BLOCK)) {
    for (const token of block[1].matchAll(HANDLE_TOKEN)) {
      if (isKnownHandle(token[0])) out.push(token[0]);
    }
  }
  return dedupe(out);
}

/**
 * Handle-shaped string values anywhere in frontmatter, excluding the
 * `connections` key (collected separately) and the card's own handle.
 */
export function extractFrontmatterRefs(
  frontmatter: Record<string, unknown>,
  ownHandle: string,
): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (key === 'connections') continue;
    walk(value, out);
  }
  return dedupe(out.filter((h) => h !== ownHandle));
}

function walk(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    if (isKnownHandle(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) walk(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) walk(item, out);
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
