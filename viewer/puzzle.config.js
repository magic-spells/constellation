export default {
	styles: { use: ['tailwindcss'] },
	dev: {
		// The Constellation dev API (`npm run serve:examples`) listens on 4747.
		//
		// SSE spike (2026-08-13, puzzle 0.6.0 dev CLI): `/events` STREAMS through
		// the Go dev proxy — `data: connected` arrives immediately on connect and
		// `data: change` lands within ~1s of a file edit, byte-for-byte identical
		// to hitting the API server directly. No buffering, so the client can use
		// the same-origin relative URL `/events` in dev and in production.
		proxy: {
			'/api': 'http://localhost:4747',
			'/events': 'http://localhost:4747',
		},
	},
};
