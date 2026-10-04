// `@magic-spells/puzzle/testing`, under English.
//
// vitest.config.ts aliases the package's /testing entry to this file, so every
// suite's `import { mountView } from '@magic-spells/puzzle/testing'` mounts
// with the viewer's real English table. Without it the templates' t() would
// have no service and print every key. A suite that passes its own `i18n`
// keeps it. The real module is imported by file path: the alias would
// otherwise point this file at itself.
import * as real from '../../../node_modules/@magic-spells/puzzle/client-runtime/testing/index.js';
import { EN_I18N } from './i18n.js';

export * from '../../../node_modules/@magic-spells/puzzle/client-runtime/testing/index.js';

export function mountView(ViewClass, options = {}) {
	return real.mountView(ViewClass, { i18n: EN_I18N, ...options });
}

export function createTestApp(config = {}) {
	return real.createTestApp({ i18n: EN_I18N, ...config });
}
