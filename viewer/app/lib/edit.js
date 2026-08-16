import { toast } from '../components/ui/toast.js';
import { ApiError, createCard, deleteCard, loadPlan, patchCard, setSyncPoint } from './api.js';

// edit.js — the one place a viewer write turns into user-visible feedback.
//
// Every edit affordance (Editable, StatusSelect, the create/delete dialogs)
// calls through here instead of touching lib/api.js directly, so the mapping
// from a server error code to a toast is written once:
//
//   STALE      the card changed on disk between load and save — the write was
//              refused by the `if_mtime` guard. Reload the plan so the user is
//              looking at the current text, and say so.
//   READONLY   the server runs with --readonly. The UI hides its edit
//              affordances in that mode, so this is the belt-and-braces path
//              (a plan that flipped to read-only under a long-lived tab).
//   anything   the server's own message — INVALID_HANDLE, CARD_EXISTS,
//   else       EMPTY_UPDATE, NOT_FOUND … it always reads well enough to show.
//
// LINT ISSUES ARE NOT FAILURES. A successful write returns the lint issues for
// the file it touched; they surface as an ordinary toast (the Svelte viewer's
// behaviour) because the card was still written.
//
// Callers get `{ ok, value, error }` and never see an exception: a failed save
// leaves the UI where it was, and the toast is the report.

/** Codes a caller wants to handle itself (inline form errors) go here. */
function report(error, quietCodes) {
	const code = error instanceof ApiError ? error.code : '';
	if (quietCodes.includes(code)) return false;

	if (code === 'STALE') {
		toast({ message: 'Card changed on disk — reloaded', variant: 'danger' });
	} else if (code === 'READONLY') {
		toast({ message: 'Viewer is read-only', variant: 'danger' });
	} else {
		toast({ message: error?.message || 'Save failed', variant: 'danger' });
	}
	return true;
}

async function run(store, work, quietCodes = []) {
	try {
		const value = await work();
		const issues = value?.issues ?? [];
		if (issues.length > 0) {
			toast({ message: issues.map((issue) => `${issue.code} ${issue.message}`).join(' · ') });
		}
		return { ok: true, value };
	} catch (error) {
		report(error, quietCodes);
		// The write helpers only reload on success, so a rejected optimistic-lock
		// write has to pull the current file itself.
		if (error instanceof ApiError && error.code === 'STALE') {
			await loadPlan(store).catch(() => {});
		}
		return { ok: false, error };
	}
}

/** PATCH one card. `mtime` is the optimistic-lock baseline (`if_mtime`). */
export function savePatch(store, handle, patch, mtime, quietCodes) {
	return run(store, () => patchCard(store, handle, patch, mtime), quietCodes);
}

/** POST a new card. Pass INVALID_HANDLE / CARD_EXISTS as quiet for inline errors. */
export function saveNewCard(store, payload, quietCodes) {
	return run(store, () => createCard(store, payload), quietCodes);
}

/**
 * Stamp the sync marker at HEAD: "the plan was true at this commit". Not a card
 * write, so it skips `run()` (there are no lint issues to report and nothing to
 * reload) — but it reports through the same `report()` mapping, so a read-only
 * server or a repo with no HEAD reads the same as any other refused write.
 */
export async function stampSyncPoint(store) {
	try {
		const value = await setSyncPoint(store);
		toast({
			message: `Sync point set at ${value.marker.synced_sha.slice(0, 8)}`,
			variant: 'success',
		});
		return { ok: true, value };
	} catch (error) {
		report(error, []);
		return { ok: false, error };
	}
}

/** DELETE a card. The response carries `referenced_by` for the caller to warn on. */
export function removeCard(store, handle, quietCodes) {
	return run(store, () => deleteCard(store, handle), quietCodes);
}
