import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import pc from 'picocolors';

const CACHE_FILE = join(
  process.env.XDG_CACHE_HOME || join(homedir(), '.cache'),
  'constellation',
  'update.json',
);
const ONE_DAY = 24 * 60 * 60 * 1000;

type Cache = { latest: string; checkedAt: number };

/**
 * Print an "update available" notice on stderr (from cache — never hits the
 * network on this path, so it never blocks), then kick off a detached
 * background refresh if the cache is stale. Do NOT call this for `mcp`.
 */
export function notifyUpdate(name: string, current: string): void {
  if (!process.stderr.isTTY) return; // not a terminal (pipe / redirect)
  if (process.env.CI || process.env.NO_UPDATE_NOTIFIER) return;

  const cache = readCache();

  if (cache?.latest && isNewer(cache.latest, current)) {
    process.stderr.write(
      `\n  ${pc.yellow('▲ Update available')} ${pc.dim(`${current} →`)} ${pc.green(cache.latest)}\n` +
        `  ${pc.dim('Run')} ${pc.cyan(`npm i -g ${name}`)}\n\n`,
    );
  }

  if (!cache || Date.now() - cache.checkedAt > ONE_DAY) scheduleRefresh(name);
}

function readCache(): Cache | null {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Cache;
  } catch {
    return null;
  }
}

/** Detached child fetches the registry, writes the cache, then exits — outlives us. */
function scheduleRefresh(name: string): void {
  const script = `
    const fs = require('node:fs'), path = require('node:path'), file = process.argv[2];
    fetch('https://registry.npmjs.org/' + process.argv[1] + '/latest')
      .then((r) => r.json())
      .then((j) => {
        if (!j?.version) return;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ latest: j.version, checkedAt: Date.now() }));
      })
      .catch(() => {});
  `;
  try {
    spawn(process.execPath, ['-e', script, name, CACHE_FILE], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } catch {
    /* a failed background check must never affect the CLI */
  }
}

/** Is `a` a newer release than `b`? Compares major.minor.patch; ignores prerelease tags. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da !== db) return da > db;
  }
  return false;
}
