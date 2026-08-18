// The flat painter: the plan as a street map, seen from directly above.
//
// One of two renderers over the SAME scene from atlas-scene.js. This one is the
// map: district blocks, streets between them, and a square per card. The other
// (atlas-three.js) is the 3D city. Neither computes a position — the scene does.
//
// WHY TOP-DOWN. An isometric 2D view and a 3D city look like the same picture
// with different shading, so a switch between them reads as broken. A plan view
// is a different question — "where is everything and what runs between it" —
// and answers it better than any projection with depth: nothing occludes
// anything, every label has room, and streets read as streets.
//
// PROJECTION. There is none. World x/y ARE map x/y; the camera is the shared
// {tx, ty, scale}. That makes hit-testing an axis-aligned rectangle test, so
// this renderer needs no colour-ID buffer and picking is exact by construction.

/** Corner rounding, in world units, for blocks and buildings. */
const BLOCK_RADIUS = 14;
const BUILDING_RADIUS = 5;

/** Street width in world units, before the camera scale. */
const STREET_WIDTH = 13;

/** Below this on-screen size a building's label is unreadable, so it is dropped. */
const LABEL_MIN_PX = 46;

export function flatBounds(scene) {
	return scene.bounds;
}

/** Camera that frames `bounds` in the viewport. */
export function fitFlat(bounds, { width, height, padding = 72, maxScale = 2.4 }) {
	const bw = Math.max(1, bounds.maxX - bounds.minX);
	const bh = Math.max(1, bounds.maxY - bounds.minY);
	const scale = Math.min(
		(width - padding * 2) / bw,
		(height - padding * 2) / bh,
		maxScale,
	);
	const cx = (bounds.minX + bounds.maxX) / 2;
	const cy = (bounds.minY + bounds.maxY) / 2;
	return { tx: width / 2 - scale * cx, ty: height / 2 - scale * cy, scale };
}

/** The world-space rectangle a building occupies. */
export function buildingRect(building, cell) {
	const w = building.footprint.w * cell;
	const d = building.footprint.d * cell;
	return { x: building.x - w / 2, y: building.y - d / 2, w, h: d };
}

/** Ellipsis-truncate to a pixel width. Binary search, like the graph's fitText. */
export function truncate(ctx, text, maxWidth) {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
		else hi = mid - 1;
	}
	return `${text.slice(0, lo)}…`;
}

/** Point and heading at 0..1 along a polyline, by arc length. */
export function pointAlong(points, t) {
	if (!points || points.length === 0) return null;
	if (points.length === 1) return { ...points[0], angle: 0 };
	const lengths = [];
	let total = 0;
	for (let i = 1; i < points.length; i++) {
		const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
		lengths.push(len);
		total += len;
	}
	if (total === 0) return { ...points[0], angle: 0 };

	let target = Math.max(0, Math.min(1, t)) * total;
	for (let i = 0; i < lengths.length; i++) {
		if (target <= lengths[i] || i === lengths.length - 1) {
			const k = lengths[i] === 0 ? 0 : target / lengths[i];
			const a = points[i];
			const b = points[i + 1];
			return {
				x: a.x + (b.x - a.x) * k,
				y: a.y + (b.y - a.y) * k,
				angle: Math.atan2(b.y - a.y, b.x - a.x),
			};
		}
		target -= lengths[i];
	}
	const last = points[points.length - 1];
	return { ...last, angle: 0 };
}

function roundRect(ctx, x, y, w, h, r) {
	const radius = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.arcTo(x + w, y, x + w, y + h, radius);
	ctx.arcTo(x + w, y + h, x, y + h, radius);
	ctx.arcTo(x, y + h, x, y, radius);
	ctx.arcTo(x, y, x + w, y, radius);
	ctx.closePath();
}

