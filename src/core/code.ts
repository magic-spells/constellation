import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { repoRootFor } from './git.js';
import type { Card, PlanIndex } from './types.js';

/**
 * Code binding + attach. A card points at code two ways: a directly-connected
 * FILE card (its `path:`, the primary binding) or the card's own `code_refs`
 * (optional precision binding, `path` or `path:symbol`). Both resolve here.
 *
 * Cards never connect across repos (a Constellation invariant), so bound code is
 * always in the card's OWN repo — resolved against the git repo root. To read a
 * sibling repo's code, target that repo's plan with the `repo` selector.
 */

export interface BoundPath {
  /** Repo-relative path. */
  path: string;
  via: 'file-card' | 'code_ref';
  /** FILE card handle, when bound via a connected FILE card. */
  handle?: string;
  /** Symbol hint, when a code_ref was written `path:symbol`. Informational. */
  symbol?: string;
}

/** Every distinct file a card is bound to (connected FILE paths + own code_refs). */
export function boundPathsForCard(index: PlanIndex, card: Card): BoundPath[] {
  const out: BoundPath[] = [];
  const seen = new Set<string>();
  const add = (p: string, b: Omit<BoundPath, 'path'>) => {
    if (!p || seen.has(p)) return;
    seen.add(p);
    out.push({ path: p, ...b });
  };

  // A FILE card is bound to its own path:.
  if (card.type === 'FILE' && typeof card.frontmatter.path === 'string') {
    add(card.frontmatter.path, { via: 'file-card', handle: card.handle });
  }

  for (const handle of [...(index.connectedHandles.get(card.handle) ?? [])].sort()) {
    const neighbor = index.cards.get(handle);
    if (!neighbor || neighbor.type !== 'FILE') continue;
    const p = neighbor.frontmatter.path;
    if (typeof p === 'string') add(p, { via: 'file-card', handle });
  }

  const refs = Array.isArray(card.frontmatter.code_refs) ? card.frontmatter.code_refs : [];
  for (const ref of refs) {
    if (typeof ref !== 'string') continue;
    const colon = ref.indexOf(':');
    const p = colon > 0 ? ref.slice(0, colon) : ref;
    const symbol = colon > 0 ? ref.slice(colon + 1) : undefined;
    add(p, { via: 'code_ref', symbol });
  }
  return out;
}

export interface CodeFile extends BoundPath {
  exists: boolean;
  bytes?: number;
  /** Attached file contents (mode "direct" only, when not skipped). */
  content?: string;
  truncated?: boolean;
  /** Why contents were not attached (missing, binary, lockfile, too large, budget). */
  skipped?: string;
}

export interface CodeResolution {
  /** Git repo root the paths resolve against, or null when not in a git repo. */
  repo_root: string | null;
  files: CodeFile[];
  total_bytes: number;
  budget_exhausted: boolean;
  /** Bound files whose path no longer exists on disk — a drift signal. */
  missing: string[];
}

const PER_FILE_MAX = 64 * 1024;
const TOTAL_MAX = 256 * 1024;

const SKIP_BASENAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json',
  'composer.lock', 'cargo.lock', 'poetry.lock', 'gemfile.lock', 'go.sum',
]);
const SKIP_DIR_RE = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.git|vendor)\//;
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.pdf', '.zip', '.gz',
  '.tar', '.tgz', '.wasm', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mov', '.mp3',
  '.bin', '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.db', '.sqlite',
]);
const GENERATED_RE = /\.min\.(js|css)$|\.map$|\.lock$/;

/** Why a path should not have its contents attached, or null to attach it. */
function skipReason(p: string): string | null {
  const base = path.basename(p).toLowerCase();
  const ext = path.extname(p).toLowerCase();
  if (SKIP_BASENAMES.has(base)) return 'lockfile';
  if (base === '.env' || base.startsWith('.env.') || ext === '.pem' || ext === '.key') {
    return 'secrets';
  }
  if (SKIP_DIR_RE.test(p)) return 'generated/vendored';
  if (BINARY_EXT.has(ext)) return 'binary';
  if (ext === '.snap' || ext === '.tsbuildinfo') return 'generated';
  if (GENERATED_RE.test(p)) return 'generated';
  return null;
}

/**
 * Resolve a card's bound code. mode "paths" returns existence-checked paths
 * (cheap; the agent Reads what it wants); mode "direct" also attaches file
 * contents under per-file and total size caps, skipping binaries, lockfiles,
 * and generated output, with truncation noted.
 */
export async function resolveCodeForCard(
  planRoot: string,
  index: PlanIndex,
  card: Card,
  mode: 'paths' | 'direct',
): Promise<CodeResolution> {
  const bound = boundPathsForCard(index, card);
  let repoRoot: string | null = null;
  try {
    repoRoot = await repoRootFor(await realpath(planRoot));
  } catch {
    repoRoot = null;
  }
  // Canonical repo root for the symlink-escape check below.
  const realRepoRoot = repoRoot ? await realpath(repoRoot).catch(() => repoRoot) : null;
  const escapes = (real: string) =>
    realRepoRoot !== null && real !== realRepoRoot && !real.startsWith(realRepoRoot + path.sep);

  const files: CodeFile[] = [];
  const missing: string[] = [];
  let total = 0;
  let budgetExhausted = false;

  for (const b of bound) {
    const abs = repoRoot ? path.resolve(repoRoot, b.path) : null;
    // Containment: a bound path with `..` must not escape the repo root and read
    // arbitrary files. Reject anything resolving outside, in every mode.
    const inside =
      abs !== null && repoRoot !== null
        ? abs === repoRoot || abs.startsWith(repoRoot + path.sep)
        : false;
    if (abs !== null && !inside) {
      files.push({ ...b, exists: false, skipped: 'outside repo root' });
      continue;
    }

    let exists = false;
    let bytes: number | undefined;
    if (abs) {
      try {
        const s = await stat(abs);
        exists = s.isFile();
        bytes = s.size;
      } catch {
        exists = false;
      }
    }
    // Symlink containment: a file inside the repo may itself be a symlink pointing
    // OUT of it; lexical containment can't catch that. Resolve the real path and
    // refuse anything that leaves the tree (in both modes — the path is reported either way).
    if (exists && abs) {
      try {
        if (escapes(await realpath(abs))) {
          files.push({ ...b, exists: false, skipped: 'symlink escapes repo root' });
          continue;
        }
      } catch {
        files.push({ ...b, exists: false, skipped: 'unresolvable' });
        continue;
      }
    }
    if (!exists) missing.push(b.path);

    const file: CodeFile = { ...b, exists, bytes };

    if (mode === 'direct') {
      if (!exists) {
        file.skipped = 'missing';
      } else {
        const reason = skipReason(b.path);
        if (reason) {
          file.skipped = reason;
        } else if ((bytes ?? 0) > PER_FILE_MAX) {
          file.skipped = `too large (${bytes} > ${PER_FILE_MAX} bytes)`;
        } else if (total + (bytes ?? 0) > TOTAL_MAX) {
          file.skipped = 'total budget exhausted';
          budgetExhausted = true;
        } else {
          try {
            const buf = await readFile(abs!);
            if (buf.includes(0)) {
              file.skipped = 'binary';
            } else {
              file.content = buf.toString('utf8');
              total += buf.length;
            }
          } catch {
            file.skipped = 'unreadable';
          }
        }
      }
    }
    files.push(file);
  }

  return { repo_root: repoRoot, files, total_bytes: total, budget_exhausted: budgetExhausted, missing };
}
