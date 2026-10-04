import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
// Lets tests import viewer/app/**/*.pzl — compiled on demand by the puzzle
// repo's `pzlc`. Inert (and .pzl imports fail) when that repo isn't present.
import { pzlPlugin } from './tests/viewer/pzl-vitest-plugin.js';

export default defineConfig({
  plugins: [pzlPlugin()],
  resolve: {
    alias: [
      // Every viewer suite mounts under the English locale table.
      {
        find: /^@magic-spells\/puzzle\/testing$/,
        replacement: fileURLToPath(new URL('./tests/viewer/support/testing.js', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['tests/**/*.test.{ts,js}'],
    // Binds the viewer's plain-module t() (viewer/app/lib/i18n.js) to English.
    setupFiles: ['tests/viewer/support/setup.js'],
  },
});
