import { defineConfig } from 'vitest/config';
// Lets tests import viewer/app/**/*.pzl — compiled on demand by the puzzle
// repo's `pzlc`. Inert (and .pzl imports fail) when that repo isn't present.
import { pzlPlugin } from './tests/viewer/pzl-vitest-plugin.js';

export default defineConfig({
  plugins: [pzlPlugin()],
  test: {
    include: ['tests/**/*.test.{ts,js}'],
  },
});
