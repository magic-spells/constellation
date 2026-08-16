/**
 * Card-type metadata for the viewer: display label, plan folder, and the
 * sidebar group each of the 21 types belongs to. Ported from the Svelte
 * viewer's `lib/types.ts` (TypeScript interfaces dropped — the runtime values
 * are unchanged).
 */
export const TYPE_META = {
  PLAN: { label: 'Plans', folder: 'plan', group: 'Overview' },
  FEATURE: { label: 'Features', folder: 'feature', group: 'Overview' },
  RELEASE: { label: 'Releases', folder: 'release', group: 'Overview' },
  DIAGRAM: { label: 'Architecture', folder: 'diagram', group: 'Overview' },
  DOC: { label: 'Docs', folder: 'doc', group: 'Overview' },
  DECISION: { label: 'Decisions', folder: 'decision', group: 'Overview' },
  AGENT: { label: 'Agent rules', folder: 'agent', group: 'Overview' },
  API: { label: 'API endpoints', folder: 'api', group: 'System' },
  DB: { label: 'Database', folder: 'db', group: 'System' },
  DATATYPE: { label: 'Data types', folder: 'datatype', group: 'System' },
  EVENT: { label: 'Events', folder: 'event', group: 'System' },
  JOB: { label: 'Jobs', folder: 'job', group: 'System' },
  FLOW: { label: 'Flows', folder: 'flow', group: 'System' },
  STATE: { label: 'State machines', folder: 'state', group: 'System' },
  ROLE: { label: 'Roles', folder: 'role', group: 'System' },
  EXTERNAL: { label: 'External services', folder: 'external', group: 'System' },
  PAGE: { label: 'Pages', folder: 'page', group: 'Interface' },
  COMPONENT: { label: 'Components', folder: 'component', group: 'Interface' },
  STYLE: { label: 'Style guide', folder: 'style', group: 'Interface' },
  FILE: { label: 'Repo files', folder: 'file', group: 'Code & tests' },
  TEST: { label: 'Tests', folder: 'test', group: 'Code & tests' },
};

/** Sidebar group order. */
export const GROUPS = ['Overview', 'System', 'Interface', 'Code & tests'];

/** Folder name → card type (e.g. `api` → `API`); undefined when unknown. */
export function typeForFolder(folder) {
  return Object.keys(TYPE_META).find((t) => TYPE_META[t].folder === folder);
}

/** Old name kept so ports of the Svelte pages read the same. */
export const typeByFolder = typeForFolder;

/** Card type → folder name (e.g. `API` → `api`); undefined when unknown. */
export function folderForType(type) {
  return TYPE_META[type]?.folder;
}

const HANDLE = /^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$/;

/** True when `value` is a handle whose prefix is one of the 21 card types. */
export function isHandle(value) {
  if (!HANDLE.test(value)) return false;
  return value.split('-')[0] in TYPE_META;
}

// Longest name first so a prefix match can never be shadowed by a shorter type
// that happens to start the same way (DATATYPE- is tried before DB-).
const TYPES_LONGEST_FIRST = Object.keys(TYPE_META).sort((a, b) => b.length - a.length);

/**
 * Card type for a handle by longest-prefix match (`DATATYPE-USER` → `DATATYPE`);
 * null when the prefix is not one of the 21 types.
 */
export function typeForHandle(handle) {
  const value = String(handle ?? '').toUpperCase();
  return TYPES_LONGEST_FIRST.find((type) => value.startsWith(`${type}-`)) ?? null;
}

/**
 * The app path a card handle lives at — `/<folder>/<HANDLE>`, mirroring the
 * plan's layout on disk (`constellation/api/API-TICKETS.md` → `/api/API-TICKETS`).
 * A handle with no recognisable type prefix has no card page, so it falls back
 * to the overview. This is the ONE place the path shape is spelled out: build
 * every card href/push through it rather than re-deriving the folder.
 */
export function hrefForHandle(handle) {
  const value = String(handle ?? '').toUpperCase();
  const folder = folderForType(typeForHandle(value));
  return folder ? `/${folder}/${value}` : '/';
}
