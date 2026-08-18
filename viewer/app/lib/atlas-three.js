// The lit painter: three.js on WebGL, loaded only when someone asks for it.
//
// The second renderer of the SAME scene atlas-iso.js paints — atlas-scene.js owns
// where everything is, these two only decide how it looks. Both sit behind one
// switch, so the hard requirement is that flipping engines must not move the
// city: the camera here is the exact 3D equivalent of iso's 2D projection,
// derived rather than eyeballed (see `cameraFrame`, and the parity test).
//
// CAMERA. Orthographic. iso's projection is linear in world coordinates with no
// divide — the definition of a parallel projection — so a perspective camera
// would taper the towers and no {tx, ty, scale} could ever line up with the 2D
// view. Worked through, iso's axis triple (0.866, 0.5, 1) is a TRUE isometric
// view — x, y and z foreshorten equally — scaled by √1.5 pixels per world unit.
// That leaves the whole camera as two numbers: which ground point the viewport
// centre lands on, and how many world units fit across the viewport.
//
// HANDEDNESS. The scene's world is x east, y south, z up, which is left-handed
// because screen-style y-down is what a 2D painter wants. three is right-handed
// y-up, so everything crosses over once, here, as (x, y, z) → (x, z, y). Doing
// it in one place is what keeps the camera math above a two-line derivation.
//
// COLOUR comes from the palette object, never the DOM — same contract as iso. A
// lit renderer wants ONE colour per solid and lets lights make the faces differ,
// so it takes the palette's top-face tone as the material and reproduces iso's
// face falloff with an actual key light. The `warm` paper scheme's hatching has
// no lit equivalent and is not attempted: on this engine every scheme paints the
// lit city.
//
// LAZY. three is ~1.3 MB of JS that a session which never opens the atlas should
// not pay for, so nothing here imports it at the top level. `loadThree()` does,
// once; the class refuses to construct before that has resolved.

/** Set by `loadThree`. Module-scoped so the class can stay `new ThreeRenderer(canvas)`. */
let THREE = null;
let loading = null;

/**
 * Load three, once. A failed load is not cached, so a flaky network costs a
 * retry rather than a permanently dead tab.
 */
export async function loadThree() {
	if (THREE) return THREE;
	loading ??= import('three').then(
		(mod) => {
			THREE = mod;
			loading = null;
			return mod;
		},
		(err) => {
			loading = null;
			throw err;
		},
	);
	return loading;
}

/** True once `loadThree()` has resolved — i.e. the renderer is constructible. */
export function threeReady() {
	return THREE != null;
}

// ── Projection parity with atlas-iso ────────────────────────────────────────
//
// ISO_X / ISO_Y below MUST equal iso's. They are copied rather than imported
// because a painter importing the other painter is the coupling that quietly
// turns two renderers into one; tests/atlas-three.test.ts holds the two
// projections against each other to the pixel, which is the real guard.

const ISO_X = Math.cos(Math.PI / 6);
const ISO_Y = 0.5;

/**
 * CSS pixels per world unit along a screen axis, at scale 1. iso's projection is
 * a unit isometric view times this: 0.7071·√1.5 = 0.866, 0.4082·√1.5 = 0.5 and
 * 0.8165·√1.5 = 1 — exactly iso's (ISO_X, ISO_Y, ISO_Z).
 */
export const UNIT = Math.sqrt(1.5);

/** World (x east, y south, z up) → three (x east, y up, z south). */
export function toThree(x, y, z = 0) {
	return { x, y: z, z: y };
}

/**
 * The orthographic frame for a 2D camera view: the ground point under the
 * viewport centre, plus the frustum half-extents in world units.
 *
 * The centre is taken on z = 0 because under a parallel projection any point on
 * the view ray frames the same region, and the ground plane is the one that is
 * always inside the city.
 */
export function cameraFrame(view, { width, height }) {
	const px = (width / 2 - view.tx) / view.scale;
	const py = (height / 2 - view.ty) / view.scale;
	const unitsPerPixel = 1 / (view.scale * UNIT);
	return {
		// The z = 0 inverse of iso's projection.
		center: {
			x: py / (2 * ISO_Y) + px / (2 * ISO_X),
			y: py / (2 * ISO_Y) - px / (2 * ISO_X),
		},
		halfWidth: (width / 2) * unitsPerPixel,
		halfHeight: (height / 2) * unitsPerPixel,
		unitsPerPixel,
	};
}

/** Unit screen-right and screen-up axes of that camera, in WORLD coordinates. */
const RIGHT = { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 };
const UP = { x: -0.5 / UNIT, y: -0.5 / UNIT, z: 1 / UNIT };

