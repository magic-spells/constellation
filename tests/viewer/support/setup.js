// Global test setup: bind the viewer's plain-module t() (viewer/app/lib/i18n.js)
// to an English service over the real en.json table — the same createI18n the
// app uses, by file path because the package does not export it. Suites have
// no app, and they assert the English text.
import { createI18n } from '../../../node_modules/@magic-spells/puzzle/client-runtime/i18n.js';
import { bindI18n } from '../../../viewer/app/lib/i18n.js';
import { EN_STRINGS } from './i18n.js';

const english = createI18n({
	manifest: { defaultLocale: 'en', locales: { en: '' } },
	tables: { en: EN_STRINGS },
	locale: 'en',
	lang: false,
});
await english.__ready();
bindI18n(english);
