import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { codeRootFor } from './repos.js';
import type { Card, PlanIndex } from './types.js';

/**
 * Code binding + attach. A card points at code two ways: a directly-connected
 * FILE card (its `path:`, the primary binding) or the card's own `code_refs`
 * (optional precision binding, `path` or `path:symbol`). Both resolve here.
 *
 * Cards never connect across repos (a Constellation invariant), so bound code is
 * always in the card's OWN code root — the folder containing constellation/, or
 * PLAN-PROJECT's `code_root`. To read a sibling repo's code, target that repo's
 * plan with the `repo` selector.
 */

export interface BoundPath {
  /** Code-root-relative path. */
  path: string;
  via: 'file-card' | 'code_ref';
  /** FILE card handle, when bound via a connected FILE card. */
  handle?: string;
  /** Symbol hint, when a code_ref was written `path:symbol`. Informational. */
  symbol?: string;
}

/**
 * Code-root-relative bound paths as written in cards (`tests/`, `src\\lib`) so
 * prefix matching and equality agree. Trailing slashes drop; `\\` becomes `/`.
 */
export function normalizeBoundPath(p: string): string {
  const unix = p.replace(/\\/g, '/').trim();
  const trimmed = unix.replace(/\/+$/, '');
  return trimmed || unix;
}

/**
 * True when two bound paths name the same file, or one is a directory that
 * contains the other. `src/api` overlaps `src/api/tickets.ts` and `src/api/`;
 * it does not overlap `src/api-client`.
 */
export function boundPathsOverlap(a: string, b: string): boolean {
  const x = normalizeBoundPath(a);
  const y = normalizeBoundPath(b);
  if (!x || !y) return false;
  return x === y || y.startsWith(`${x}/`) || x.startsWith(`${y}/`);
}

