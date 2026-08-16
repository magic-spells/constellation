import AppShell from './layouts/AppShell.pzl';
import Home from './views/Home.pzl';
import BoardPage from './views/BoardPage.pzl';
import BoardCardDialog from './views/BoardCardDialog.pzl';
import BoardOverlayEmpty from './views/BoardOverlayEmpty.pzl';
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

// Tasks is ONE destination with two views of the same FEATURE cards, so `/tasks`
// is not a page — it resolves to whichever view is the default. Board leads
// because "where is everything right now" is the question people arrive with.
const tasksIndex = () => '/tasks/board';

// The pre-0.5.1 shapes. `/board` and `/features` were two sidebar rows before
// they became two views of Tasks; both still resolve so bookmarks, pasted links
// and older builds keep working. Redirects replace() rather than push, so the
// dead URL never lands in history.
const legacyBoard = () => '/tasks/board';
const legacyFeatures = () => '/tasks/list';

export default [
	{ path: '/', name: 'home', view: Home, layout: AppShell, meta: { title: 'Constellation' } },
	{ path: '/tasks', name: 'tasks', view: BoardPage, guard: tasksIndex },
	{
		path: '/tasks/board',
		name: 'tasks-board',
		view: BoardPage,
		layout: AppShell,
		meta: { title: 'Constellation — Tasks' },
		// The preview dialog is a CHILD route rendered in BoardPage's <Slot/>,
		// not a `{#if}` toggle — that is the shape a shared-element morph needs
		// (puzzle D55). The board, and with it the clicked card, stays mounted for
		// the dialog's whole lifetime, so the blob can fly back into the card on
		// close (including via the browser Back button). A `{#if}` branch is
		// removed at patch time and a patch-time removal can't be awaited.
		children: [
			{ path: '', name: 'tasks-board-index', view: BoardOverlayEmpty },
			{ path: 'card/:handle', name: 'tasks-board-card', view: BoardCardDialog },
		],
	},
	{
		path: '/tasks/list',
		name: 'tasks-list',
		view: FeaturesPanel,
		layout: AppShell,
		meta: { title: 'Constellation — Tasks' },
	},
	{
		path: '/constellation',
		name: 'graph',
		view: ConstellationView,
		layout: AppShell,
		meta: { title: 'Constellation — Graph' },
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
	{ path: '/board', name: 'legacy-board', view: BoardPage, guard: legacyBoard },
	{ path: '/features', name: 'legacy-features', view: FeaturesPanel, guard: legacyFeatures },
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
