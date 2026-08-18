// The isometric painter: canvas 2D, no WebGL, no dependency.
//
// Consumes a scene from atlas-scene.js and paints it. The three.js painter
// consumes the SAME scene, so anything about *where things are* belongs there,
// and anything about *how they look* belongs here.
//
// PROJECTION. True isometric (2:1 dimetric, the shape every one of the reference
// maps uses): x goes down-right, y goes down-left, z goes straight up. It is a
// pure function of world coordinates, so screen position never depends on draw
// order and the depth sort below is the only thing establishing occlusion.
//
// DEPTH. Painter's algorithm — sort back-to-front by (x + y), draw over. That is
// correct for axis-aligned boxes on a shared ground plane, which is all a city
// is, and it costs one sort instead of a z-buffer.
//
// HIT TESTING. An offscreen colour-ID buffer, not geometry math: every building
// is re-drawn in a unique flat colour, and picking is one getImageData of one
// pixel. Exact at any zoom, exact for concave silhouettes, and it cannot drift
// from the visible drawing because it runs off the same shape code. The buffer
// is rebuilt lazily — only after the camera or the scene actually changed.

const ISO_X = Math.cos(Math.PI / 6); // 0.866 — half-width of a ground cell
const ISO_Y = 0.5; // half-depth: the 2:1 that reads as isometric
const ISO_Z = 1; // height is unforeshortened, so towers stay legible

/** World (x, y, z) → screen offset, before the camera's pan/zoom. */
export function project(x, y, z = 0) {
	return {
		x: (x - y) * ISO_X,
		y: (x + y) * ISO_Y - z * ISO_Z,
	};
}

/**
 * Screen offset → world ground point (the z = 0 inverse of `project`). Used for
 * dragging a building to a cell; picking uses the colour buffer instead.
 */
export function unproject(sx, sy) {
	return {
		x: sy / (2 * ISO_Y) + sx / (2 * ISO_X),
		y: sy / (2 * ISO_Y) - sx / (2 * ISO_X),
	};
}

/** Projected bounds of a scene, for fit-to-view. */
export function projectedBounds(scene) {
	const { minX, minY, maxX, maxY } = scene.bounds;
	const tallest = scene.buildings.reduce((m, b) => Math.max(m, b.height), 0);
	const corners = [
		project(minX, minY, 0),
		project(maxX, minY, 0),
		project(minX, maxY, 0),
		project(maxX, maxY, 0),
		project(minX, minY, tallest * scene.cell),
		project(maxX, minY, tallest * scene.cell),
	];
	return {
		minX: Math.min(...corners.map((c) => c.x)),
		maxX: Math.max(...corners.map((c) => c.x)),
		minY: Math.min(...corners.map((c) => c.y)),
		maxY: Math.max(...corners.map((c) => c.y)),
	};
}

