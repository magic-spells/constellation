import { PuzzleApp } from '@magic-spells/puzzle';
import routes from './routes.js';

// Hash routing keeps the old viewer's bookmarkable `#/card/HANDLE` URLs working
// and keeps the server's static contract a non-issue.
const app = new PuzzleApp({
	target: '#app',
	routerMode: 'hash',
	routes,
});

app.mount();

export default app;
