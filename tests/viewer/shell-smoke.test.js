// @vitest-environment jsdom
//
// Smoke test for the pzlc vitest lane (tests/viewer/pzl-vitest-plugin.js).
// Proves the three compile modes, sibling `.pzl` re-entry through the plugin,
// and that a real `viewer/app` piece mounts. Later viewer tests can import any
// `.pzl` the same way.
//
// The mode fixtures live under tests/viewer/fixtures/pzl/{components,views,
// layouts}/ rather than pointing at viewer/app so the lane itself stays green
// while the app churns; the Badge case is the canary that real app files still
// compile.
import { describe, expect, it } from 'vitest';
import { mountView } from '@magic-spells/puzzle/testing';
import Widget from './fixtures/pzl/components/Widget.pzl';
import SmokeView from './fixtures/pzl/views/SmokeView.pzl';
import SmokeLayout from './fixtures/pzl/layouts/SmokeLayout.pzl';
import Badge from '../../viewer/app/components/ui/Badge.pzl';

describe('pzlc test lane', () => {
	it('compiles a component (inline root) and mounts it with props', async () => {
		const view = await mountView(Widget, { props: { label: 'hello' } });
		expect(view.element.tagName.toLowerCase()).toBe('span');
		expect(view.element.textContent.trim()).toBe('hello');
		view.destroy();
	});

	it('compiles a view (puzzle-view root) and re-enters the plugin for sibling .pzl imports', async () => {
		const view = await mountView(SmokeView);
		expect(view.element.tagName.toLowerCase()).toBe('puzzle-view');
		expect(view.find('.smoke')).toBeTruthy();
		// Rendered by the child component compiled through the same plugin.
		expect(view.element.textContent).toContain('from-view');
		view.destroy();
	});

	it('compiles a layout (puzzle-view root) and renders slotted children', async () => {
		const view = await mountView(SmokeLayout);
		expect(view.element.tagName.toLowerCase()).toBe('puzzle-view');
		expect(view.find('.smoke-layout')).toBeTruthy();
		view.destroy();
	});

	it('compiles and mounts a real viewer piece', async () => {
		// Pieces live under components/, so they compile in component mode: the
		// <puzzle-view> wrapper is stripped and the inner <span> is the root.
		const view = await mountView(Badge, { props: { variant: 'brand' } });
		expect(view.element.tagName.toLowerCase()).toBe('span');
		expect(view.element.className).toContain('text-brand');
		view.destroy();
	});
});
