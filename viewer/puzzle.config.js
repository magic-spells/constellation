export default {
	styles: { use: ['tailwindcss'] },
	// Translations (puzzle D175). One app/locales/<tag>.json per tag; the build
	// fills each locale's missing keys from `en` (one warning per locale) and
	// emits a hashed table per locale, of which the browser fetches only the
	// active one. `pt-BR` sits before `pt-PT` so a browser asking for plain `pt`
	// lands on Brazilian Portuguese. Keep in step with LANGUAGES in
	// app/lib/locale.js (tests/viewer/i18n-locales.test.js checks).
	i18n: {
		locales: ['en', 'es', 'de', 'fr', 'it', 'ja', 'zh-Hans', 'pt-BR', 'pt-PT', 'nl', 'ko'],
		defaultLocale: 'en',
	},
	dev: {
		// The Constellation dev API (`npm run serve:examples`) listens on 4747.
		//
		// The proxy forwards the browser's Host and Origin unchanged
		// (localhost:3000), which the server's Host/Origin guard refuses unless
		// told otherwise — hence `--dev-origin http://localhost:3000` on
		// serve:examples, and `--strict-port` on dev:viewer so the dev server
		// fails loudly instead of drifting to a port the API doesn't allow.
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
