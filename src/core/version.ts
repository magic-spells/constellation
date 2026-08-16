import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * This package's own version — the Constellation the caller is running, as
 * opposed to `packageVersion()` in sync.ts, which reads the *workspace's*
 * package.json. Read once from the package root (`../..` resolves there from
 * both `src/core/` and `dist/core/`).
 */
export const CONSTELLATION_VERSION: string = (
  require('../../package.json') as { version: string }
).version;
