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
 * The switcher's whole view model.
 *
 *   plans        the roster's `plans`
 *   active       the id this page is scoped to
 *   projectName  the active plan's live PLAN-PROJECT name (wins over the
 *                roster's, which was read once at server start)
 *
 * Returns `{ current, switchable, groups }`. `groups` is "This repo" then
 * "Connected repos", each `{ label, items }`, empty groups dropped. A row is
 * `{ id, name, letter, tone, detail, cards, active, available }`; an
 * unavailable connected repo is a row with `available: false` whose detail is
 * the reason. `switchable` is false when the only row is the current one.
 */
export function workspaceModel(plans, active, projectName) {
	const list = Array.isArray(plans) ? plans : [];
	const self = list.filter(isSelf);
	const connected = list.filter((p) => !isSelf(p));
	const multiPlanRepos = new Set(
		connected
			.filter(isAvailable)
			.map((p) => p.repo?.root)
			.filter((root, i, all) => all.indexOf(root) !== i),
	);

	const row = (plan) => {
		const isActive = isAvailable(plan) && plan.id === active;
		const name = isActive && projectName ? projectName : plan.name || plan.id;
		let detail;
		if (!isAvailable(plan)) detail = plan.reason || 'Unavailable';
		else if (isSelf(plan)) detail = plan.code_path || '';
		else if (multiPlanRepos.has(plan.repo?.root) || plan.code_path)
			detail = [plan.repo?.path, plan.code_path].filter(Boolean).join('/');
		else detail = plan.repo?.description || plan.repo?.path || '';
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
		{ label: 'This repo', items: self.map(row) },
		{ label: 'Connected repos', items: connected.map(row) },
	].filter((group) => group.items.length > 0);

	const activeRow = groups.flatMap((g) => g.items).find((item) => item.active);
	const name = projectName || activeRow?.name || 'Plan';
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
 * By path first: the entry's path against the current workspace's repo root,
 * compared with each roster entry's `repo.root` (so a connected repo naming
 * this one back finds it). Then, from the launching repo only, by name — the
 * roster's connected names are that repo's own `connected_repos` names.
 *
 * Returns `{ id, name?, available, reason, cards }` — `name` is the served
 * plan's project name, which its monogram is drawn from everywhere.
 */
export function rosterMatch(entry, plans, active) {
	const list = Array.isArray(plans) ? plans : [];
	const current = list.find((p) => p.id === active);
	const pick = (candidates) => {
		const open = candidates.filter(isAvailable);
		const target = open.find((p) => !p.code_path) ?? open[0];
		if (target) {
			return { id: target.id, name: target.name, available: true, reason: '', cards: target.cards ?? 0 };
		}
		const down = candidates[0];
		return down
			? { id: down.id, available: false, reason: down.reason || 'Unavailable', cards: null }
			: null;
	};

	const base = current?.repo?.root;
	if (base && entry?.path) {
		const target = normalize(entry.path.startsWith('/') ? entry.path : `${base}/${entry.path}`);
		const hit = pick(list.filter((p) => p.repo?.root && normalize(p.repo.root) === target));
		if (hit) return hit;
	}
	if (current && isSelf(current) && entry?.name) {
		const hit = pick(list.filter((p) => !isSelf(p) && p.repo?.name === entry.name));
		if (hit) return hit;
	}
	return null;
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