export class FlatRenderer {
	/**
	 * @param ctx   CanvasRenderingContext2D, already dpr-scaled to CSS pixels
	 * @param scene from buildScene()
	 * @param view  {tx, ty, scale}
	 * @param opts  { width, height, palette, hovered, selected, activeRoute,
	 *                routeProgress, highlightEdges }
	 */
	draw(ctx, scene, view, opts) {
		const { width, height, palette } = opts;
		ctx.clearRect(0, 0, width, height);
		ctx.save();
		ctx.translate(view.tx, view.ty);
		ctx.scale(view.scale, view.scale);

		this.drawBlocks(ctx, scene, palette);
		this.drawEdges(ctx, scene, palette, view, opts);
		this.drawStreets(ctx, scene, palette, view, opts);
		this.drawBuildings(ctx, scene, palette, view, opts);

		ctx.restore();
		this.drawLabels(ctx, scene, view, opts);
	}

	/** District blocks — the city blocks buildings stand on. */
	drawBlocks(ctx, scene, palette) {
		for (const d of scene.districts) {
			const tint = palette.district(d);
			ctx.save();
			roundRect(ctx, d.x, d.y, d.w, d.h, BLOCK_RADIUS);
			ctx.fillStyle = tint.fill;
			ctx.fill();
			ctx.strokeStyle = tint.line;
			ctx.lineWidth = 1.5;
			// A feature district is a named place; a type district is a holding pen,
			// and the dashes say it was grouped for you rather than by you.
			ctx.setLineDash(d.kind === 'feature' ? [] : [7, 6]);
			ctx.stroke();
			ctx.restore();
		}
	}

	/** Structural connections, only around what you are pointing at. */
	drawEdges(ctx, scene, palette, view, opts) {
		const highlight = opts.highlightEdges;
		if (!highlight || highlight.size === 0) return;
		ctx.save();
		ctx.strokeStyle = palette.edge;
		ctx.lineWidth = Math.max(0.6, 1.4 / view.scale);
		ctx.globalAlpha = 0.8;
		ctx.setLineDash([5 / view.scale, 4 / view.scale]);
		for (const edge of scene.edges) {
			if (!highlight.has(edge.a) && !highlight.has(edge.b)) continue;
			this.stroke(ctx, edge.points);
		}
		ctx.restore();
	}

	/**
	 * Streets: casing, surface, then direction. A road on a map is two strokes —
	 * a dark edge and a lighter fill — which is what makes it read as a street
	 * rather than a line drawn between two things.
	 */
	drawStreets(ctx, scene, palette, view, opts) {
		const active = opts.activeRoute;
		for (const route of scene.routes) {
			const isActive = !active || active === route.id;
			const w = (isActive ? STREET_WIDTH : STREET_WIDTH * 0.6);

			ctx.save();
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';
			ctx.globalAlpha = isActive ? 1 : 0.4;

			ctx.strokeStyle = palette.streetCasing;
			ctx.lineWidth = w;
			this.stroke(ctx, route.points);

			ctx.strokeStyle = palette.street(route, isActive);
			ctx.lineWidth = Math.max(1, w - 4);
			this.stroke(ctx, route.points);
			ctx.restore();

			if (isActive) {
				this.drawArrows(ctx, route, palette, view);
				if (opts.routeProgress != null) {
					this.drawTraveller(ctx, route, opts.routeProgress, palette, view);
				}
			}
		}
	}

	/** Chevrons along the street: which way the data goes. */
	drawArrows(ctx, route, palette, view) {
		const size = Math.max(3, 5 / view.scale);
		ctx.save();
		ctx.strokeStyle = palette.streetArrow;
		ctx.lineWidth = Math.max(0.8, 1.6 / view.scale);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		for (let t = 0.08; t < 1; t += 0.16) {
			const at = pointAlong(route.points, t);
			if (!at) continue;
			ctx.save();
			ctx.translate(at.x, at.y);
			ctx.rotate(at.angle);
			ctx.beginPath();
			ctx.moveTo(-size, -size);
			ctx.lineTo(size * 0.6, 0);
			ctx.lineTo(-size, size);
			ctx.stroke();
			ctx.restore();
		}
		ctx.restore();
	}

