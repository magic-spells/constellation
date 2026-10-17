import { execFileSync } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';

async function playwright() {
  for (const name of ['playwright', '@playwright/test']) {
    try { return await import(name); } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    }
  }
  // npx makes the binary available on PATH, but does not add the package to this
  // script's module search path. Resolve its CLI symlink, then import beside it.
  const binary = execFileSync('npx', ['--yes', `--package=${process.env.PLAYWRIGHT_PACKAGE ?? 'playwright'}`, '-c', 'command -v playwright'], {
    encoding: 'utf8', env: { ...process.env,
      npm_config_cache: process.env.npm_config_cache ?? join(tmpdir(), 'pele-compare-npm-cache') },
  }).trim();
  return import(pathToFileURL(join(dirname(await realpath(binary)), 'index.mjs')).href);
}

const outputIndex = process.argv.indexOf('--out');
const output = resolve(outputIndex === -1 ? join(tmpdir(), 'constellation-renderer-compare') : process.argv[outputIndex + 1]);
await mkdir(output, { recursive: true });
const browsers = await playwright();
const browserIndex = process.argv.indexOf('--browser');
const browserName = browserIndex === -1 ? 'chromium' : process.argv[browserIndex + 1];
if (!['chromium', 'firefox', 'webkit'].includes(browserName)) throw new Error(`Unknown browser: ${browserName}`);
const { server, url } = await startServer({ port: 0 });
let browser;
try {
  browser = await browsers[browserName].launch({ headless: true });
  async function capture(theme, suite, screenshot) {
    // A new context has an empty HTTP and module cache for honest transfer totals.
    const context = await browser.newContext({ viewport: { width: 1800, height: 1100 },
      deviceScaleFactor: 1, colorScheme: theme, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      const browserErrors = [];
      page.on('pageerror', (error) => browserErrors.push(error.message));
      await page.goto(`${url}/?theme=${theme}${suite ? `&suite=${suite}` : ''}`);
      await page.waitForFunction(() => window.comparison?.ready || window.comparison?.fatalError, null, { timeout: 120000 });
      const report = await page.evaluate(() => window.comparison);
      if (report.fatalError) throw new Error(report.fatalError);
      if (browserErrors.length) throw new Error(browserErrors.join('\n'));
      await page.evaluate(() => document.fonts.ready);
      if (screenshot) await page.screenshot({ path: join(output, screenshot), fullPage: true });
      return report;
    } finally {
      await context.close();
    }
  }
  const dark = await capture('dark', null, 'compare-dark.png');
  const light = await capture('light', null, 'compare-light.png');
  const flowState = await capture('dark', 'flow-state');
  const report = { generatedAt: new Date().toISOString(), browser: { name: browserName, version: browser.version() }, versions: dark.versions,
    timing: 'performance.now: parse/render + SVG insertion + tint; module loads and SVG inspection excluded; Mermaid parser preloaded with getDiagramFromText',
    transfer: 'ResourceTiming transferSize (body + browser-reported overhead); uncompressed no-store loopback HTTP; fresh context for each suite/theme',
    diagrams: dark.rows, bytes: dark.bytes,
    themes: { dark: { diagrams: dark.rows, bytes: dark.bytes }, light: { diagrams: light.rows, bytes: light.bytes } },
    flowState: { diagrams: flowState.rows, bytes: flowState.bytes } };
  await writeFile(join(output, 'compare-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${dark.rows.length} diagram comparisons and dark/light screenshots to ${output}`);
  console.log(`Flowchart + state transfer: Mermaid ${flowState.bytes.mermaid.transferBytes} B; Pele ${flowState.bytes.pele.transferBytes} B`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
