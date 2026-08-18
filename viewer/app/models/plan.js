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
		// Atlas-only, fetched lazily when that view opens (see lib/api.js).
		atlasConfig: Puzzle.object().default(null),
		atlasMetrics: Puzzle.object().default(null),
		generation: Puzzle.number().default(0),
	};
}
