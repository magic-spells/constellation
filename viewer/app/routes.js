import AppShell from './layouts/AppShell.pzl';
import Home from './views/Home.pzl';
import BoardPage from './views/BoardPage.pzl';
import ConstellationView from './views/ConstellationView.pzl';
import FeaturesPanel from './views/FeaturesPanel.pzl';
import StyleGuide from './views/StyleGuide.pzl';
import TypeIntro from './views/TypeIntro.pzl';
import CardPage from './views/CardPage.pzl';
import { hrefForHandle } from './lib/types.js';

// Card URLs mirror the plan's layout on disk: `constellation/api/API-TICKETS.md`
// is `#/api/API-TICKETS`, and a type's list is `#/api`. Routes match in ORDER,
// so the shape is: static pages first (they'd otherwise be eaten by `/:folder`),
// then the two legacy redirects, then the catch-all folder pair.
//
// The redirects keep every `#/card/HANDLE` / `#/type/folder` link ever
// bookmarked, pasted in a note, or written by an older build working. A guard
// that returns a path redirects with replace() semantics, so the dead URL never
// lands in history — Back from a redirected card goes where the user came from.

/** `/card/:handle` → the handle's real folder route (unknown prefix → home). */
const legacyCard = ({ to }) => hrefForHandle(to.params.handle);

/** `/type/:folder` → `/:folder`; an unknown folder still renders its own state. */
const legacyType = ({ to }) => `/${to.params.folder}`;

export default [
	{ path: '/', name: 'home', view: Home, layout: AppShell, meta: { title: 'Constellation' } },
	{
		path: '/board',
		name: 'board',
		view: BoardPage,
		layout: AppShell,
		meta: { title: 'Constellation — Board' },
	},
	{
		path: '/constellation',
		name: 'graph',
		view: ConstellationView,
		layout: AppShell,
		meta: { title: 'Constellation — Graph' },
	},
	{
		path: '/features',
		name: 'features',
		view: FeaturesPanel,
		layout: AppShell,
		meta: { title: 'Constellation — Features' },
	},
	{
		path: '/style-guide',
		name: 'style-guide',
		view: StyleGuide,
		layout: AppShell,
		meta: { title: 'Constellation — Style guide' },
	},
	// Legacy shapes. The guard always redirects, so the view never constructs —
	// it is named only because a route needs something to point at.
	{ path: '/card/:handle', name: 'legacy-card', view: CardPage, guard: legacyCard },
	{ path: '/type/:folder', name: 'legacy-type', view: TypeIntro, guard: legacyType },
	{
		path: '/:folder',
		name: 'type-list',
		view: TypeIntro,
		layout: AppShell,
		meta: { title: 'Constellation' },
	},
	{
		path: '/:folder/:handle',
		name: 'card-page',
		view: CardPage,
		layout: AppShell,
		meta: { title: 'Constellation' },
	},
];