/**
 * Where a world point lands in CSS pixels under this camera. Nothing draws with
 * it — three does that — but it is the arithmetic three will do, so a test can
 * hold it against iso's `project` and prove both engines frame the same city.
 */
export function projectByCamera(point, view, size) {
	const { center } = cameraFrame(view, size);
	const rx = point.x - center.x;
	const ry = point.y - center.y;
	const rz = point.z ?? 0;
	const k = view.scale * UNIT;
	return {
		x: size.width / 2 + (rx * RIGHT.x + ry * RIGHT.y + rz * RIGHT.z) * k,
		y: size.height / 2 - (rx * UP.x + ry * UP.y + rz * UP.z) * k,
	};
}

// ── Shape → geometry ────────────────────────────────────────────────────────

/**
 * Levels the floor bands sit at, in world units above the base. Same rule as
 * iso's `drawFloors`: a card must not appear to have a different number of parts
 * depending on which painter you are looking at.
 */
export function bandLevels(building, cell) {
	if (building.floors.length <= 1 || building.height <= 1) return [];
	const count = Math.min(building.floors.length, Math.floor(building.height * 2));
	if (count < 2) return [];
	const top = building.height * cell;
	const levels = [];
	for (let i = 1; i < count; i++) levels.push((top * i) / count);
	return levels;
}

/**
 * A building as primitive parts, in world units, base at z = 0.
 *
 * Declarative on purpose: the shape vocabulary is the part most likely to be
 * wrong, and this way it is decided in a pure function a plain Node test can
 * read instead of being buried in mesh construction that needs a GL context.
 *
 * Parts are `box` (w, d, h), `cyl` (rBottom → rTop over h, `sides` facets),
 * `sphere` (r) and `capsule` (r, h). `y` is the part's CENTRE height, which is
 * where three wants a primitive's origin; `x`/`z` offset it within the footprint.
 */
export function geometrySpec(building, cell) {
	const w = Math.max(building.footprint.w * cell, 1);
	const d = Math.max(building.footprint.d * cell, 1);
	const h = Math.max(building.height * cell, 1);
	const box = (bw, bd, bh, y = bh / 2, extra = {}) => ({
		kind: 'box',
		w: bw,
		d: bd,
		h: bh,
		y,
		...extra,
	});

	switch (building.shape) {
		// FILE: the ground a card stands on, so it is a tile and not a solid.
		case 'plate':
			return { parts: [box(w, d, cell * 0.06)], plinth: false, bands: false, shadow: 'receive' };

		// FLOW: a junction in the road network rather than a building beside it.
		case 'road':
			return {
				parts: [box(w, d, cell * 0.1), box(w * 0.26, d * 1.05, cell * 0.22)],
				plinth: true,
				bands: false,
				shadow: 'receive',
			};

		// DB: the drum everyone draws for a store, with a lid so it reads as a tank.
		case 'cylinder':
			return {
				parts: [
					{ kind: 'cyl', rBottom: w / 2, rTop: w / 2, h, sides: 18, y: h / 2 },
					{ kind: 'cyl', rBottom: w * 0.54, rTop: w * 0.54, h: cell * 0.05, sides: 18, y: h },
				],
				plinth: true,
				bands: true,
			};

		// API: a gateway — two piers and a lintel you can see daylight through.
		case 'portal': {
			const pier = w * 0.24;
			const lintel = h * 0.2;
			return {
				parts: [
					box(pier, d, h - lintel, (h - lintel) / 2, { x: -(w - pier) / 2 }),
					box(pier, d, h - lintel, (h - lintel) / 2, { x: (w - pier) / 2 }),
					box(w, d, lintel, h - lintel / 2),
				],
				plinth: true,
				bands: false,
			};
		}

		// JOB: a works — a squat body with a stack, because a job runs and vents.
		case 'plant':
			return {
				parts: [
					box(w, d, h * 0.62),
					{
						kind: 'cyl',
						rBottom: w * 0.15,
						rTop: w * 0.13,
						h,
						sides: 10,
						y: h / 2,
						x: w * 0.3,
						z: -d * 0.28,
					},
				],
				plinth: true,
				bands: true,
			};

		// EVENT: an antenna. The head is emissive, so a broadcast reads as lit.
		case 'beacon':
			return {
				parts: [
					{
						kind: 'cyl',
						rBottom: w * 0.22,
						rTop: w * 0.14,
						h: h * 0.88,
						sides: 8,
						y: (h * 0.88) / 2,
					},
					{ kind: 'sphere', r: Math.max(w * 0.5, cell * 0.05), y: h * 0.94, glow: true },
				],
				plinth: true,
				bands: false,
			};

		// DOC / DECISION / PLAN / RELEASE / DIAGRAM: a monument tapers. Four facets
		// turned 45° so the flats stay square with the grid.
		case 'monument': {
			const r = (w / 2) * Math.SQRT2;
			return {
				parts: [
					{ kind: 'cyl', rBottom: r, rTop: r * 0.68, h, sides: 4, rotY: Math.PI / 4, y: h / 2 },
				],
				plinth: true,
				bands: true,
			};
		}

		// TEST: a frame around something — a small core inside an open cage.
		case 'scaffold':
			return {
				parts: [box(w * 0.66, d * 0.66, h * 0.58)],
				cage: { w, d, h },
				plinth: true,
				bands: false,
			};

		// AGENT / ROLE: a person, at city scale. Anything more is a doll.
		case 'figure': {
			const r = Math.max(w * 0.42, cell * 0.04);
			const body = Math.max(h * 0.6, r);
			return {
				parts: [
					{ kind: 'capsule', r, h: body, y: body / 2 },
					{ kind: 'sphere', r: r * 0.82, y: body + r * 0.5 },
				],
				plinth: true,
				bands: false,
			};
		}

		// DATATYPE / STATE: a shaft on a diamond plan — a prism, not a block.
		case 'prism':
			return {
				parts: [{ kind: 'cyl', rBottom: w * 0.62, rTop: w * 0.62, h, sides: 4, y: h / 2 }],
				plinth: true,
				bands: true,
			};

		// EXTERNAL: outside the city limits. The layout still hands it a cell inside
		// a district, so "excluded" has to come from the drawing instead: ghosted,
		// caged in a dashed outline, no plinth, and floating clear of ground it is
		// not standing on.
		case 'offmap':
			return {
				parts: [box(w, d, h * 0.8)],
				cage: { w, d, h: h * 0.8 },
				plinth: false,
				bands: false,
				ghost: true,
				lift: cell * 0.16,
				shadow: 'none',
			};

		// PAGE / COMPONENT / STYLE / FEATURE, and anything a new type has not
		// claimed yet: the plain extruded prism.
		default:
			return { parts: [box(w, d, h)], plinth: true, bands: true };
	}
}

