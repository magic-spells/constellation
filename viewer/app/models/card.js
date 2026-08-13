import { Puzzle, PuzzleModel } from '@magic-spells/puzzle';

export default class Card extends PuzzleModel {
	static schema = {
		handle: Puzzle.string().primary(),
		type: Puzzle.string(),
		kind: Puzzle.string(),
		name: Puzzle.string(),
		status: Puzzle.string(),
		relPath: Puzzle.string(),
		mtime: Puzzle.number().default(0),
		frontmatter: Puzzle.object().default(() => ({})),
		body: Puzzle.string().default(''),
	};
}