	/** The dot travelling the street — data actually moving. */
	drawTraveller(ctx, route, progress, palette, view) {
		const at = pointAlong(route.points, progress);
		if (!at) return;
		const r = Math.max(2.5, 4.5 / view.scale);
		ctx.save();
		ctx.fillStyle = palette.routeDot;
		ctx.beginPath();
		ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 0.3;
		ctx.beginPath();
		ctx.arc(at.x, at.y, r * 2.1, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	drawBuildings(ctx, scene, palette, view, opts) {
		for (const b of scene.buildings) {
			const rect = buildingRect(b, scene.cell);
			const hovered = opts.hovered === b.handle;
			const selected = opts.selected === b.handle;
			const tone = palette.building(b, { hovered, selected });

			ctx.save();
			roundRect(ctx, rect.x, rect.y, rect.w, rect.h, BUILDING_RADIUS);
			ctx.fillStyle = tone.top;
			ctx.fill();

			// Drift keeps its red dashed cage from the 3D city, flattened to an
			// outline — the same signal in both engines.
			if (b.scaffolded) {
				ctx.strokeStyle = palette.scaffold;
				ctx.setLineDash([5 / view.scale, 4 / view.scale]);
				ctx.lineWidth = Math.max(1, 2 / view.scale);
			} else {
				ctx.strokeStyle = hovered || selected ? tone.outline ?? tone.right : tone.right;
				ctx.lineWidth = Math.max(0.6, (hovered || selected ? 2.4 : 1) / view.scale);
			}
			ctx.stroke();
			ctx.restore();
		}
	}

	stroke(ctx, points) {
		if (!points || points.length < 2) return;
		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
		ctx.stroke();
	}

	/**
	 * Labels in screen space so text never inherits the zoom. Buildings get their
	 * handle once they are big enough to hold it — on a plan view there is room,
	 * which is half the reason this projection beats an isometric one.
	 */
	drawLabels(ctx, scene, view, opts) {
		const { palette, width, height } = opts;
		ctx.save();
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'center';
		ctx.font = palette.buildingFont;

		for (const b of scene.buildings) {
			const rect = buildingRect(b, scene.cell);
			const w = rect.w * view.scale;
			if (w < LABEL_MIN_PX) continue;
			const cx = view.tx + view.scale * b.x;
			const cy = view.ty + view.scale * b.y;
			if (cx < -120 || cx > width + 120 || cy < -40 || cy > height + 40) continue;
			ctx.fillStyle = palette.buildingLabel(b);
			ctx.fillText(truncate(ctx, b.handle, w - 10), cx, cy);
		}

		// District names sit on the block, like a neighbourhood name on a map.
		ctx.textAlign = 'left';
		for (const d of scene.districts) {
			const sx = view.tx + view.scale * d.x;
			const sy = view.ty + view.scale * d.y;
			if (d.w * view.scale < 90) continue;
			if (sx < -320 || sx > width + 320 || sy < -60 || sy > height + 60) continue;
			ctx.font = palette.districtFont;
			ctx.fillStyle = palette.districtLabel(d);
			ctx.fillText(truncate(ctx, d.label.toUpperCase(), 240), sx + 12, sy - 10);
		}
		ctx.restore();
	}

	/**
	 * Building under a CSS-pixel point. Axis-aligned containment — exact, and no
	 * offscreen buffer to keep in sync with the drawing.
	 */
	pick(scene, view, x, y) {
		const wx = (x - view.tx) / view.scale;
		const wy = (y - view.ty) / view.scale;
		// Reverse order so the last-drawn (topmost) wins, matching what you see.
		for (let i = scene.buildings.length - 1; i >= 0; i--) {
			const b = scene.buildings[i];
			const r = buildingRect(b, scene.cell);
			if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return b;
		}
		return null;
	}
}
