import { Puzzle, PuzzleModel } from '@magic-spells/puzzle';

export default class Plan extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		editable: Puzzle.boolean().default(false),
		repoUrl: Puzzle.string().default(''),
		errors: Puzzle.array().default(() => []),
		warnings: Puzzle.array().default(() => []),
		connections: Puzzle.array().default(() => []),
		sync: Puzzle.object().default(null),
		docs: Puzzle.object().default(null),
		// Multi-plan serving. The roster comes from the global `GET /api/plans`
		// once at boot and never changes for the life of the page: the plan a
		// page is scoped to is fixed at PuzzleApp construction (see app.js), so
		// switching plans is a reload, not a store write. `multi` stays false —
		// and `plans` empty — for a single-plan server or one predating the
		// roster route; the topbar switcher renders only when it is true.
		activePlan: Puzzle.string().default(''),
		plans: Puzzle.array().default(() => []),
		multi: Puzzle.boolean().default(false),
		// Atlas-only, fetched lazily when that view opens (see lib/api.js).
		atlasConfig: Puzzle.object().default(null),
		atlasMetrics: Puzzle.object().default(null),
		generation: Puzzle.number().default(0),
	};
}