/**
 * Point at 0..1 along a polyline, by arc length. iso has the same helper; the
 * duplicate is the price of this module importing nothing from the other painter.
 */
export function pointAlong(points, t) {
	if (points.length === 0) return null;
	if (points.length === 1) return points[0];
	const lengths = [];
	let total = 0;
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

/**
 * The one colour a lit solid gets, from the palette that already knows the
 * theme. iso needs three pre-shaded faces; here the lights do that, so the top
 * tone — the palette's "this face catches the light" answer — is the material.
 */
export function baseTone(building, palette, state = {}) {
	return palette.building(building, state);
}

// ── Layering ────────────────────────────────────────────────────────────────
//
// Everything on the ground is a flat surface at z ≈ 0, which is a z-fighting
// contest unless someone stacks them. Fractions of a cell, in draw order.

const Y_GRID = 0.0;
const Y_PLATE = 0.006;
const Y_CASING = 0.012;
const Y_ROAD = 0.018;
const Y_PLINTH = 0.02;
/** District labels sit clear of the ground stack; they ignore depth anyway. */
const Y_LABEL = 0.5;

/** Plinth pads read as a base, not a second storey. */
const PLINTH_H = 0.04;
const PLINTH_PAD = 0.14;

/** Road width and the dark casing that keeps it legible over a tinted plate. */
const ROAD_W = 0.07;
const CASING_W = 0.16;

/**
 * Shadow maps cost a second full pass over the scene. On a plan with thousands
 * of cards that is the frame budget, and the city is a texture at that size
 * anyway, so shadows switch off rather than the atlas going slow.
 */
const SHADOW_LIMIT = 900;

export class ThreeRenderer {
	constructor(canvasEl) {
		if (!THREE) {
			throw new Error('atlas-three: await loadThree() before constructing ThreeRenderer');
		}
		this.canvas = canvasEl;
		this.scene = null;
		this.palette = null;
		this.width = 1;
		this.height = 1;

		this.renderer = new THREE.WebGLRenderer({
			canvas: canvasEl,
			antialias: true,
			alpha: true,
		});
		// Transparent clear, like iso's clearRect: the page's own background is the
		// sky, so the city inherits the theme without the palette naming a sky colour.
		this.renderer.setClearColor(0x000000, 0);
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

		this.world = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 4000);
		// Default up + a position on the (1, 1, 1) diagonal is exactly the basis the
		// parity math above assumes. Changing either breaks the engine switch.
		this.camera.up.set(0, 1, 0);
		this.target = new THREE.Vector3();
		this.dist = 4000;

		// Ambient carries the shadowed faces; the key light is off-axis from the
		// camera so the east face stays brighter than the south, the way the
		// palette's `right`/`left` tones say it should be.
		this.ambient = new THREE.AmbientLight(0xffffff, 0.72);
		this.key = new THREE.DirectionalLight(0xffffff, 1.25);
		this.key.castShadow = true;
		this.key.shadow.mapSize.set(2048, 2048);
		this.key.shadow.bias = -0.0004;
		this.key.shadow.normalBias = 1;
		this.fill = new THREE.DirectionalLight(0xffffff, 0.28);
		this.world.add(this.ambient, this.key, this.key.target, this.fill);

		// One group per concern so `setScene` can throw the whole city away without
		// touching the camera or the lights.
		this.root = new THREE.Group();
		this.pickRoot = new THREE.Group();
		this.root.add(this.pickRoot);
		this.world.add(this.root);

		this.buildings = new Map(); // handle → { building, group, meshes, spec }
		this.markers = []; // { route, mesh }
		this.owned = []; // geometries / materials / textures of the current scene
		this.highlighted = new Map(); // handle → [{ mesh, material }]
		this.hovered = null;
		this.selected = null;
		this.raycaster = new THREE.Raycaster();
		this.pointer = new THREE.Vector2();
	}

	// ── Scene construction ───────────────────────────────────────────────────

	/** Rebuild every mesh. The expensive call — once per scene or palette change. */
	setScene(scene, palette) {
		this.clearScene();
		this.scene = scene;
		this.palette = palette;
		if (!scene) return;

		const cell = scene.cell;
		const { minX, minY, maxX, maxY } = scene.bounds;
		const span = Math.max(maxX - minX, maxY - minY, cell * 4);
		// Far enough back that nothing clips, near enough that the depth buffer
		// still has resolution across a city.
		this.dist = span * 2 + cell * 40;
		this.camera.near = 0.1;
		this.camera.far = this.dist * 2 + span * 2;

		// Every pass below wants the same shape decisions, and they are pure, so
		// they get made once here rather than three times over.
		const specs = new Map(scene.buildings.map((b) => [b.handle, geometrySpec(b, cell)]));

		this.placeLights(scene, span);
		this.addGrid(scene, palette);
		this.addDistricts(scene, palette);
		this.addRoads(scene, palette);
		this.addPlinths(scene, palette, specs);
		this.addBuildings(scene, palette, specs);
		this.addBandsAndCages(scene, palette, specs);
	}

	placeLights(scene, span) {
		const { minX, minY, maxX, maxY } = scene.bounds;
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		const c = toThree(cx, cy, 0);
		const reach = span * 1.4 + scene.cell * 10;

		this.key.target.position.set(c.x, 0, c.z);
		this.key.position.set(c.x + reach * 0.9, reach * 1.3, c.z + reach * 0.35);
		this.fill.position.set(c.x - reach, reach * 0.5, c.z - reach * 0.8);

		this.key.castShadow = scene.buildings.length <= SHADOW_LIMIT;
		const shadow = this.key.shadow.camera;
		const half = span * 0.75 + scene.cell * 4;
		shadow.left = -half;
		shadow.right = half;
		shadow.top = half;
		shadow.bottom = -half;
		shadow.near = 1;
		shadow.far = reach * 4;
		shadow.updateProjectionMatrix();
	}

	/** The faint ground grid every reference map sits on. */
	addGrid(scene, palette) {
		const { minX, minY, maxX, maxY } = scene.bounds;
		const pad = scene.cell * 2;
		const size = Math.max(maxX - minX, maxY - minY) + pad * 2;
		const divisions = Math.max(1, Math.round(size / scene.cell));
		const color = new THREE.Color(palette.grid);
		const grid = new THREE.GridHelper(size, divisions, color, color);
		grid.position.set((minX + maxX) / 2, Y_GRID, (minY + maxY) / 2);
		grid.material.transparent = true;
		grid.material.opacity = 0.5;
		grid.material.depthWrite = false;
		this.own(grid.geometry, grid.material);
		this.root.add(grid);
	}

	/**
	 * District plates: a tinted floor with a boundary, dashed for the type groups
	 * that are a holding pen rather than a named place. The label rides a sprite
	 * at the plate's west corner — the same anchor iso puts it at, so the two
	 * engines read the same way round.
	 */
	addDistricts(scene, palette) {
		for (const district of scene.districts) {
			const tint = palette.district(district);
			const geometry = new THREE.PlaneGeometry(district.w, district.h);
			geometry.rotateX(-Math.PI / 2);
			const material = new THREE.MeshLambertMaterial({
				color: new THREE.Color(tint.fill),
				transparent: true,
				opacity: 0.94,
			});
			const plate = new THREE.Mesh(geometry, material);
			plate.position.set(district.x + district.w / 2, Y_PLATE, district.y + district.h / 2);
			plate.receiveShadow = true;
			this.own(geometry, material);
			this.root.add(plate);

			const outline = this.plateOutline(district, tint);
			if (outline) this.root.add(outline);

			const label = this.districtLabel(district, palette);
			if (label) this.root.add(label);
		}
	}

	plateOutline(district, tint) {
		const y = Y_PLATE + 0.004;
		const corners = [
			[district.x, district.y],
			[district.x + district.w, district.y],
			[district.x + district.w, district.y + district.h],
			[district.x, district.y + district.h],
			[district.x, district.y],
		];
		const points = corners.map(([x, z]) => new THREE.Vector3(x, y, z));
		const geometry = new THREE.BufferGeometry().setFromPoints(points);
		const dashed = district.kind !== 'feature';
		const material = dashed
			? new THREE.LineDashedMaterial({
					color: new THREE.Color(tint.line),
					dashSize: 6,
					gapSize: 5,
				})
			: new THREE.LineBasicMaterial({ color: new THREE.Color(tint.line) });
		const line = new THREE.Line(geometry, material);
		if (dashed) line.computeLineDistances();
		this.own(geometry, material);
		return line;
	}

	/**
	 * A district's name, rasterised into a sprite. Text as geometry would need a
	 * font loader and a second network payload; a canvas texture is one draw of
	 * the same fonts the palette already hands the 2D painter.
	 */
	districtLabel(district, palette) {
		if (typeof document === 'undefined') return null;
		const ss = 3; // supersample, so the text survives being zoomed into
		const cssW = 280;
		const cssH = district.summary ? 34 : 20;
		const canvas = document.createElement('canvas');
		canvas.width = cssW * ss;
		canvas.height = cssH * ss;
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		ctx.scale(ss, ss);
		ctx.textBaseline = 'alphabetic';
		ctx.textAlign = 'left';
		ctx.font = palette.districtFont;
		ctx.fillStyle = palette.districtLabel(district);
		ctx.fillText(district.label.toUpperCase(), 0, 12);
		if (district.summary) {
			ctx.font = palette.summaryFont;
			ctx.fillStyle = palette.districtSummary(district);
			ctx.fillText(district.summary, 0, 28);
		}

		const texture = new THREE.CanvasTexture(canvas);
		texture.colorSpace = THREE.SRGBColorSpace;
		const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
		const sprite = new THREE.Sprite(material);
		// A sprite is sized in world units; dividing by UNIT lands it at the same
		// pixel size as iso's label at the same zoom.
		sprite.scale.set(cssW / UNIT, cssH / UNIT, 1);
		sprite.center.set(0, 0.5);
		sprite.position.set(district.x, Y_LABEL, district.y + district.h);
		sprite.renderOrder = 10;
		this.own(texture, material);
		return sprite;
	}

	/** FLOW roads: a ribbon on the ground over a darker casing, as iso draws them. */
	addRoads(scene, palette) {
		const cell = scene.cell;
		for (const route of scene.routes) {
			const road = this.ribbon(route.points, cell * ROAD_W, Y_ROAD);
			const casing = this.ribbon(route.points, cell * CASING_W, Y_CASING);
			if (!road || !casing) continue;

			const casingMat = new THREE.MeshBasicMaterial({
				color: new THREE.Color(palette.routeCasing),
				transparent: true,
				opacity: 0.55,
			});
			const roadMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.route(route, true)) });
			this.own(road, casing, casingMat, roadMat);
			this.root.add(new THREE.Mesh(casing, casingMat), new THREE.Mesh(road, roadMat));

			// The travelling marker — the thing that makes data movement visible.
			const geometry = new THREE.OctahedronGeometry(cell * 0.07);
			const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.routeDot) });
			const mesh = new THREE.Mesh(geometry, material);
			mesh.position.y = cell * 0.07;
			this.own(geometry, material);
			this.root.add(mesh);
			this.markers.push({ route, mesh });
		}
	}

	/**
	 * Flat ribbon along a polyline. The scene routes orthogonally, so a square at
	 * each joint is all it takes to close a corner — no mitre math, no rounding.
	 */
	ribbon(points, width, y) {
		if (!points || points.length < 2) return null;
		const half = width / 2;
		const positions = [];
		// Wound counter-clockwise seen from above, so the ground-facing side is the
		// back face and the default front-side culling keeps the road visible.
		const quad = (x0, z0, x1, z1) => {
			positions.push(x0, y, z0, x1, y, z1, x1, y, z0);
			positions.push(x0, y, z0, x0, y, z1, x1, y, z1);
		};

		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1];
			const b = points[i];
			const minX = Math.min(a.x, b.x) - half;
			const maxX = Math.max(a.x, b.x) + half;
			const minZ = Math.min(a.y, b.y) - half;
			const maxZ = Math.max(a.y, b.y) + half;
			if (Math.abs(a.x - b.x) < 0.001) {
				quad(a.x - half, minZ, a.x + half, maxZ);
			} else if (Math.abs(a.y - b.y) < 0.001) {
				quad(minX, a.y - half, maxX, a.y + half);
			} else {
				// Diagonal legs exist only as a degenerate case; a bounding quad is
				// wrong-looking rather than missing, which is the right failure.
				quad(minX, minZ, maxX, maxZ);
			}
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.computeVertexNormals();
		return geometry;
	}

	/**
	 * The dark pads the city stands on. One InstancedMesh: every pad is the same
	 * box under a different transform, so a thousand of them cost one draw call.
	 */
	addPlinths(scene, palette, specs) {
		const cell = scene.cell;
		const wanted = scene.buildings.filter((b) => specs.get(b.handle).plinth);
		if (wanted.length === 0) return;

		const geometry = new THREE.BoxGeometry(1, 1, 1);
		const material = new THREE.MeshLambertMaterial({
			color: new THREE.Color(palette.grid),
			transparent: true,
			opacity: 0.85,
		});
		const mesh = new THREE.InstancedMesh(geometry, material, wanted.length);
		mesh.receiveShadow = true;
		const matrix = new THREE.Matrix4();
		const height = cell * PLINTH_H;
		wanted.forEach((building, i) => {
			const w = building.footprint.w * cell + cell * PLINTH_PAD;
			const d = building.footprint.d * cell + cell * PLINTH_PAD;
			matrix.makeScale(w, height, d);
			matrix.setPosition(building.x, Y_PLINTH + height / 2, building.y);
			mesh.setMatrixAt(i, matrix);
		});
		mesh.instanceMatrix.needsUpdate = true;
		this.own(geometry, material);
		this.root.add(mesh);
	}

	addBuildings(scene, palette, specs) {
		// One material per colour, not per building: a plan is a few hundred cards
		// across a dozen type hues, and shared materials are shared uniforms.
		const materials = new Map();
		const materialFor = (color, ghost) => {
			const key = `${color}|${ghost ? 'ghost' : 'solid'}`;
			if (!materials.has(key)) {
				const material = new THREE.MeshLambertMaterial({
					color: new THREE.Color(color),
					transparent: ghost,
					opacity: ghost ? 0.28 : 1,
					depthWrite: !ghost,
				});
				this.own(material);
				materials.set(key, material);
			}
			return materials.get(key);
		};

		for (const building of scene.buildings) {
			const spec = specs.get(building.handle);
			const tone = baseTone(building, palette, {});
			const material = materialFor(tone.top, spec.ghost);
			const group = new THREE.Group();
			group.position.set(building.x, spec.lift ?? 0, building.y);
			group.userData.building = building;

			const meshes = [];
			for (const part of spec.parts) {
				const geometry = this.partGeometry(part);
				if (!geometry) continue;
				this.own(geometry);
				const mesh = new THREE.Mesh(
					geometry,
					part.glow ? this.glowMaterial(tone.top) : material,
				);
				mesh.position.set(part.x ?? 0, part.y, part.z ?? 0);
				if (part.rotY) mesh.rotation.y = part.rotY;
				mesh.castShadow = spec.shadow !== 'none' && spec.shadow !== 'receive';
				mesh.receiveShadow = spec.shadow !== 'none';
				mesh.userData.building = building;
				group.add(mesh);
				meshes.push(mesh);
			}

			this.pickRoot.add(group);
			this.buildings.set(building.handle, { building, group, meshes, spec, material });
		}
	}

	/** An EVENT's head, lit from inside so a broadcast reads as a source. */
	glowMaterial(color) {
		const material = new THREE.MeshLambertMaterial({
			color: new THREE.Color(color),
			emissive: new THREE.Color(color),
			emissiveIntensity: 0.6,
		});
		this.own(material);
		return material;
	}

	partGeometry(part) {
		switch (part.kind) {
			case 'box':
				return new THREE.BoxGeometry(part.w, part.h, part.d);
			case 'cyl':
				return new THREE.CylinderGeometry(part.rTop, part.rBottom, part.h, part.sides);
			case 'sphere':
				return new THREE.SphereGeometry(part.r, 14, 10);
			case 'capsule':
				return new THREE.CapsuleGeometry(part.r, part.h, 4, 10);
			default:
				return null;
		}
	}

	/**
	 * Floor bands and the dashed cages, merged into one line object each. They are
	 * decoration on top of solids that are already picked and coloured, so they do
	 * not need to be per-building objects and should not cost per-building draws.
	 */
	addBandsAndCages(scene, palette, specs) {
		const cell = scene.cell;
		const bandPos = [];
		const bandCol = [];
		const cagePos = [];
		const cageCol = [];

		for (const building of scene.buildings) {
			const spec = specs.get(building.handle);
			const tone = baseTone(building, palette, {});
			const lift = spec.lift ?? 0;

			if (spec.bands) {
				const primary = spec.parts[0];
				const color = new THREE.Color(tone.floorLine);
				for (const level of bandLevels(building, cell)) {
					ringSegments(bandPos, primary, building.x, building.y, level + lift);
					for (let i = 0; i < ringVertexCount(primary); i++) {
						bandCol.push(color.r, color.g, color.b);
					}
				}
			}

			// A cage says "this is a frame, not a solid": TEST wraps something, and
			// EXTERNAL is fenced off outside the city.
			const cage = spec.cage;
			if (cage) {
				const color = new THREE.Color(spec.ghost ? tone.top : palette.scaffold);
				const added = cageSegments(cagePos, cage, building.x, building.y, lift);
				for (let i = 0; i < added; i++) cageCol.push(color.r, color.g, color.b);
			}

			// Drift, from the lens: the building is wrapped because its code moved.
			if (building.scaffolded && !cage) {
				const color = new THREE.Color(palette.scaffold);
				const box = {
					w: building.footprint.w * cell,
					d: building.footprint.d * cell,
					h: building.height * cell * 1.12,
				};
				const added = cageSegments(cagePos, box, building.x, building.y, lift);
				for (let i = 0; i < added; i++) cageCol.push(color.r, color.g, color.b);
			}
		}

		if (bandPos.length) {
			this.root.add(this.lineSegments(bandPos, bandCol, false));
		}
		if (cagePos.length) {
			this.root.add(this.lineSegments(cagePos, cageCol, true));
		}
	}

	lineSegments(positions, colors, dashed) {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
		const material = dashed
			? new THREE.LineDashedMaterial({ vertexColors: true, dashSize: 5, gapSize: 4 })
			: new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6 });
		const lines = new THREE.LineSegments(geometry, material);
		if (dashed) lines.computeLineDistances();
		this.own(geometry, material);
		return lines;
	}

	// ── Per-frame ────────────────────────────────────────────────────────────

	/**
	 * Paint. Cheap by construction: the camera is two assignments, highlighting
	 * touches at most two materials, and the markers move one vector each.
	 */
	draw(view, opts) {
		if (!this.scene) return;
		this.width = opts.width || this.width;
		this.height = opts.height || this.height;

		this.updateCamera(view, this.width, this.height);
		this.updateHighlight(opts.hovered ?? null, opts.selected ?? null);
		this.updateMarkers(opts.routeProgress, opts.activeRoute ?? null);
		this.renderer.render(this.world, this.camera);
	}

	updateCamera(view, width, height) {
		const frame = cameraFrame(view, { width, height });
		const camera = this.camera;
		camera.left = -frame.halfWidth;
		camera.right = frame.halfWidth;
		camera.top = frame.halfHeight;
		camera.bottom = -frame.halfHeight;

		const centre = toThree(frame.center.x, frame.center.y, 0);
		this.target.set(centre.x, centre.y, centre.z);
		// The (1, 1, 1) diagonal with the default up vector IS the isometric basis
		// the parity math derives. Nothing else may be substituted here.
		const d = this.dist / Math.sqrt(3);
		camera.position.set(this.target.x + d, this.target.y + d, this.target.z + d);
		camera.lookAt(this.target);
		camera.updateProjectionMatrix();
	}

	/**
	 * Hover/selection, as an emissive lift rather than an outline pass. Materials
	 * are shared by colour, so a highlighted building gets a private clone for as
	 * long as it is lit and hands it back after — never more than two alive.
	 */
	updateHighlight(hovered, selected) {
		if (hovered === this.hovered && selected === this.selected) return;
		this.hovered = hovered;
		this.selected = selected;

		for (const [handle, entries] of this.highlighted) {
			if (handle === hovered || handle === selected) continue;
			for (const { mesh, material } of entries) {
				mesh.material.dispose();
				mesh.material = material;
			}
			this.highlighted.delete(handle);
		}

		for (const handle of [hovered, selected]) {
			if (!handle || this.highlighted.has(handle)) continue;
			const entry = this.buildings.get(handle);
			if (!entry) continue;
			const tone = baseTone(entry.building, this.palette, {
				hovered: handle === hovered,
				selected: handle === selected,
			});
			const glow = new THREE.Color(tone.outline ?? tone.top);
			const swapped = [];
			for (const mesh of entry.meshes) {
				const original = mesh.material;
				const lit = original.clone();
				lit.emissive = glow;
				lit.emissiveIntensity = handle === selected ? 0.55 : 0.34;
				mesh.material = lit;
				swapped.push({ mesh, material: original });
			}
			this.highlighted.set(handle, swapped);
		}
	}

	updateMarkers(progress, activeRoute) {
		if (progress == null) {
			for (const { mesh } of this.markers) mesh.visible = false;
			return;
		}
		for (const { route, mesh } of this.markers) {
			const active = !activeRoute || activeRoute === route.id;
			mesh.visible = active;
			if (!active) continue;
			const at = pointAlong(route.points, progress);
			if (!at) continue;
			mesh.position.set(at.x, mesh.position.y, at.y);
		}
	}

	// ── Picking, sizing, teardown ────────────────────────────────────────────

	/** Building under a CSS-pixel point, or null. */
	pick(x, y) {
		if (!this.scene || this.buildings.size === 0) return null;
		if (x < 0 || y < 0 || x > this.width || y > this.height) return null;
		this.pointer.set((x / this.width) * 2 - 1, -((y / this.height) * 2 - 1));
		this.raycaster.setFromCamera(this.pointer, this.camera);
		const hits = this.raycaster.intersectObjects(this.pickRoot.children, true);
		for (const hit of hits) {
			for (let node = hit.object; node; node = node.parent) {
				if (node.userData?.building) return node.userData.building;
			}
		}
		return null;
	}

	resize(width, height, dpr = 1) {
		this.width = Math.max(1, width);
		this.height = Math.max(1, height);
		this.renderer.setPixelRatio(dpr);
		// `false`: the view owns the canvas's CSS size, this owns its backing store.
		this.renderer.setSize(this.width, this.height, false);
	}

	dispose() {
		this.clearScene();
		this.renderer.dispose();
		this.canvas = null;
	}

	/** Track anything with a GPU allocation so `clearScene` can hand it all back. */
	own(...resources) {
		for (const resource of resources) if (resource) this.owned.push(resource);
	}

	clearScene() {
		for (const entries of this.highlighted.values()) {
			for (const { mesh, material } of entries) {
				mesh.material.dispose();
				mesh.material = material;
			}
		}
		this.highlighted.clear();
		this.hovered = null;
		this.selected = null;

		this.root.remove(...this.root.children.filter((c) => c !== this.pickRoot));
		this.pickRoot.clear();
		for (const resource of this.owned) resource.dispose?.();
		this.owned = [];
		this.buildings.clear();
		this.markers = [];
		this.scene = null;
	}
}

