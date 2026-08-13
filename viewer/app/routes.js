import AppShell from './layouts/AppShell.pzl';
import Home from './views/Home.pzl';
import ConstellationView from './views/ConstellationView.pzl';
import FeaturesPanel from './views/FeaturesPanel.pzl';
import StyleGuide from './views/StyleGuide.pzl';
import TypeIntro from './views/TypeIntro.pzl';
import CardPage from './views/CardPage.pzl';

export default [
	{ path: '/', name: 'home', view: Home, layout: AppShell, meta: { title: 'Constellation' } },
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
	{
		path: '/type/:folder',
		name: 'type',
		view: TypeIntro,
		layout: AppShell,
		meta: { title: 'Constellation' },
	},
	{
		path: '/card/:handle',
		name: 'card',
		view: CardPage,
		layout: AppShell,
		meta: { title: 'Constellation' },
	},
];
