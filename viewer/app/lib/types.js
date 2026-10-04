import { t } from './i18n.js';

/**
 * Card-type metadata for the viewer: plan folder and the sidebar group each of
 * the 21 types belongs to. Ported from the Svelte viewer's `lib/types.ts`.
 *
 * Words are not here: a type's display name is the locale key
 * `types.<folder>.name` ("API endpoints"), its in-sentence noun is
 * `types.<folder>.single` ("API endpoint"), and a group's heading is
 * `types.group.<id>`. Read them through typeLabel() / typeSingular() /
 * groupLabel() below, at render time — never at module load.
 */
export const TYPE_META = {
  PLAN: { folder: 'plan', group: 'overview' },
  FEATURE: { folder: 'feature', group: 'overview' },
  RELEASE: { folder: 'release', group: 'overview' },
  DIAGRAM: { folder: 'diagram', group: 'overview' },
  DOC: { folder: 'doc', group: 'overview' },
  DECISION: { folder: 'decision', group: 'overview' },
  AGENT: { folder: 'agent', group: 'overview' },
  API: { folder: 'api', group: 'system' },
  DB: { folder: 'db', group: 'system' },
  DATATYPE: { folder: 'datatype', group: 'system' },
  EVENT: { folder: 'event', group: 'system' },
  JOB: { folder: 'job', group: 'system' },
  FLOW: { folder: 'flow', group: 'system' },
  STATE: { folder: 'state', group: 'system' },
  ROLE: { folder: 'role', group: 'system' },
  EXTERNAL: { folder: 'external', group: 'system' },
  PAGE: { folder: 'page', group: 'interface' },
  COMPONENT: { folder: 'component', group: 'interface' },
  STYLE: { folder: 'style', group: 'interface' },
  FILE: { folder: 'file', group: 'code' },
  TEST: { folder: 'test', group: 'code' },
};

/** Sidebar group order (ids; `groupLabel(id)` is the heading). */
export const GROUPS = ['overview', 'system', 'interface', 'code'];

/** A type's display name in the active locale ("API endpoints"); the type itself when unknown. */
export function typeLabel(type) {
  const folder = TYPE_META[type]?.folder;
  return folder ? t(`types.${folder}.name`) : String(type ?? '');
}

/** One card of a type as an in-sentence noun ("API endpoint"); the type itself when unknown. */
export function typeSingular(type) {
  const folder = TYPE_META[type]?.folder;
  return folder ? t(`types.${folder}.single`) : String(type ?? '');
}

/** A sidebar group's heading in the active locale. */
export function groupLabel(group) {
  return t(`types.group.${group}`);
}

/**
 * Building silhouette per card type, for the atlas. A city is only readable if
 * you can name a thing by its shape from across the map, so each shape is the
 * one people already read that way: a DB is the cylinder everyone draws for a
 * store, an EVENT is an antenna because it broadcasts, a TEST is scaffolding
 * because it wraps something else.
 *
 * The renderers switch on these, so a new shape here needs a case in BOTH
 * atlas-iso.js and atlas-three.js — and if it has none it draws as a box, which
 * is wrong-looking rather than broken.
 *
 * `plate` and `offmap` are not buildings: a FILE is the ground a card sits on,
 * and an EXTERNAL lives outside the city limits across a dashed boundary.
 */
export const TYPE_SHAPE = {
  DB: 'cylinder',
  API: 'portal',
  PAGE: 'block',
  COMPONENT: 'block',
  STYLE: 'block',
  JOB: 'plant',
  EVENT: 'beacon',
  EXTERNAL: 'offmap',
  FILE: 'plate',
  DOC: 'monument',
  DECISION: 'monument',
  TEST: 'scaffold',
  FLOW: 'road',
  AGENT: 'figure',
  DATATYPE: 'prism',
  STATE: 'prism',
  ROLE: 'figure',
  PLAN: 'monument',
  FEATURE: 'block',
  RELEASE: 'monument',
  DIAGRAM: 'monument',
};

/** Silhouette for a card type; `block` for anything unmapped. */
export function shapeForType(type) {
  return TYPE_SHAPE[type] ?? 'block';
}

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