/** Vertices one band ring around a part contributes. */
function ringVertexCount(part) {
	return part.kind === 'cyl' ? part.sides * 2 : 8;
}

/**
 * One horizontal ring at `y`, as line-segment pairs, following the part's own
 * plan: a rectangle for a box, the facet polygon for anything turned.
 */
function ringSegments(out, part, cx, cz, y) {
	const push = (x0, z0, x1, z1) => out.push(cx + x0, y, cz + z0, cx + x1, y, cz + z1);

	if (part.kind === 'cyl') {
		const r = Math.max(part.rTop, part.rBottom);
		const rot = part.rotY ?? 0;
		for (let i = 0; i < part.sides; i++) {
			const a = rot + (i / part.sides) * Math.PI * 2;
			const b = rot + ((i + 1) / part.sides) * Math.PI * 2;
			push(Math.cos(a) * r, Math.sin(a) * r, Math.cos(b) * r, Math.sin(b) * r);
		}
		return;
	}

	const hw = part.w / 2;
	const hd = part.d / 2;
	push(-hw, -hd, hw, -hd);
	push(hw, -hd, hw, hd);
	push(hw, hd, -hw, hd);
	push(-hw, hd, -hw, -hd);
}

/** A box's twelve edges, as line-segment pairs. Returns the vertices added. */
function cageSegments(out, box, cx, cz, lift = 0) {
	const hw = box.w / 2;
	const hd = box.d / 2;
	const y0 = lift;
	const y1 = lift + box.h;
	const corners = [
		[-hw, -hd],
		[hw, -hd],
		[hw, hd],
		[-hw, hd],
	];
	let count = 0;
	const push = (x0, y0v, z0, x1, y1v, z1) => {
		out.push(cx + x0, y0v, cz + z0, cx + x1, y1v, cz + z1);
		count += 2;
	};
	corners.forEach(([x, z], i) => {
		const [nx, nz] = corners[(i + 1) % corners.length];
		push(x, y0, z, x, y1, z); // upright
		push(x, y0, z, nx, y0, nz); // base rail
		push(x, y1, z, nx, y1, nz); // cap rail
	});
	return count;
}
