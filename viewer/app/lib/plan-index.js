const cache = new WeakMap();

export function planIndex(store) {
	const plan = store.findOne('plan', 'plan');
	const generation = plan?.generation;
	const cached = cache.get(store);

	// `cached &&` is load-bearing: before the plan singleton lands, `generation`
	// is undefined, and `cached?.generation === generation` would be true with
	// nothing cached — a view rendering against an unhydrated store would throw.
	if (cached && cached.generation === generation) return cached.index;

	const cards = store.findMany('card');
	const connections = plan?.connections ?? [];
	const byHandle = new Map();
	const byType = new Map();
	const neighbors = new Map();

	for (const card of cards) {
		byHandle.set(card.handle, card);
		if (!byType.has(card.type)) byType.set(card.type, []);
		byType.get(card.type).push(card);
		neighbors.set(card.handle, []);
	}

	for (const { a, b } of connections) {
		if (!neighbors.has(a)) neighbors.set(a, []);
		if (!neighbors.has(b)) neighbors.set(b, []);
		neighbors.get(a).push(b);
		neighbors.get(b).push(a);
	}

	const index = {
		byHandle,
		byType,
		neighbors,
		connections,
		projectCard: byHandle.get('PLAN-PROJECT') ?? null,
	};

	cache.set(store, { generation, index });
	return index;
}
