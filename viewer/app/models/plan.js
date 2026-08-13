import { Puzzle, PuzzleModel } from '@magic-spells/puzzle';

export default class Plan extends PuzzleModel {
	static schema = {
		id: Puzzle.string().primary(),
		editable: Puzzle.boolean().default(false),
		errors: Puzzle.array().default(() => []),
		warnings: Puzzle.array().default(() => []),
		connections: Puzzle.array().default(() => []),
		sync: Puzzle.object().default(null),
		generation: Puzzle.number().default(0),
	};
}