/** Fit `bounds` into a viewport, returning the camera view that frames it. */
export function fitProjected(bounds, { width, height, padding = 80, maxScale = 1.6 }) {
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

/** Back-to-front order. Ties broken on handle so the sort is stable everywhere. */
export function depthSort(buildings) {
	return [...buildings].sort(
		(a, b) => a.x + a.y - (b.x + b.y) || (a.handle < b.handle ? -1 : 1),
	);
}

/** 24-bit index → an exact, unique rgb string for the pick buffer. */
export function idColor(index) {
	const n = index + 1; // 0 is reserved for "nothing here"
	return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
}

/** Inverse of idColor; -1 when the pixel is background. */
export function colorId(r, g, b) {
	return ((r << 16) | (g << 8) | b) - 1;
}

export class IsoRenderer {
	constructor() {
		this.pickCanvas = null;
		this.pickCtx = null;
		this.pickDirty = true;
		this.order = [];
	}

	/** Invalidate the pick buffer. Called whenever the camera or scene changes. */
	invalidate() {
		this.pickDirty = true;
	}

	/**
	 * Paint the scene.
	 *
	 * @param ctx     CanvasRenderingContext2D, already dpr-scaled to CSS pixels
	 * @param scene   from buildScene()
	 * @param view    {tx, ty, scale}
	 * @param opts    { width, height, palette, hovered, selected, lens, hatch,
	 *                  showEdges, routeProgress }
	 */
	draw(ctx, scene, view, opts) {
		const { width, height, palette } = opts;

		ctx.clearRect(0, 0, width, height);
		ctx.save();
		ctx.translate(view.tx, view.ty);
		ctx.scale(view.scale, view.scale);

		this.drawGround(ctx, scene, view, opts);
		this.drawDistricts(ctx, scene, palette, opts);
		this.drawEdges(ctx, scene, palette, view, opts);
		this.drawRoutes(ctx, scene, palette, view, opts);

		this.order = depthSort(scene.buildings);
		for (const building of this.order) {
			this.drawBuilding(ctx, building, scene, palette, view, opts);
		}

		ctx.restore();

		// Labels last, in screen space, so text never inherits the world scale.
		this.drawLabels(ctx, scene, view, opts);
	}

	/** The faint ground grid every reference map sits on. */
	drawGround(ctx, scene, view, opts) {
		const { palette } = opts;
		const { minX, minY, maxX, maxY } = scene.bounds;
		const step = scene.cell;
		ctx.save();
		ctx.strokeStyle = palette.grid;
		ctx.lineWidth = Math.max(0.4, 0.7 / view.scale);
		ctx.globalAlpha = 0.5;
		ctx.beginPath();
		const pad = step * 2;
		for (let x = minX - pad; x <= maxX + pad; x += step) {
			const a = project(x, minY - pad);
			const b = project(x, maxY + pad);
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
		}
		for (let y = minY - pad; y <= maxY + pad; y += step) {
			const a = project(minX - pad, y);
			const b = project(maxX + pad, y);
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
		}
		ctx.stroke();
		ctx.restore();
	}

	/**
	 * District plates: a tinted floor with a dashed boundary, the pattern from
	 * the dark reference where each region is a translucent quad you can read as
	 * one place. The header card is drawn in screen space with the labels.
	 */
	drawDistricts(ctx, scene, palette, opts) {
		for (const district of scene.districts) {
			const corners = [
				project(district.x, district.y),
				project(district.x + district.w, district.y),
				project(district.x + district.w, district.y + district.h),
				project(district.x, district.y + district.h),
			];
			ctx.save();
			ctx.beginPath();
			ctx.moveTo(corners[0].x, corners[0].y);
			for (const corner of corners.slice(1)) ctx.lineTo(corner.x, corner.y);
			ctx.closePath();

			const tint = palette.district(district);
			ctx.fillStyle = tint.fill;
			ctx.fill();
			ctx.strokeStyle = tint.line;
			ctx.lineWidth = 1.2;
			ctx.setLineDash(district.kind === 'feature' ? [] : [6, 5]);
			ctx.stroke();
			ctx.restore();
		}
	}

	/** Structural connections. Off by default — 150 of them is a hairball. */
	drawEdges(ctx, scene, palette, view, opts) {
		const highlight = opts.highlightEdges;
		if (!highlight || highlight.size === 0) return;
		ctx.save();
		ctx.strokeStyle = palette.edge;
		ctx.lineWidth = Math.max(0.6, 1.1 / view.scale);
		ctx.globalAlpha = 0.75;
		for (const edge of scene.edges) {
			if (!highlight.has(edge.a) && !highlight.has(edge.b)) continue;
			this.strokePath(ctx, edge.points);
		}
		ctx.restore();
	}

	/** FLOW roads, with the travelling dots that make data movement visible. */
	drawRoutes(ctx, scene, palette, view, opts) {
		const active = opts.activeRoute;
		for (const route of scene.routes) {
			const isActive = !active || active === route.id;
			ctx.save();
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';

			// Casing first, then the road on top: a dark outline is what keeps a
			// bright line readable where it crosses a tinted district plate.
			ctx.strokeStyle = palette.routeCasing;
			ctx.lineWidth = (isActive ? 6 : 3.4) / view.scale;
			ctx.globalAlpha = isActive ? 0.55 : 0.2;
			this.strokePath(ctx, route.points);

			ctx.strokeStyle = palette.route(route, isActive);
			ctx.lineWidth = (isActive ? 2.6 : 1.4) / view.scale;
			ctx.globalAlpha = isActive ? 1 : 0.35;
			this.strokePath(ctx, route.points);
			ctx.restore();

			if (isActive && opts.routeProgress != null) {
				this.drawRouteDot(ctx, route, opts.routeProgress, palette, view);
			}
		}
	}

	strokePath(ctx, points) {
		if (points.length < 2) return;
		ctx.beginPath();
		const first = project(points[0].x, points[0].y);
		ctx.moveTo(first.x, first.y);
		for (const point of points.slice(1)) {
			const p = project(point.x, point.y);
			ctx.lineTo(p.x, p.y);
		}
		ctx.stroke();
	}

	/** The small solid diamond travelling a road, as in the drafting-paper map. */
	drawRouteDot(ctx, route, progress, palette, view) {
		const at = pointAlong(route.points, progress);
		if (!at) return;
		const p = project(at.x, at.y);
		const r = Math.max(2.5, 4 / view.scale);
		ctx.save();
		ctx.fillStyle = palette.routeDot;
		ctx.beginPath();
		ctx.moveTo(p.x, p.y - r);
		ctx.lineTo(p.x + r, p.y);
		ctx.lineTo(p.x, p.y + r);
		ctx.lineTo(p.x - r, p.y);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}

	drawBuilding(ctx, building, scene, palette, view, opts) {
		const faces = buildingFaces(building, scene.cell);
		const tone = palette.building(building, {
			hovered: opts.hovered === building.handle,
			selected: opts.selected === building.handle,
		});

		ctx.save();
		if (building.shape === 'offmap') ctx.setLineDash([5, 4]);

		// Back-to-front within the solid: left face, right face, then the top.
		for (const face of faces.sides) {
			this.fillFace(ctx, face.points, face.side === 'left' ? tone.left : tone.right, opts, view);
		}
		if (faces.top) this.fillFace(ctx, faces.top, tone.top, opts, view);

		// Floors: the parts inside the block. Bands across the visible side faces,
		// which is what makes a tower read as "made of things" rather than solid.
		if (building.floors.length > 1 && building.height > 1) {
			this.drawFloors(ctx, building, scene.cell, tone, view);
		}

		if (tone.outline) {
			ctx.strokeStyle = tone.outline;
			ctx.lineWidth = Math.max(0.8, 1.6 / view.scale);
			for (const face of faces.sides) this.strokeFace(ctx, face.points);
			if (faces.top) this.strokeFace(ctx, faces.top);
		}

		if (building.scaffolded) this.drawScaffold(ctx, building, scene.cell, palette, view);
		ctx.restore();
	}

	fillFace(ctx, points, style, opts, view) {
		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
		ctx.closePath();
		ctx.fillStyle = style;
		ctx.fill();
		if (opts.hatch) this.hatchFace(ctx, points, opts.hatchColor, view);
	}

	strokeFace(ctx, points) {
		ctx.beginPath();
		ctx.moveTo(points[0].x, points[0].y);
		for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
		ctx.closePath();
		ctx.stroke();
	}

	/**
	 * Diagonal line hatching, clipped to a face — the drafting-paper look. Drawn
	 * rather than a repeating pattern so the line weight stays constant on screen
	 * at any zoom, which is what makes it read as ink instead of texture.
	 */
	hatchFace(ctx, points, color, view) {
		const xs = points.map((p) => p.x);
		const ys = points.map((p) => p.y);
		const minX = Math.min(...xs);
		const maxX = Math.max(...xs);
		const minY = Math.min(...ys);
		const maxY = Math.max(...ys);
		const gap = Math.max(2.5, 4 / view.scale);

		ctx.save();
		ctx.clip();
		ctx.strokeStyle = color;
		ctx.lineWidth = Math.max(0.3, 0.6 / view.scale);
		ctx.beginPath();
		for (let x = minX - (maxY - minY); x <= maxX; x += gap) {
			ctx.moveTo(x, maxY);
			ctx.lineTo(x + (maxY - minY), minY);
		}
		ctx.stroke();
		ctx.restore();
	}

	/** Horizontal bands marking each floor across the two visible side faces. */
	drawFloors(ctx, building, cell, tone, view) {
		const { w, d } = building.footprint;
		const hw = (w * cell) / 2;
		const hd = (d * cell) / 2;
		const top = building.height * cell;
		const count = Math.min(building.floors.length, Math.floor(building.height * 2));
		if (count < 2) return;

		ctx.save();
		ctx.strokeStyle = tone.floorLine;
		ctx.lineWidth = Math.max(0.3, 0.7 / view.scale);
		ctx.globalAlpha = 0.55;
		ctx.beginPath();
		for (let i = 1; i < count; i++) {
			const z = (top * i) / count;
			// Front-left edge across to the front corner, then to front-right.
			const a = project(building.x - hw, building.y + hd, z);
			const b = project(building.x + hw, building.y + hd, z);
			const c = project(building.x + hw, building.y - hd, z);
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.lineTo(c.x, c.y);
		}
		ctx.stroke();
		ctx.restore();
	}

	/** Drift: the building is wrapped in scaffolding because its code moved. */
	drawScaffold(ctx, building, cell, palette, view) {
		const { w, d } = building.footprint;
		const hw = (w * cell) / 2;
		const hd = (d * cell) / 2;
		const top = building.height * cell;
		ctx.save();
		ctx.strokeStyle = palette.scaffold;
		ctx.lineWidth = Math.max(0.6, 1.2 / view.scale);
		ctx.setLineDash([4, 3]);
		ctx.beginPath();
		for (const [dx, dy] of [
			[-hw, -hd],
			[hw, -hd],
			[hw, hd],
			[-hw, hd],
		]) {
			const base = project(building.x + dx, building.y + dy, 0);
			const cap = project(building.x + dx, building.y + dy, top * 1.12);
			ctx.moveTo(base.x, base.y);
			ctx.lineTo(cap.x, cap.y);
		}
		ctx.stroke();
		ctx.restore();
	}

	/**
	 * Labels in screen space: district headers and the hovered building. Drawing
	 * every building's name at every zoom is unreadable soup, so only the hovered
	 * one gets a name — "hover to read", exactly as the reference legend says.
	 */
	drawLabels(ctx, scene, view, opts) {
		const { palette } = opts;
		ctx.save();
		ctx.textBaseline = 'alphabetic';

		for (const district of scene.districts) {
			// West corner — the leftmost point of the plate in isometric space, so a
			// label sits in the gutter beside its own district rather than over the
			// neighbouring one.
			const anchor = project(district.x, district.y + district.h);
			const sx = view.tx + view.scale * anchor.x;
			const sy = view.ty + view.scale * anchor.y;
			if (sx < -320 || sx > opts.width + 320 || sy < -80 || sy > opts.height + 80) continue;
			// A plate too small to read is a plate whose label is just noise.
			if (district.w * view.scale < 90) continue;

			ctx.font = palette.districtFont;
			ctx.fillStyle = palette.districtLabel(district);
			ctx.textAlign = 'left';
			ctx.fillText(truncate(ctx, district.label.toUpperCase(), 230), sx + 8, sy + 4);

			if (district.summary) {
				ctx.font = palette.summaryFont;
				ctx.fillStyle = palette.districtSummary(district);
				ctx.fillText(truncate(ctx, district.summary, 260), sx + 8, sy + 19);
			}
		}
		ctx.restore();
	}

	// ── Picking ──────────────────────────────────────────────────────────────

	/**
	 * Rebuild the offscreen ID buffer. Same geometry as `draw`, flat unique
	 * colours, no antialiasing concerns because we read a single exact pixel.
	 */
	buildPickBuffer(scene, view, opts) {
		const { width, height } = opts;
		if (!this.pickCanvas) {
			this.pickCanvas = document.createElement('canvas');
			this.pickCtx = this.pickCanvas.getContext('2d', { willReadFrequently: true });
		}
		if (this.pickCanvas.width !== width || this.pickCanvas.height !== height) {
			this.pickCanvas.width = width;
			this.pickCanvas.height = height;
		}

		const ctx = this.pickCtx;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, width, height);
		ctx.save();
		ctx.translate(view.tx, view.ty);
		ctx.scale(view.scale, view.scale);

		this.order = depthSort(scene.buildings);
		this.order.forEach((building, index) => {
			const faces = buildingFaces(building, scene.cell);
			ctx.fillStyle = idColor(index);
			for (const face of faces.sides) {
				ctx.beginPath();
				ctx.moveTo(face.points[0].x, face.points[0].y);
				for (const p of face.points.slice(1)) ctx.lineTo(p.x, p.y);
				ctx.closePath();
				ctx.fill();
			}
			if (faces.top) {
				ctx.beginPath();
				ctx.moveTo(faces.top[0].x, faces.top[0].y);
				for (const p of faces.top.slice(1)) ctx.lineTo(p.x, p.y);
				ctx.closePath();
				ctx.fill();
			}
		});

		ctx.restore();
		this.pickDirty = false;
	}

	/** Building under a CSS-pixel point, or null. */
	pick(scene, view, opts, x, y) {
		if (!scene.buildings.length) return null;
		if (this.pickDirty || !this.pickCanvas) this.buildPickBuffer(scene, view, opts);
		if (x < 0 || y < 0 || x >= this.pickCanvas.width || y >= this.pickCanvas.height) return null;
		const [r, g, b, a] = this.pickCtx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
		if (a === 0) return null;
		const index = colorId(r, g, b);
		return this.order[index] ?? null;
	}
}