/** Every distinct file a card is bound to (connected FILE paths + own code_refs). */
export function boundPathsForCard(index: PlanIndex, card: Card): BoundPath[] {
  const out: BoundPath[] = [];
  const seen = new Set<string>();
  const add = (p: string, b: Omit<BoundPath, 'path'>) => {
    const n = normalizeBoundPath(p);
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push({ path: n, ...b });
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
  /**
   * The bound path is a DIRECTORY, not a file. A card may bind a whole folder
   * (`code_refs: [tests]`) when the unit it describes is the folder — the
   * binding is real, so it must not read as a missing file. Contents are never
   * attached for one (bind files for that); drift over a directory is the union
   * of its contents changing, which `computeStaleCards` resolves by prefix.
   */
  dir?: boolean;
  bytes?: number;
  /** Attached file contents (mode "direct" only, when not skipped). */
  content?: string;
  /** Set when the file was over the per-file cap and only its head was attached. */
  truncated?: boolean;
  /** Why contents were not attached (missing, binary, lockfile, budget). */
  skipped?: string;
}

export interface CodeResolution {
  /** Code root the paths resolve against. Kept as repo_root for API compatibility. */
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

/** First `max` bytes of a file, without loading the rest into memory. */
async function readCapped(abs: string, max: number): Promise<Buffer> {
  const fh = await open(abs);
  try {
    const buf = Buffer.alloc(max);
    const { bytesRead } = await fh.read(buf, 0, max, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/**
 * Resolve a card's bound code. mode "paths" returns existence-checked paths
 * (cheap; the agent Reads what it wants); mode "direct" also attaches file
 * contents under per-file and total size caps, skipping binaries, lockfiles,
 * and generated output. A file over the per-file cap attaches its head with
 * `truncated: true` rather than being skipped.
 */
export async function resolveCodeForCard(
  planRoot: string,
  index: PlanIndex,
  card: Card,
  mode: 'paths' | 'direct',
  options: { codeRoot?: string | null } = {},
): Promise<CodeResolution> {
  const bound = boundPathsForCard(index, card);
  // Reading PLAN-PROJECT for the code root is shared by batch callers
  // (computeStaleCards, assemble), which resolve once and pass it in.
  let codeRoot: string | null = null;
  if (options.codeRoot !== undefined) {
    codeRoot = options.codeRoot;
  } else {
    try {
      codeRoot = await codeRootFor(await realpath(planRoot));
    } catch {
      codeRoot = null;
    }
  }
  // Canonical code root for the symlink-escape check below.
  const realCodeRoot = codeRoot ? await realpath(codeRoot).catch(() => codeRoot) : null;
  const escapes = (real: string) =>
    realCodeRoot !== null && real !== realCodeRoot && !real.startsWith(realCodeRoot + path.sep);

  const files: CodeFile[] = [];
  const missing: string[] = [];
  let total = 0;
  let budgetExhausted = false;

  for (const b of bound) {
    const abs = codeRoot ? path.resolve(codeRoot, b.path) : null;
    // Containment: a bound path with `..` must not escape the code root and read
    // arbitrary files. Reject anything resolving outside, in every mode.
    const inside =
      abs !== null && codeRoot !== null
        ? abs === codeRoot || abs.startsWith(codeRoot + path.sep)
        : false;
    if (abs !== null && !inside) {
      files.push({ ...b, exists: false, skipped: 'outside code root' });
      continue;
    }

    let exists = false;
    let isDir = false;
    let bytes: number | undefined;
    if (abs) {
      try {
        const s = await stat(abs);
        isDir = s.isDirectory();
        exists = s.isFile() || isDir;
        // A directory's `size` is the inode's, not its contents' — reporting it
        // would read as a file size. Leave it unset.
        if (!isDir) bytes = s.size;
      } catch {
        exists = false;
      }
    }
    // Symlink containment: a file inside the code root may itself be a symlink pointing
    // OUT of it; lexical containment can't catch that. Resolve the real path and
    // refuse anything that leaves the tree (in both modes — the path is reported either way).
    if (exists && abs) {
      try {
        if (escapes(await realpath(abs))) {
          files.push({ ...b, exists: false, skipped: 'symlink escapes code root' });
          continue;
        }
      } catch {
        files.push({ ...b, exists: false, skipped: 'unresolvable' });
        continue;
      }
    }
    if (!exists) missing.push(b.path);

    const file: CodeFile = { ...b, exists, bytes };
    if (isDir) file.dir = true;

    if (mode === 'direct') {
      if (!exists) {
        file.skipped = 'missing';
      } else if (isDir) {
        // Attaching a whole folder would blow the budget on the first ref and
        // give the agent no way to say which parts it wanted. The path is
        // reported; bind the files that matter to get their contents.
        file.skipped = 'directory';
      } else {
        const reason = skipReason(b.path);
        const attachBytes = Math.min(bytes ?? 0, PER_FILE_MAX);
        if (reason) {
          file.skipped = reason;
        } else if (total + attachBytes > TOTAL_MAX) {
          file.skipped = 'total budget exhausted';
          budgetExhausted = true;
        } else {
          try {
            const buf = await readCapped(abs!, PER_FILE_MAX);
            if (buf.includes(0)) {
              file.skipped = 'binary';
            } else {
              // Cutting at a byte boundary may split a multibyte char at the
              // very end; a single replacement char there is acceptable.
              file.content = buf.toString('utf8');
              total += buf.length;
              if ((bytes ?? 0) > PER_FILE_MAX) file.truncated = true;
            }
          } catch {
            file.skipped = 'unreadable';
          }
        }
      }
    }
    files.push(file);
  }

  return { repo_root: codeRoot, files, total_bytes: total, budget_exhausted: budgetExhausted, missing };
}

/** Size of one card's bound code. */
export interface CodeMetric {
  files: number;
  bytes: number;
  lines: number;
}

// A card may bind a whole folder, so the walk is unbounded in principle (`src`,
// or the repo root itself). These caps keep one card's measurement bounded no
// matter what it points at — a partial count beats hanging the server.
const METRIC_MAX_FILES = 1500;
const METRIC_MAX_DEPTH = 12;
const WALK_SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.git', 'vendor',
]);

/** Add one file to a card's totals. Anything unreadable simply doesn't count. */
async function measureFile(abs: string, rel: string, m: CodeMetric): Promise<void> {
  // Binaries and generated blobs contribute their size but are never opened —
  // "lines" is meaningless for them and the bytes are the whole point.
  if (skipReason(rel)) {
    const s = await stat(abs).catch(() => null);
    if (s?.isFile()) {
      m.files += 1;
      m.bytes += s.size;
    }
    return;
  }
  const buf = await readFile(abs).catch(() => null);
  if (!buf) return;
  m.files += 1;
  m.bytes += buf.length;
  for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) m.lines += 1;
}

async function walkDir(
  abs: string,
  rel: string,
  m: CodeMetric,
  depth: number,
  budget: { left: number },
): Promise<void> {
  if (depth > METRIC_MAX_DEPTH || budget.left <= 0) return;
  const entries = await readdir(abs, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (budget.left <= 0) return;
    // Symlinks are neither file nor directory here, which is the point: they
    // can loop, and they can leave the repo.
    if (entry.isDirectory()) {
      if (WALK_SKIP_DIRS.has(entry.name)) continue;
      await walkDir(
        path.join(abs, entry.name),
        `${rel}/${entry.name}`,
        m,
        depth + 1,
        budget,
      );
    } else if (entry.isFile()) {
      budget.left -= 1;
      await measureFile(path.join(abs, entry.name), `${rel}/${entry.name}`, m);
    }
  }
}

/**
 * Size of every card's bound code, keyed by handle — the atlas's "size" lens.
 * Cards with no binding are absent (not zero): unbound is a different thing
 * from bound-and-empty. A card whose bound paths have all moved away reports
 * zeros, which is itself the signal.
 */
export async function codeMetrics(index: PlanIndex): Promise<Record<string, CodeMetric>> {
  let codeRoot: string;
  try {
    codeRoot = await codeRootFor(await realpath(index.root));
  } catch {
    return {};
  }
  const realCodeRoot = await realpath(codeRoot).catch(() => codeRoot);
  const escapes = (real: string) =>
    real !== realCodeRoot && !real.startsWith(realCodeRoot + path.sep);

  const out: Record<string, CodeMetric> = {};
  for (const card of index.cards.values()) {
    const bound = boundPathsForCard(index, card);
    if (bound.length === 0) continue;
    const m: CodeMetric = { files: 0, bytes: 0, lines: 0 };
    const budget = { left: METRIC_MAX_FILES };
    for (const b of bound) {
      const abs = path.resolve(codeRoot, b.path);
      // Same containment rule as resolveCodeForCard: a `..` path must not report
      // on files outside the code root, sizes included.
      if (abs !== codeRoot && !abs.startsWith(codeRoot + path.sep)) continue;
      const s = await stat(abs).catch(() => null);
      if (!s) continue;
      const real = await realpath(abs).catch(() => null);
      if (!real || escapes(real)) continue;
      if (s.isDirectory()) await walkDir(abs, b.path, m, 0, budget);
      else if (s.isFile()) {
        budget.left -= 1;
        await measureFile(abs, b.path, m);
      }
    }
    out[card.handle] = m;
  }
  return out;
}
