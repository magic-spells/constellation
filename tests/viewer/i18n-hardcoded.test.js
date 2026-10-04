// No hard-coded user-facing text in the viewer: the same scan as
// `node scripts/check-i18n.mjs`, so `npm test` fails on it too.
import { describe, expect, it } from 'vitest';
import { run } from '../../scripts/check-i18n.mjs';

describe('check-i18n', () => {
	it('finds no hard-coded strings and no unknown keys', () => {
		const found = run().map((p) => `${p.file}:${p.line}  ${p.why}: ${p.text}`);
		expect(found).toEqual([]);
	});
});
