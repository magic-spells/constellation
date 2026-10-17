// One contending process for the cross-process stress test in working-lock.test.ts.
// argv: <file> <events log> <go file> <rounds> <lanes> <mode: normal|crash>
// Runs `lanes` concurrent writers, each taking the lock `rounds` times. Inside the
// lock each logs `enter`/`exit` to an append-only log and holds an exclusive
// marker file: a marker that already exists means two holders are inside at once.
// A `crash` process dies holding the lock, the first time any lane gets it.
import { appendFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { withWriteLock } from '../src/core/working-lock.js';

const [file, events, go, roundsArg, lanesArg, mode] = process.argv.slice(2);
const marker = `${file}.inside`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line: string, lane = 0) => appendFileSync(events, `${line} ${process.pid}.${lane}\n`);

async function lane(id: number): Promise<void> {
  for (let i = 0; i < Number(roundsArg); i++) {
    await withWriteLock(
      file,
      async () => {
        if (mode === 'crash') {
          log('crash', id);
          process.exit(0);
        }
        log('enter', id);
        try {
          writeFileSync(marker, `${process.pid}.${id}`, { flag: 'wx' });
        } catch {
          log('OVERLAP', id);
          return;
        }
        await sleep(1 + Math.random() * 3);
        log('exit', id);
        unlinkSync(marker);
      },
      { waitMs: 30_000 },
    );
  }
}

log('ready');
while (!existsSync(go)) await sleep(2);
await Promise.all(Array.from({ length: Number(lanesArg) }, (_, id) => lane(id)));
