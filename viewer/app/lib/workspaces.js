/**
 * Workspaces — the switcher's model, built from the `GET /api/plans` roster.
 *
 * A workspace is a plan the server can open: this repo's plan(s) and those of
 * the repos its PLAN-PROJECT lists in `connected_repos` (one level deep, fixed
 * at server start, so the set is the same from inside any of them). Roster
 * entries carry `repo: { name, path, root, kind: 'self' | 'connected' }` and
 * `available`; an entry without them comes from an older server and counts as
 * this repo's.
 *
 * Pure functions, so tests/viewer/workspaces.test.js pins them without a
 * browser. The one impure export, `switchWorkspace`, takes the location.
 */

import { t } from './i18n.js';

// Monogram tiles: the first letter on a tinted chart hue, picked by name so a
// workspace keeps its colour across reloads and machines. Literal strings so
// Tailwind's scanner sees every class.
const TILES = [
	'bg-chart-1/15 text-chart-1',
	'bg-chart-2/15 text-chart-2',
	'bg-chart-3/15 text-chart-3',
	'bg-chart-4/15 text-chart-4',
	'bg-chart-5/15 text-chart-5',
	'bg-chart-6/15 text-chart-6',
	'bg-chart-7/15 text-chart-7',
	'bg-chart-8/15 text-chart-8',
];

/** The first letter or digit of a name, upper-cased; `?` when it has none. */
export function monogram(name) {
	const match = /[\p{L}\p{N}]/u.exec(String(name ?? ''));
	return match ? match[0].toLocaleUpperCase() : '?';
}

/** The tile colour classes for a name (stable: a hash of the name). */
export function monogramTone(name) {
	let hash = 0;
	for (const ch of String(name ?? '')) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
	return TILES[hash % TILES.length];
}

const isSelf = (plan) => (plan?.repo?.kind ?? 'self') === 'self';
const isAvailable = (plan) => plan?.available !== false;

/** Roster entries the server can actually open. */
export function availablePlans(plans) {
	return (Array.isArray(plans) ? plans : []).filter(isAvailable);
}

/**
 * The muted line under a connected workspace, shared by the switcher and Home
 * so both name it the same way: the PROJECT name is the label (and the
 * monogram); this says which repo it came from — `beta · ../beta`, plus the
 * package path for a nested plan. The repo name is left out when it is
 * already the label.
 */
export function repoDetail(repo, codePath = '', label = '') {
	const where = [repo?.path, codePath].filter(Boolean).join('/');
	const name = repo?.name && repo.name !== label ? repo.name : '';
	return [name, where].filter(Boolean).join(' · ');
}

/**
 * The switcher's whole view model.
 *
 *   plans        the roster's `plans`
 *   active       the id this page is scoped to
 *   projectName  the active plan's live PLAN-PROJECT name (wins over the
 *                roster's, which was read once at server start)
 *
 * Returns `{ current, switchable, groups }`. `groups` is "This repo" then
 * "Connected repos", each `{ id, label, items }` (label translated), empty
 * groups dropped. A row is
 * `{ id, name, letter, tone, detail, cards, active, available }`; an
 * unavailable connected repo is a row with `available: false` whose detail is
 * the reason. `switchable` is false when the only row is the current one.
 */
export function workspaceModel(plans, active, projectName) {
	const list = Array.isArray(plans) ? plans : [];
	const self = list.filter(isSelf);
	const connected = list.filter((p) => !isSelf(p));
	const row = (plan) => {
		const isActive = isAvailable(plan) && plan.id === active;
		const name = isActive && projectName ? projectName : plan.name || plan.id;
		let detail;
		if (!isAvailable(plan)) detail = plan.reason || t('workspace.unavailable');
		else if (isSelf(plan)) detail = plan.code_path || '';
		else detail = repoDetail(plan.repo, plan.code_path, name);
		return {
			id: plan.id,
			name,
			letter: monogram(name),
			tone: monogramTone(name),
			detail,
			cards: isAvailable(plan) ? (plan.cards ?? 0) : null,
			active: isActive,
			available: isAvailable(plan),
		};
	};

	const groups = [
		{ id: 'self', label: t('workspace.group.self'), items: self.map(row) },
		{ id: 'connected', label: t('workspace.group.connected'), items: connected.map(row) },
	].filter((group) => group.items.length > 0);

	const activeRow = groups.flatMap((g) => g.items).find((item) => item.active);
	const name = projectName || activeRow?.name || t('workspace.fallbackName');
	const rows = groups.reduce((n, g) => n + g.items.length, 0);
	return {
		current: { name, letter: monogram(name), tone: monogramTone(name) },
		switchable: rows > 1,
		groups,
	};
}

/** Lexical POSIX normalize — enough to compare server-resolved repo roots. */
function normalize(p) {
	const abs = p.startsWith('/');
	const out = [];
	for (const part of p.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') out.pop();
		else out.push(part);
	}
	return (abs ? '/' : '') + out.join('/');
}

/**
 * Match one of the CURRENT plan's `connected_repos` entries (Home's rows) to a
 * workspace in the roster, or null when the server is not serving it — a
 * connected repo's own connections are not followed, so from inside one, most
 * of its siblings are out of reach.
 *
 * By path only, resolved exactly as the server resolves `connected_repos`:
 * against the directory holding the current plan's `constellation/` folder
 * (repos.ts `repoRootOf`), never its code_root. The path names a repo — whose
 * `constellation/` is the plan — or the plan folder itself. A declared repo the
 * server could not open matches its unavailable row (`repo.root` is the
 * resolved path). So a connected repo naming this one back finds it too.
 *
 * Returns `{ id, name?, available, reason, cards }` — `name` is the served
 * plan's project name.
 */
export function rosterMatch(entry, plans, active) {
	const list = Array.isArray(plans) ? plans : [];
	const planDir = (p) =>
		p?.repo?.root && p.plan_path ? normalize(`${p.repo.root}/${p.plan_path}`) : null;
	const currentDir = planDir(list.find((p) => p.id === active));
	if (!currentDir || !entry?.path) return null;

	const base = currentDir.slice(0, currentDir.lastIndexOf('/')) || '/';
	const target = normalize(entry.path.startsWith('/') ? entry.path : `${base}/${entry.path}`);
	const hits = list.filter((p) => {
		const dir = planDir(p);
		if (dir) return dir === target || dir === `${target}/constellation`;
		return !isAvailable(p) && !!p.repo?.root && normalize(p.repo.root) === target;
	});

	const open = hits.find(isAvailable);
	if (open) {
		return { id: open.id, name: open.name, available: true, reason: '', cards: open.cards ?? 0 };
	}
	const down = hits[0];
	return down ? { id: down.id, available: false, reason: down.reason || t('workspace.unavailable'), cards: null } : null;
}

/** The URL a workspace lives at, from the current page's location. */
export function workspaceHref(id, loc) {
	return `${loc?.pathname ?? '/'}${loc?.search ?? ''}#/p/${id}/`;
}

/**
 * Open a workspace: a full reload into its plan-scoped URL. The router's base is
 * fixed at construction, so re-scoping the app means building it again, and a
 * same-document hash change reloads nothing. `replace`, so workspaces you
 * passed through do not stack up in history.
 */
export function switchWorkspace(id, loc = globalThis.location) {
	loc.replace(workspaceHref(id, loc));
	loc.reload();
}
