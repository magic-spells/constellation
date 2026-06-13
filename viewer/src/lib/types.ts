export interface Card {
  handle: string;
  type: string;
  kind: string | null;
  name: string | null;
  status: string | null;
  relPath: string;
  mtime: number;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface Connection {
  a: string;
  b: string;
}

export interface Issue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  file: string;
}

export interface TypeMeta {
  label: string;
  folder: string;
  group: string;
}

export const TYPE_META: Record<string, TypeMeta> = {
  PLAN: { label: 'Plans', folder: 'plan', group: 'Overview' },
  DIAGRAM: { label: 'Architecture', folder: 'diagram', group: 'Overview' },
  DOC: { label: 'Docs', folder: 'doc', group: 'Overview' },
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
  FILE: { label: 'Repo files', folder: 'file', group: 'Code & tests' },
  TEST: { label: 'Tests', folder: 'test', group: 'Code & tests' },
};

export const GROUPS = ['Overview', 'System', 'Interface', 'Code & tests'];

export function typeByFolder(folder: string): string | undefined {
  return Object.keys(TYPE_META).find((t) => TYPE_META[t].folder === folder);
}

const HANDLE = /^[A-Z][A-Z0-9]*-[A-Z0-9][A-Z0-9-]*$/;

export function isHandle(value: string): boolean {
  if (!HANDLE.test(value)) return false;
  return value.split('-')[0] in TYPE_META;
}