/**
 * The polygons of one building. Every silhouette reduces to a top face plus the
 * two visible side faces; the differences are footprint, taper and whether the
 * top is drawn at all (a `plate` is only ground).
 */
export function buildingFaces(building, cell) {
	const { w, d } = building.footprint;
	const hw = (w * cell) / 2;
	const hd = (d * cell) / 2;
	const z = building.height * cell;
	const { x, y, shape } = building;

	// A plate is the ground a card sits on — no elevation, so no sides.
	if (shape === 'plate') {
		return {
			top: [
				project(x - hw, y - hd, 0),
				project(x + hw, y - hd, 0),
				project(x + hw, y + hd, 0),
				project(x - hw, y + hd, 0),
			],
			sides: [],
		};
	}

	// Cylinder/figure: the top reads as a circle, so the corners are chamfered
	// rather than modelled — at city scale an octagon is a cylinder.
	const inset = shape === 'cylinder' || shape === 'figure' ? 0.32 : 0;

	const corner = (sx, sy, height) => project(x + sx * hw, y + sy * hd, height);
	const ci = 1 - inset;

	const topFace = [
		corner(-ci, -1, z),
		corner(ci, -1, z),
		corner(1, -ci, z),
		corner(1, ci, z),
		corner(ci, 1, z),
		corner(-ci, 1, z),
		corner(-1, ci, z),
		corner(-1, -ci, z),
	];

	// The two faces an isometric camera can see: south (+y) and east (+x).
	const right = [
		corner(1, -ci, z),
		corner(1, ci, z),
		corner(1, ci, 0),
		corner(1, -ci, 0),
	];
	const front = [
		corner(-ci, 1, z),
		corner(ci, 1, z),
		corner(ci, 1, 0),
		corner(-ci, 1, 0),
	];

	return {
		top: topFace,
		sides: [
			{ side: 'left', points: front },
			{ side: 'right', points: right },
		],
	};
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

/** Point at 0..1 along a polyline, by arc length. */
export function pointAlong(points, t) {
	if (points.length === 0) return null;
	if (points.length === 1) return points[0];
	let total = 0;
	const lengths = [];
	for (let i = 1; i < points.length; i++) {
		const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
		lengths.push(len);
		total += len;
	}
	if (total === 0) return points[0];

	let target = Math.max(0, Math.min(1, t)) * total;
	for (let i = 0; i < lengths.length; i++) {
		if (target <= lengths[i] || i === lengths.length - 1) {
			const k = lengths[i] === 0 ? 0 : target / lengths[i];
			return {
				x: points[i].x + (points[i + 1].x - points[i].x) * k,
				y: points[i].y + (points[i + 1].y - points[i].y) * k,
			};
		}
		target -= lengths[i];
	}
	return points[points.length - 1];
}
