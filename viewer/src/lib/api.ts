import { notice, plan } from './state.svelte';
import type { Issue } from './types';

interface WriteResult {
  ok: boolean;
  issues?: Issue[];
}

async function write(path: string, method: string, body?: unknown): Promise<WriteResult> {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 409) {
    notice.show('changed on disk — reloaded');
    await plan.load();
    return { ok: false };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    notice.show(data.error?.message ?? 'save failed');
    return { ok: false };
  }

  const issues: Issue[] = data.issues ?? [];
  if (issues.length > 0) {
    notice.show(issues.map((i) => `${i.code} ${i.message}`).join(' · '));
  }
  // SSE will also fire, but refetch eagerly so the UI updates instantly.
  await plan.load();
  return { ok: true, issues };
}

export interface CardPatch {
  name?: string | null;
  kind?: string | null;
  status?: string | null;
  connections?: string[] | null;
  fields?: Record<string, unknown>;
  body?: string;
  if_mtime?: number;
}

export function patchCard(handle: string, patch: CardPatch): Promise<WriteResult> {
  return write(`/api/card/${handle}`, 'PATCH', patch);
}

export function createCard(input: {
  handle: string;
  name?: string;
  body?: string;
}): Promise<WriteResult> {
  return write('/api/cards', 'POST', input);
}

export function deleteCard(handle: string): Promise<WriteResult> {
  return write(`/api/card/${handle}`, 'DELETE');
}
